import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  buildZoomContextBlock,
  extractFileTagPaths,
  parseZoomContexts,
  removePiDimensionNotes,
  removeZoomContexts,
  type ZoomContextMetadata,
} from "../src/context.ts";
import {
  clampCoordinateBox,
  mapViewBoxToRoot,
  type CoordinateBox,
  type Dimensions,
  type PixelBox,
} from "../src/geometry.ts";
import {
  cropAndMagnify,
  getOrientedDimensions,
  IMAGE_PROFILES,
  prepareOverview,
  type OutputFormat,
  type PreparedOverview,
  type ProfileName,
} from "../src/image.ts";

const TOOL_NAME = "zoom_image";
const DETAILS_KIND = "pi-image-zoom-v1";
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
]);

interface ExtensionConfig {
  profile: ProfileName;
  maxBase64Bytes: number;
  maxSourceBytes: number;
  jpegQuality: number;
}

interface PathRootInput {
  kind: "path";
  path: string;
}

interface Base64RootInput {
  kind: "base64";
  data: string;
  mimeType: string;
}

type RootInput = PathRootInput | Base64RootInput;

interface RootRecord extends Dimensions {
  id: string;
  label: string;
  input: RootInput;
}

interface SourceRecord {
  id: string;
  rootId: string;
  label: string;
  viewWidth: number;
  viewHeight: number;
  rootRect: PixelBox;
  imageIndex?: number;
  path?: string;
}

interface RootDescriptor extends Dimensions {
  id: string;
  label: string;
  path?: string;
}

interface ZoomDetails {
  kind: typeof DETAILS_KIND;
  sourceId: string;
  resultSourceId: string;
  rootId: string;
  root: RootDescriptor;
  sourceView: Dimensions;
  requestedBox: CoordinateBox;
  clampedBox: CoordinateBox;
  rootCrop: PixelBox;
  output: Dimensions & { mimeType: string; format: OutputFormat; base64Bytes: number };
  profile: ProfileName;
}

const ZoomParameters = Type.Object(
  {
    source_id: Type.Optional(
      Type.String({
        description:
          'Source identifier reported beside an image or by a previous zoom, for example "image:0" or "zoom:2".',
      }),
    ),
    image_index: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Root image index reported in pi-image-zoom-context. Omit when there is only one image.",
      }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Path to an image. Prefer source_id/image_index when Pi already reported one; direct paths use original pixels unless view_width/view_height are supplied.",
      }),
    ),
    x1: Type.Integer({
      description:
        "Left edge in pixels of the selected source's coordinate space (origin top-left): original full-resolution pixels for image:N and path sources, the returned crop's pixel size for zoom:N sources.",
    }),
    y1: Type.Integer({
      description: "Top edge in pixels of the selected source's coordinate space.",
    }),
    x2: Type.Integer({
      description: "Right edge in absolute pixels; must be greater than x1.",
    }),
    y2: Type.Integer({
      description: "Bottom edge in absolute pixels; must be greater than y1.",
    }),
    view_width: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Optional width of an externally resized view. Supply together with view_height only when using path without a registered source.",
      }),
    ),
    view_height: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Optional height paired with view_width.",
      }),
    ),
    profile: Type.Optional(
      Type.Union([Type.Literal("standard"), Type.Literal("high")], {
        description:
          "Output image budget. standard is broadly compatible; high uses the larger Anthropic cookbook budget.",
      }),
    ),
    output_format: Type.Optional(
      Type.Union([Type.Literal("jpeg"), Type.Literal("png")], {
        description:
          "JPEG (default) keeps iterative tool history compact; PNG is useful for tiny text and line art but may be downscaled to fit the byte limit.",
      }),
    ),
  },
  { additionalProperties: false },
);

type ZoomParams = {
  source_id?: string;
  image_index?: number;
  path?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  view_width?: number;
  view_height?: number;
  profile?: ProfileName;
  output_format?: OutputFormat;
};

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function loadConfig(): ExtensionConfig {
  const profile = process.env.PI_IMAGE_ZOOM_PROFILE === "high" ? "high" : "standard";
  return {
    profile,
    maxBase64Bytes: positiveIntegerFromEnv("PI_IMAGE_ZOOM_MAX_BASE64_BYTES", Math.floor(4.5 * 1024 * 1024)),
    maxSourceBytes: positiveIntegerFromEnv("PI_IMAGE_ZOOM_MAX_SOURCE_BYTES", 100 * 1024 * 1024),
    jpegQuality: Math.min(100, positiveIntegerFromEnv("PI_IMAGE_ZOOM_JPEG_QUALITY", 92)),
  };
}

function isImageContent(content: TextContent | ImageContent): content is ImageContent {
  return content.type === "image";
}

function contentText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function contentImages(content: string | (TextContent | ImageContent)[]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter(isImageContent);
}

function normalizePathArgument(rawPath: string, cwd: string): string {
  let value = rawPath.trim();
  if (value.startsWith("@")) value = value.slice(1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value.startsWith("file://")) {
    return fileURLToPath(value);
  }
  if (value === "~") return homedir();
  if (value.startsWith("~/")) value = resolve(homedir(), value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function isLikelyImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function pathCandidatesFromText(text: string, cwd: string): string[] {
  return extractFileTagPaths(text)
    .filter(isLikelyImagePath)
    .map((path) => normalizePathArgument(path, cwd));
}

function pathHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

function parseCounter(id: string, prefix: string): number | undefined {
  if (!id.startsWith(`${prefix}:`)) return undefined;
  const parsed = Number.parseInt(id.slice(prefix.length + 1), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function isZoomDetails(value: unknown): value is ZoomDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<ZoomDetails>;
  return (
    details.kind === DETAILS_KIND &&
    typeof details.resultSourceId === "string" &&
    typeof details.rootId === "string" &&
    typeof details.rootCrop?.left === "number" &&
    typeof details.output?.width === "number" &&
    typeof details.output?.height === "number"
  );
}

export default function imageZoomExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const roots = new Map<string, RootRecord>();
  const sources = new Map<string, SourceRecord>();
  const imageIndexToSourceId = new Map<number, string>();
  const pathToSourceId = new Map<string, string>();
  let latestSourceId: string | undefined;
  let nextImageIndex = 0;
  let nextZoomIndex = 0;

  const encodeOptions = (signal?: AbortSignal) => ({
    maxBase64Bytes: config.maxBase64Bytes,
    jpegQuality: config.jpegQuality,
    signal,
  });

  function resetState(): void {
    roots.clear();
    sources.clear();
    imageIndexToSourceId.clear();
    pathToSourceId.clear();
    latestSourceId = undefined;
    nextImageIndex = 0;
    nextZoomIndex = 0;
  }

  function addRootAndSource(root: RootRecord, source: SourceRecord): void {
    roots.set(root.id, root);
    sources.set(source.id, source);
    latestSourceId = source.id;

    if (source.imageIndex !== undefined) {
      imageIndexToSourceId.set(source.imageIndex, source.id);
      nextImageIndex = Math.max(nextImageIndex, source.imageIndex + 1);
    }
    if (source.path) {
      pathToSourceId.set(source.path, source.id);
    }
  }

  function addDerivedSource(source: SourceRecord): void {
    sources.set(source.id, source);
    latestSourceId = source.id;
    const counter = parseCounter(source.id, "zoom");
    if (counter !== undefined) nextZoomIndex = Math.max(nextZoomIndex, counter + 1);
  }

  async function assertUsablePath(path: string): Promise<void> {
    const file = await stat(path);
    if (!file.isFile()) throw new Error(`Image source is not a regular file: ${path}`);
    if (file.size === 0) throw new Error(`Image source is empty: ${path}`);
    if (file.size > config.maxSourceBytes) {
      throw new Error(
        `Image source is ${file.size} bytes, above PI_IMAGE_ZOOM_MAX_SOURCE_BYTES=${config.maxSourceBytes}`,
      );
    }
  }

  async function registerIncomingImage(
    image: ImageContent,
    candidatePath: string | undefined,
    origin: ZoomContextMetadata["origin"],
    contentImageIndex: number,
    signal?: AbortSignal,
  ): Promise<{ image: ImageContent; metadata: ZoomContextMetadata }> {
    const imageIndex = nextImageIndex;
    const sourceId = `image:${imageIndex}`;
    let canonicalPath: string | undefined;
    let rootInput: RootInput | undefined;
    let rootDimensions: Dimensions | undefined;
    let label: string | undefined;
    let overview: PreparedOverview | undefined;

    if (candidatePath) {
      try {
        await assertUsablePath(candidatePath);
        canonicalPath = candidatePath;
        overview = await prepareOverview(candidatePath, IMAGE_PROFILES[config.profile], encodeOptions(signal));
        rootInput = { kind: "path", path: candidatePath };
        rootDimensions = overview.original;
        label = basename(candidatePath);
      } catch {
        canonicalPath = undefined;
      }
    }

    if (!overview) {
      const inputBuffer = Buffer.from(image.data, "base64");
      if (inputBuffer.length === 0) throw new Error("Attached image is empty");
      overview = await prepareOverview(inputBuffer, IMAGE_PROFILES[config.profile], encodeOptions(signal));

      // For images without a durable file path, persist the calibrated overview
      // itself as the root. This keeps coordinates and recursive zooms stable after
      // session reloads instead of depending on ephemeral in-memory bytes.
      rootInput = { kind: "base64", data: overview.data, mimeType: overview.mimeType };
      rootDimensions = { width: overview.width, height: overview.height };
      label = `${origin === "read" ? "read" : "attached"} image ${imageIndex}`;
    }

    if (!rootInput || !rootDimensions || !label || !overview) {
      throw new Error("Image registration did not produce a calibrated source");
    }

    const root: RootRecord = {
      id: sourceId,
      label,
      width: rootDimensions.width,
      height: rootDimensions.height,
      input: rootInput,
    };
    // The model addresses an attached image in the original's pixel grid, the
    // same frame Pi's own resize note and path sources use. The overview it sees
    // is only a preview; the context block reports the preview-to-original scale.
    const source: SourceRecord = {
      id: sourceId,
      rootId: sourceId,
      label,
      viewWidth: root.width,
      viewHeight: root.height,
      rootRect: { left: 0, top: 0, width: root.width, height: root.height },
      imageIndex,
      path: canonicalPath,
    };
    addRootAndSource(root, source);

    const metadata: ZoomContextMetadata = {
      version: 1,
      imageIndex,
      sourceId,
      contentImageIndex,
      origin,
      view: { width: overview.width, height: overview.height },
      original: { width: root.width, height: root.height },
      path: canonicalPath,
      label,
    };

    return {
      image: { type: "image", data: overview.data, mimeType: overview.mimeType },
      metadata,
    };
  }

  function restoreRootFromMessage(metadata: ZoomContextMetadata, image: ImageContent): void {
    if (sources.has(metadata.sourceId)) return;

    const hasPath = typeof metadata.path === "string" && metadata.path.length > 0;
    const rootDimensions = hasPath ? metadata.original : metadata.view;
    const root: RootRecord = {
      id: metadata.sourceId,
      label: metadata.label ?? `image ${metadata.imageIndex}`,
      width: rootDimensions.width,
      height: rootDimensions.height,
      input: hasPath
        ? { kind: "path", path: metadata.path! }
        : { kind: "base64", data: image.data, mimeType: image.mimeType },
    };
    const source: SourceRecord = {
      id: metadata.sourceId,
      rootId: metadata.sourceId,
      label: root.label,
      viewWidth: root.width,
      viewHeight: root.height,
      rootRect: { left: 0, top: 0, width: root.width, height: root.height },
      imageIndex: metadata.imageIndex,
      path: metadata.path,
    };
    addRootAndSource(root, source);
  }

  function restoreZoomFromDetails(details: ZoomDetails): void {
    if (!roots.has(details.rootId) && details.root.path) {
      const root: RootRecord = {
        id: details.rootId,
        label: details.root.label,
        width: details.root.width,
        height: details.root.height,
        input: { kind: "path", path: details.root.path },
      };
      const rootSource: SourceRecord = {
        id: details.rootId,
        rootId: details.rootId,
        label: root.label,
        viewWidth: root.width,
        viewHeight: root.height,
        rootRect: { left: 0, top: 0, width: root.width, height: root.height },
        path: details.root.path,
      };
      addRootAndSource(root, rootSource);
    }

    if (!roots.has(details.rootId) || sources.has(details.resultSourceId)) return;
    addDerivedSource({
      id: details.resultSourceId,
      rootId: details.rootId,
      label: `${details.root.label} zoom`,
      viewWidth: details.output.width,
      viewHeight: details.output.height,
      rootRect: details.rootCrop,
      path: details.root.path,
    });
  }

  async function reconstructState(ctx: ExtensionContext): Promise<void> {
    resetState();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const message = entry.message;

      if (message.role === "user" || message.role === "toolResult") {
        const text = contentText(message.content);
        const images = contentImages(message.content);
        const contexts = parseZoomContexts(text);
        for (let index = 0; index < contexts.length; index++) {
          const metadata = contexts[index]!;
          const imagePosition = metadata.contentImageIndex ?? index;
          const image = images[imagePosition];
          if (image) restoreRootFromMessage(metadata, image);
        }
      }

      if (message.role === "toolResult" && message.toolName === TOOL_NAME && isZoomDetails(message.details)) {
        restoreZoomFromDetails(message.details);
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

  pi.on("input", async (event, ctx) => {
    if (!event.images || event.images.length === 0) return { action: "continue" };

    const paths = pathCandidatesFromText(event.text, ctx.cwd);
    const preparedImages: ImageContent[] = [];
    const metadata: ZoomContextMetadata[] = [];
    ctx.ui.setStatus("image-zoom", `preparing ${event.images.length} image${event.images.length === 1 ? "" : "s"}`);

    try {
      for (let index = 0; index < event.images.length; index++) {
        try {
          const registered = await registerIncomingImage(
            event.images[index]!,
            paths[index],
            "attachment",
            index,
            ctx.signal,
          );
          preparedImages.push(registered.image);
          metadata.push(registered.metadata);
        } catch (error) {
          preparedImages.push(event.images[index]!);
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Image zoom could not calibrate image ${index}: ${message}`, "warning");
        }
      }
    } finally {
      ctx.ui.setStatus("image-zoom", undefined);
    }

    if (metadata.length === 0) return { action: "continue" };
    // Pi's note describes the preview Pi made, which was just replaced; its
    // "displayed at" size and multiplier would state a second, wrong frame.
    const withoutStaleNotes =
      metadata.length === event.images.length ? removePiDimensionNotes(event.text) : event.text;
    const cleanText = removeZoomContexts(withoutStaleNotes);
    const contextBlock = buildZoomContextBlock(metadata);
    const text = cleanText.length > 0 ? `${cleanText}\n\n${contextBlock}` : contextBlock;
    return { action: "transform", text, images: preparedImages };
  });

  // Images loaded later through Pi's built-in read tool also become calibrated,
  // full-resolution roots before the next model turn.
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError) return;
    const imageContentIndex = event.content.findIndex(isImageContent);
    if (imageContentIndex < 0) return;
    const image = event.content[imageContentIndex];
    if (!image || !isImageContent(image)) return;
    const contentImageIndex = event.content
      .slice(0, imageContentIndex)
      .filter(isImageContent).length;

    const rawPath =
      typeof event.input.path === "string"
        ? event.input.path
        : typeof event.input.file_path === "string"
          ? event.input.file_path
          : undefined;
    if (!rawPath) return;

    try {
      const path = normalizePathArgument(rawPath, ctx.cwd);
      const registered = await registerIncomingImage(image, path, "read", contentImageIndex, ctx.signal);
      const content = event.content.map((part: TextContent | ImageContent, index: number) => {
        if (index === imageContentIndex) return registered.image;
        if (part.type === "text") return { ...part, text: removePiDimensionNotes(part.text) };
        return part;
      });
      content.push({ type: "text", text: buildZoomContextBlock([registered.metadata]) });
      return {
        content,
        details: event.details,
        isError: event.isError,
      };
    } catch {
      return;
    }
  });

  async function resolveSource(params: ZoomParams, cwd: string): Promise<{ source: SourceRecord; root: RootRecord }> {
    const selectorCount = [params.source_id !== undefined, params.image_index !== undefined, params.path !== undefined].filter(
      Boolean,
    ).length;
    if (selectorCount > 1) {
      throw new Error("Choose exactly one of source_id, image_index, or path");
    }
    if ((params.view_width === undefined) !== (params.view_height === undefined)) {
      throw new Error("view_width and view_height must be supplied together");
    }

    let source: SourceRecord | undefined;

    if (params.source_id !== undefined) {
      source = sources.get(params.source_id);
      if (!source) throw new Error(`Unknown source_id ${JSON.stringify(params.source_id)}. Run /zoom-images to list sources.`);
    } else if (params.image_index !== undefined) {
      const sourceId = imageIndexToSourceId.get(params.image_index);
      source = sourceId ? sources.get(sourceId) : undefined;
      if (!source) throw new Error(`Unknown image_index ${params.image_index}. Run /zoom-images to list images.`);
    } else if (params.path !== undefined) {
      const path = normalizePathArgument(params.path, cwd);
      await assertUsablePath(path);
      const existingSourceId = pathToSourceId.get(path);
      source = existingSourceId ? sources.get(existingSourceId) : undefined;

      if (!source) {
        const dimensions = await getOrientedDimensions(path);
        const rootId = `path:${pathHash(path)}`;
        const root: RootRecord = {
          id: rootId,
          label: basename(path),
          width: dimensions.width,
          height: dimensions.height,
          input: { kind: "path", path },
        };
        source = {
          id: rootId,
          rootId,
          label: root.label,
          viewWidth: params.view_width ?? dimensions.width,
          viewHeight: params.view_height ?? dimensions.height,
          rootRect: { left: 0, top: 0, width: dimensions.width, height: dimensions.height },
          path,
        };
        addRootAndSource(root, source);
      }
    } else if (latestSourceId) {
      source = sources.get(latestSourceId);
    }

    if (!source) {
      throw new Error("No image source is registered. Attach, paste, drop, or read an image, or pass path.");
    }

    if (params.view_width !== undefined && params.view_height !== undefined) {
      source = {
        ...source,
        viewWidth: params.view_width,
        viewHeight: params.view_height,
      };
    }

    const root = roots.get(source.rootId);
    if (!root) throw new Error(`Full-resolution root ${source.rootId} is unavailable in this session branch`);
    if (root.input.kind === "path") await assertUsablePath(root.input.path);
    return { source, root };
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "Image zoom",
    description:
      "Crop and magnify a rectangular region from an image's full-resolution root. For image:N and path sources, coordinates are pixels of the original full-resolution image (the attached picture is a downscaled preview; pi-image-zoom-context reports its size and the multiplier). For zoom:N sources, coordinates are pixels of that crop's returned size. Select with source_id, image_index, or path; when omitted, the most recent image/zoom is used. Each result returns a new source_id that can be cropped again without losing the link to the original pixels.",
    promptSnippet: "Crop and magnify fine detail from attached or filesystem images",
    promptGuidelines: [
      "Use zoom_image whenever labels, text, boundaries, crossings, UI controls, or other image details are too small to read reliably.",
      "For zoom_image on an attached or read image, give coordinates in the original image's pixel grid: estimate the region on the preview you see, then multiply by the factor reported in pi-image-zoom-context. Never use preview pixels or normalized 0-1 coordinates.",
      "After zoom_image returns a zoom:* source_id, use that source_id for a tighter recursive crop rather than guessing at unreadable detail; its coordinates are the returned crop's pixel size.",
      "Prefer JPEG for normal iterative inspection and PNG when tiny text or one-pixel line work needs lossless rendering.",
    ],
    parameters: ZoomParameters,

    async execute(_toolCallId, params: ZoomParams, signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      const { source, root } = await resolveSource(params, cwd);
      const requestedBox: CoordinateBox = { x1: params.x1, y1: params.y1, x2: params.x2, y2: params.y2 };
      const clampedBox = clampCoordinateBox(requestedBox, source.viewWidth, source.viewHeight);
      if (!clampedBox) {
        throw new Error(
          `Invalid region: require x1 < x2 and y1 < y2 inside ${source.viewWidth}x${source.viewHeight}`,
        );
      }

      const rootCrop = mapViewBoxToRoot(
        clampedBox,
        { width: source.viewWidth, height: source.viewHeight },
        source.rootRect,
        { width: root.width, height: root.height },
      );
      const profileName = params.profile ?? config.profile;
      const format = params.output_format ?? "jpeg";
      const input = root.input.kind === "path" ? root.input.path : Buffer.from(root.input.data, "base64");
      const output = await cropAndMagnify(
        input,
        rootCrop,
        IMAGE_PROFILES[profileName],
        format,
        encodeOptions(signal),
      );

      const resultSourceId = `zoom:${nextZoomIndex++}`;
      addDerivedSource({
        id: resultSourceId,
        rootId: root.id,
        label: `${root.label} zoom`,
        viewWidth: output.width,
        viewHeight: output.height,
        rootRect: rootCrop,
        path: root.input.kind === "path" ? root.input.path : undefined,
      });

      const details: ZoomDetails = {
        kind: DETAILS_KIND,
        sourceId: source.id,
        resultSourceId,
        rootId: root.id,
        root: {
          id: root.id,
          label: root.label,
          width: root.width,
          height: root.height,
          path: root.input.kind === "path" ? root.input.path : undefined,
        },
        sourceView: { width: source.viewWidth, height: source.viewHeight },
        requestedBox,
        clampedBox,
        rootCrop,
        output: {
          width: output.width,
          height: output.height,
          mimeType: output.mimeType,
          format: output.format,
          base64Bytes: output.base64Bytes,
        },
        profile: profileName,
      };

      const text = [
        `Zoomed ${source.id} box (${clampedBox.x1},${clampedBox.y1})-(${clampedBox.x2},${clampedBox.y2}) in its ${source.viewWidth}x${source.viewHeight}px coordinate space.`,
        `Cropped (${rootCrop.left},${rootCrop.top}) ${rootCrop.width}x${rootCrop.height}px from the ${root.width}x${root.height}px full-resolution root and magnified it to ${output.width}x${output.height}px.`,
        `For another pass on this crop, use source_id=${JSON.stringify(resultSourceId)} with coordinates in a ${output.width}x${output.height}px space.`,
      ].join("\n");

      return {
        content: [
          { type: "text", text },
          { type: "image", data: output.data, mimeType: output.mimeType },
        ],
        details,
      };
    },

    renderCall(args, theme) {
      const selector =
        args.source_id ??
        (args.image_index !== undefined ? `image:${args.image_index}` : args.path ?? "latest image");
      const region = `(${args.x1},${args.y1})–(${args.x2},${args.y2})`;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("zoom image"))} ${theme.fg("accent", String(selector))} ${theme.fg("muted", region)}`,
        0,
        0,
      );
    },
  });

  pi.registerCommand("zoom-images", {
    description: "List image and recursive zoom sources known to zoom_image",
    handler: async (_args, ctx) => {
      const available = Array.from(sources.values());
      if (available.length === 0) {
        ctx.ui.notify("No zoom sources. Attach, paste, drop, or read an image first.", "info");
        return;
      }

      const lines = available.slice(-30).map((source) => {
        const root = roots.get(source.rootId);
        const index = source.imageIndex !== undefined ? ` image_index=${source.imageIndex}` : "";
        const full = root ? ` → ${root.width}x${root.height} root` : "";
        return `${source.id}${index}: ${source.viewWidth}x${source.viewHeight}${full} · ${source.label}`;
      });
      if (available.length > 30) lines.unshift(`… ${available.length - 30} older sources omitted`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
