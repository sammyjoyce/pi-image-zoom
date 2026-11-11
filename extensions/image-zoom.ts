import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  createReadTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
  type ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { compile, int, obj, oneOf, opt, type Static, str } from "@earendil-works/pi-schema";
import { Text } from "@earendil-works/pi-tui";
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
const MAX_IN_MEMORY_TOOL_IMAGES = 8;
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

const ZoomParameters = obj({
  source_id: opt(
    str({
      description:
        'Source identifier reported beside an image or by a previous zoom, for example "image:0" or "zoom:2".',
    }),
  ),
  path: opt(
    str({
      description:
        "Path to an image file. Coordinates are pixels of the file's full-resolution image.",
    }),
  ),
  x1: int({
    description:
      "Left edge in pixels of the selected source's coordinate space (origin top-left): original full-resolution pixels for image:N and path sources, the returned crop's pixel size for zoom:N sources.",
  }),
  y1: int({
    description: "Top edge in pixels of the selected source's coordinate space.",
  }),
  x2: int({
    description: "Right edge in absolute pixels; must be greater than x1.",
  }),
  y2: int({
    description: "Bottom edge in absolute pixels; must be greater than y1.",
  }),
  profile: opt(
    oneOf(["standard", "high"], {
      description:
        "Output image budget. standard is broadly compatible; high uses the larger Anthropic cookbook budget.",
    }),
  ),
  output_format: opt(
    oneOf(["jpeg", "png"], {
      description:
        "JPEG (default) keeps iterative tool history compact; PNG is useful for tiny text and line art but may be downscaled to fit the byte limit.",
    }),
  ),
});

type ZoomParams = Static<typeof ZoomParameters>;

const REMOVED_PARAMETERS = new Set(["image_index", "view_width", "view_height"]);
const legacyImageIndex = compile(int({ minimum: 0 }), { coerce: true });

/**
 * A session that started before image_index was removed still shows "image:N (image_index N)"
 * beside each image, so a model can still send it after a resume. The removed schema coerces the
 * value exactly as Pi did then.
 */
function withLegacyImageIndex(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const sent = Object.fromEntries(
    Object.entries(args).filter(([name, value]) => !(value === null && REMOVED_PARAMETERS.has(name))),
  );
  if (!("image_index" in sent)) return sent;
  const { image_index: imageIndex, ...rest } = sent;
  const index = legacyImageIndex.parse(imageIndex);
  if (!index.ok) return sent;
  return rest.source_id == null ? { ...rest, source_id: `image:${index.value}` } : rest;
}

/** Some models fill every optional field and send null or the string "null" for the ones they do not use. */
function withoutPlaceholders(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== "null"));
}

async function isSameFile(first: string, second: string): Promise<boolean> {
  if (first === second) return true;
  const [firstReal, secondReal] = await Promise.all([first, second].map((path) => realpath(path).catch(() => undefined)));
  return firstReal !== undefined && firstReal === secondReal;
}

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

const fileExists = (path: string) => stat(path).then(() => true, () => false);

/**
 * The file that Pi's read tool opens for a typed path. Pi does not export its path resolver, and
 * a copy of it would have to track every rule. The read tool takes replaceable file operations
 * and hands them the resolved path, so a read that stops at its first operation names the file.
 */
async function pathPiReads(rawPath: string, cwd: string): Promise<string | undefined> {
  let opened: string | undefined;
  const probe = createReadTool(cwd, {
    operations: {
      access: async (path) => {
        opened = path;
        throw new Error("stop after the path is known");
      },
      readFile: async () => Buffer.alloc(0),
    },
  });
  await probe.execute("path-probe", { path: rawPath }).catch(() => undefined);
  return opened;
}

async function resolveImagePath(rawPath: string, cwd: string): Promise<string> {
  const exact = normalizePathArgument(rawPath, cwd);
  return (await fileExists(exact)) ? exact : ((await pathPiReads(rawPath, cwd)) ?? exact);
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
  const pathToSourceId = new Map<string, string>();
  // The source for a call with no selector: a whole image, never a zoom crop. The model sends
  // original-pixel boxes when it omits the selector.
  let defaultSourceId: string | undefined;
  const toolImageRootIds: string[] = [];
  const releasedToolImageIds = new Set<string>();
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
    pathToSourceId.clear();
    defaultSourceId = undefined;
    toolImageRootIds.length = 0;
    releasedToolImageIds.clear();
    nextImageIndex = 0;
    nextZoomIndex = 0;
  }

  function addRootAndSource(root: RootRecord, source: SourceRecord): void {
    roots.set(root.id, root);
    sources.set(source.id, source);
    // Parallel tool results register in the order they finish, and a reload registers them in
    // transcript order. The highest image number is the same image in both.
    const defaultIndex = defaultSourceId === undefined ? undefined : sources.get(defaultSourceId)?.imageIndex;
    if (source.imageIndex === undefined || defaultIndex === undefined || source.imageIndex > defaultIndex) {
      defaultSourceId = source.id;
    }

    if (source.imageIndex !== undefined) {
      nextImageIndex = Math.max(nextImageIndex, source.imageIndex + 1);
    }
    if (source.path) {
      pathToSourceId.set(source.path, source.id);
    }
  }

  function addDerivedSource(source: SourceRecord): void {
    sources.set(source.id, source);
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
    const imageIndex = nextImageIndex++;
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

  async function registerToolImage(image: ImageContent, contentImageIndex: number): Promise<ZoomContextMetadata> {
    const imageIndex = nextImageIndex++;
    const sourceId = `image:${imageIndex}`;
    const dimensions = await getOrientedDimensions(Buffer.from(image.data, "base64"));
    const label = `tool image ${imageIndex}`;
    addRootAndSource(
      { id: sourceId, label, ...dimensions, input: { kind: "base64", data: image.data, mimeType: image.mimeType } },
      {
        id: sourceId,
        rootId: sourceId,
        label,
        viewWidth: dimensions.width,
        viewHeight: dimensions.height,
        rootRect: { left: 0, top: 0, ...dimensions },
        imageIndex,
      },
    );

    toolImageRootIds.push(sourceId);
    if (toolImageRootIds.length > MAX_IN_MEMORY_TOOL_IMAGES) {
      const released = toolImageRootIds.shift()!;
      roots.delete(released);
      for (const source of sources.values()) {
        if (source.rootId === released) sources.delete(source.id);
      }
      releasedToolImageIds.add(released);
    }

    return {
      version: 1,
      imageIndex,
      sourceId,
      contentImageIndex,
      origin: "tool",
      view: dimensions,
      original: dimensions,
      label,
    };
  }

  async function restoreRootFromMessage(metadata: ZoomContextMetadata, image: ImageContent): Promise<void> {
    if (sources.has(metadata.sourceId)) return;

    // Pi resizes tool-result images after tool_result handlers run, so a stored image without a
    // file can be smaller than metadata.original. The root size comes from the bytes. The source
    // keeps the original frame that the model addresses.
    const root: RootRecord = metadata.path
      ? {
          id: metadata.sourceId,
          label: metadata.label ?? `image ${metadata.imageIndex}`,
          ...metadata.original,
          input: { kind: "path", path: metadata.path },
        }
      : {
          id: metadata.sourceId,
          label: metadata.label ?? `image ${metadata.imageIndex}`,
          ...(await getOrientedDimensions(Buffer.from(image.data, "base64"))),
          input: { kind: "base64", data: image.data, mimeType: image.mimeType },
        };
    const source: SourceRecord = {
      id: metadata.sourceId,
      rootId: metadata.sourceId,
      label: root.label,
      viewWidth: metadata.original.width,
      viewHeight: metadata.original.height,
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
        imageIndex: parseCounter(details.rootId, "image"),
        path: details.root.path,
      };
      addRootAndSource(root, rootSource);
    }

    const restoredRoot = roots.get(details.rootId);
    if (!restoredRoot || sources.has(details.resultSourceId)) return;
    const scaleX = restoredRoot.width / details.root.width;
    const scaleY = restoredRoot.height / details.root.height;
    const left = Math.min(restoredRoot.width - 1, Math.round(details.rootCrop.left * scaleX));
    const top = Math.min(restoredRoot.height - 1, Math.round(details.rootCrop.top * scaleY));
    addDerivedSource({
      id: details.resultSourceId,
      rootId: details.rootId,
      label: `${details.root.label} zoom`,
      viewWidth: details.output.width,
      viewHeight: details.output.height,
      rootRect: {
        left,
        top,
        width: Math.max(1, Math.min(restoredRoot.width - left, Math.round(details.rootCrop.width * scaleX))),
        height: Math.max(1, Math.min(restoredRoot.height - top, Math.round(details.rootCrop.height * scaleY))),
      },
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
          if (image) await restoreRootFromMessage(metadata, image).catch(() => undefined);
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

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === TOOL_NAME) return;
    if (event.toolName === "read") return calibrateReadResult(event, ctx);
    if (event.parentToolCallId) return;

    // Pi resizes tool images after this handler runs, so these are the tool's full-size bytes.
    const metadata: ZoomContextMetadata[] = [];
    const images = contentImages(event.content);
    for (let index = 0; index < images.length; index++) {
      const registered = await registerToolImage(images[index]!, index).catch(() => undefined);
      if (registered) metadata.push(registered);
    }
    if (metadata.length === 0) return;
    return {
      content: [...event.content, { type: "text" as const, text: buildZoomContextBlock(metadata) }],
      structuredContent: event.structuredContent,
    };
  });

  async function calibrateReadResult(
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ): Promise<ToolResultEventResult | undefined> {
    if (event.isError) return;
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
      const path = await pathPiReads(rawPath, ctx.cwd);
      const registered = await registerIncomingImage(image, path, "read", contentImageIndex, ctx.signal);
      // A nested result reaches only the tool that made the call, and replacing its content drops
      // the structuredContent that a script receives. The file is still registered, so a later
      // zoom finds it.
      if (event.parentToolCallId) return;
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
  }

  async function resolveSource(params: ZoomParams, cwd: string): Promise<{ source: SourceRecord; root: RootRecord }> {
    if (params.source_id !== undefined && params.path !== undefined) {
      const named = sources.get(params.source_id);
      const namesWholeImage = named?.id === named?.rootId && named?.path !== undefined;
      if (named && !(namesWholeImage && (await isSameFile(named.path!, await resolveImagePath(params.path, cwd))))) {
        throw new Error(
          `source_id ${JSON.stringify(params.source_id)} and path ${JSON.stringify(params.path)} name different images. Send only one of them.`,
        );
      }
    }

    let source: SourceRecord | undefined;

    if (params.source_id !== undefined) {
      source = sources.get(params.source_id);
      if (!source && releasedToolImageIds.has(params.source_id)) {
        throw new Error(`${params.source_id} is no longer held in memory. Capture the image again, or save it to a file and pass path.`);
      }
      if (!source) throw new Error(`Unknown source_id ${JSON.stringify(params.source_id)}. Run /zoom-images to list sources.`);
    } else if (params.path !== undefined) {
      const path = await resolveImagePath(params.path, cwd);
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
          viewWidth: dimensions.width,
          viewHeight: dimensions.height,
          rootRect: { left: 0, top: 0, width: dimensions.width, height: dimensions.height },
          path,
        };
        addRootAndSource(root, source);
      }
    } else if (defaultSourceId) {
      source = sources.get(defaultSourceId);
    }

    if (!source) {
      throw new Error("No image source is registered. Attach, paste, drop, or read an image, or pass path.");
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
      "Crop and magnify a rectangular region from an image's full-resolution root. For image:N and path sources, coordinates are pixels of the original full-resolution image (the attached picture is a downscaled preview; pi-image-zoom-context reports its size and the multiplier). For zoom:N sources, coordinates are pixels of that crop's returned size. Select with source_id or path; when omitted, the most recent attached or read image is used (pass a zoom:N source_id explicitly to zoom into a crop). Each result returns a new source_id that can be cropped again without losing the link to the original pixels.",
    promptSnippet: "Crop and magnify fine detail from attached or filesystem images",
    promptGuidelines: [
      "Use zoom_image whenever labels, text, boundaries, crossings, UI controls, or other image details are too small to read reliably.",
      "For zoom_image on an attached or read image, give coordinates in the original image's pixel grid: estimate the region on the preview you see, then multiply by the factor reported in pi-image-zoom-context. Never use preview pixels or normalized 0-1 coordinates.",
      "After zoom_image returns a zoom:* source_id, use that source_id for a tighter recursive crop rather than guessing at unreadable detail; its coordinates are the returned crop's pixel size.",
      "Prefer JPEG for normal iterative inspection and PNG when tiny text or one-pixel line work needs lossless rendering.",
    ],
    parameters: ZoomParameters,
    prepareArguments: (args) => withLegacyImageIndex(withoutPlaceholders(args)),

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
      // Pi 1.5.2 types render arguments with TypeBox's Static, which is unknown for a pi-schema schema.
      const { source_id, path, x1, y1, x2, y2 } = args as ZoomParams;
      const selector = source_id ?? path ?? "latest image";
      const region = `(${x1},${y1})–(${x2},${y2})`;
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
        const full = root ? ` → ${root.width}x${root.height} root` : "";
        return `${source.id}: ${source.viewWidth}x${source.viewHeight}${full} · ${source.label}`;
      });
      if (available.length > 30) lines.unshift(`… ${available.length - 30} older sources omitted`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
