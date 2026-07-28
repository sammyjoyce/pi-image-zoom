import type { Dimensions } from "./geometry.ts";

const CONTEXT_OPEN = "<pi-image-zoom-context>";
const CONTEXT_CLOSE = "</pi-image-zoom-context>";
const CONTEXT_PATTERN = /<pi-image-zoom-context>([\s\S]*?)<\/pi-image-zoom-context>/g;
const FILE_TAG_PATTERN = /<file\s+name="([^"]+)"[^>]*>[\s\S]*?<\/file>/g;

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

export function buildZoomContextBlock(metadata: ZoomContextMetadata[]): string {
  if (metadata.length === 0) return "";
  return [
    ...metadata.map(encodeZoomContext),
    "Use zoom_image with one of the listed source_id or image_index values and absolute pixel coordinates when fine detail is too small. The returned source_id can be zoomed again.",
  ].join("\n");
}
