import type { Dimensions } from "./geometry.ts";

const CONTEXT_OPEN = "<pi-image-zoom-context>";
const CONTEXT_CLOSE = "</pi-image-zoom-context>";
const CONTEXT_PATTERN = /<pi-image-zoom-context>([\s\S]*?)<\/pi-image-zoom-context>/g;
const FILE_TAG_PATTERN = /<file\s+name="([^"]+)"[^>]*>[\s\S]*?<\/file>/g;
const PI_DIMENSION_NOTE_PATTERN =
  /\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]/g;

export interface ZoomContextMetadata {
  version: 1;
  imageIndex: number;
  sourceId: string;
  /** Position of this image block within the containing message. */
  contentImageIndex?: number;
  origin: "attachment" | "read";
  view: Dimensions;
  original: Dimensions;
  path?: string;
  label?: string;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function encodeZoomContext(metadata: ZoomContextMetadata): string {
  return `${CONTEXT_OPEN}${JSON.stringify(metadata)}${CONTEXT_CLOSE}`;
}

export function parseZoomContexts(text: string): ZoomContextMetadata[] {
  const contexts: ZoomContextMetadata[] = [];
  for (const match of text.matchAll(CONTEXT_PATTERN)) {
    try {
      const value = JSON.parse(match[1] ?? "") as Partial<ZoomContextMetadata>;
      if (
        value.version === 1 &&
        typeof value.sourceId === "string" &&
        value.sourceId.length > 0 &&
        isNonNegativeInteger(value.imageIndex) &&
        (value.contentImageIndex === undefined || isNonNegativeInteger(value.contentImageIndex)) &&
        (value.origin === "attachment" || value.origin === "read") &&
        isPositiveInteger(value.view?.width) &&
        isPositiveInteger(value.view?.height) &&
        isPositiveInteger(value.original?.width) &&
        isPositiveInteger(value.original?.height)
      ) {
        contexts.push(value as ZoomContextMetadata);
      }
    } catch {
      // Ignore malformed context blocks from untrusted session text.
    }
  }
  return contexts;
}

export function removeZoomContexts(text: string): string {
  return text.replace(CONTEXT_PATTERN, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function extractFileTagPaths(text: string): string[] {
  return Array.from(text.matchAll(FILE_TAG_PATTERN), (match) => decodeXmlAttribute(match[1] ?? ""));
}

/** Drop Pi's resize note; it describes a preview this extension has replaced. */
export function removePiDimensionNotes(text: string): string {
  return text.replace(PI_DIMENSION_NOTE_PATTERN, "");
}

function describeCoordinateFrame(metadata: ZoomContextMetadata): string {
  const { sourceId, imageIndex, view, original } = metadata;
  const same = view.width === original.width && view.height === original.height;
  if (same) {
    return `${sourceId} (image_index ${imageIndex}): zoom_image coordinates are pixels of this ${view.width}x${view.height} image.`;
  }
  const scale = (original.width / view.width).toFixed(2);
  return `${sourceId} (image_index ${imageIndex}): zoom_image coordinates are pixels of the ${original.width}x${original.height} original. The attached picture is a ${view.width}x${view.height} preview; multiply preview coordinates by ${scale}.`;
}

export function buildZoomContextBlock(metadata: ZoomContextMetadata[]): string {
  if (metadata.length === 0) return "";
  return [
    ...metadata.map(encodeZoomContext),
    ...metadata.map(describeCoordinateFrame),
    "Use zoom_image when fine detail is too small to read. A returned zoom:N source can be zoomed again using coordinates in that crop's returned pixel size.",
  ].join("\n");
}
