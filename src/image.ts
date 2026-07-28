import sharp from "sharp";
import type { Dimensions, ImageBudget, PixelBox } from "./geometry.ts";
import { resizedSize, zoomSize } from "./geometry.ts";

export type ImageInput = Buffer | string;
export type OutputFormat = "jpeg" | "png";
export type ProfileName = "standard" | "high";

export interface ImageProfile extends ImageBudget {
  name: ProfileName;
}

export const IMAGE_PROFILES: Record<ProfileName, ImageProfile> = {
  standard: { name: "standard", maxEdge: 1568, maxPatches: 1568 },
  high: { name: "high", maxEdge: 2576, maxPatches: 4784 },
};

export interface EncodedImage extends Dimensions {
  data: string;
  mimeType: "image/jpeg" | "image/png";
  format: OutputFormat;
  base64Bytes: number;
}

export interface PreparedOverview extends EncodedImage {
  original: Dimensions;
}

export interface EncodeOptions {
  maxBase64Bytes: number;
  jpegQuality: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
}

function orientedDimensionsFromMetadata(metadata: sharp.Metadata): Dimensions {
  if (!metadata.width || !metadata.height) {
    throw new Error("Image dimensions could not be determined");
  }
  const swapsAxes = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

export async function getOrientedDimensions(input: ImageInput): Promise<Dimensions> {
  const metadata = await sharp(input, { animated: false, failOn: "warning" }).metadata();
  return orientedDimensionsFromMetadata(metadata);
}

interface RawImage extends Dimensions {
  data: Buffer;
  channels: 1 | 2 | 3 | 4;
}

async function renderRaw(
  input: ImageInput,
  target: Dimensions,
  extract: PixelBox | undefined,
  signal?: AbortSignal,
): Promise<RawImage> {
  throwIfAborted(signal);

  let pipeline = sharp(input, { animated: false, failOn: "warning" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace("srgb");

  if (extract) {
    pipeline = pipeline.extract(extract);
  }

  const rendered = await pipeline
    .resize({
      width: target.width,
      height: target.height,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  throwIfAborted(signal);
  const channels = rendered.info.channels;
  if (channels < 1 || channels > 4) {
    throw new Error(`Unsupported rendered channel count: ${channels}`);
  }

  return {
    data: rendered.data,
    width: rendered.info.width,
    height: rendered.info.height,
    channels: channels as 1 | 2 | 3 | 4,
  };
}

async function encodeRaw(raw: RawImage, format: OutputFormat, jpegQuality: number): Promise<EncodedImage> {
  let encoder = sharp(raw.data, {
    raw: {
      width: raw.width,
      height: raw.height,
      channels: raw.channels,
    },
  });

  if (format === "jpeg") {
    encoder = encoder.jpeg({
      quality: jpegQuality,
      chromaSubsampling: "4:4:4",
      optimiseCoding: true,
    });
  } else {
    encoder = encoder.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    });
  }

  const buffer = await encoder.toBuffer();
  const data = buffer.toString("base64");
  return {
    data,
    width: raw.width,
    height: raw.height,
    format,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    base64Bytes: Buffer.byteLength(data, "utf8"),
  };
}

function qualitySteps(preferred: number): number[] {
  return Array.from(new Set([preferred, 92, 85, 78, 70, 60, 50])).filter(
    (quality) => Number.isInteger(quality) && quality >= 1 && quality <= 100,
  );
}

function nextSmallerSize(size: Dimensions): Dimensions {
  return {
    width: size.width === 1 ? 1 : Math.max(1, Math.floor(size.width * 0.85)),
    height: size.height === 1 ? 1 : Math.max(1, Math.floor(size.height * 0.85)),
  };
}

async function renderWithinBudget(
  input: ImageInput,
  initialTarget: Dimensions,
  extract: PixelBox | undefined,
  format: OutputFormat,
  options: EncodeOptions,
): Promise<EncodedImage> {
  let target = initialTarget;

  for (let attempt = 0; attempt < 16; attempt++) {
    const raw = await renderRaw(input, target, extract, options.signal);
    const qualities = format === "jpeg" ? qualitySteps(options.jpegQuality) : [options.jpegQuality];

    for (const quality of qualities) {
      throwIfAborted(options.signal);
      const encoded = await encodeRaw(raw, format, quality);
      if (encoded.base64Bytes <= options.maxBase64Bytes) {
        return encoded;
      }
    }

    const smaller = nextSmallerSize(target);
    if (smaller.width === target.width && smaller.height === target.height) break;
    target = smaller;
  }

  throw new Error(`Could not encode image below ${options.maxBase64Bytes} base64 bytes`);
}

export async function prepareOverview(
  input: ImageInput,
  profile: ImageProfile,
  options: EncodeOptions,
): Promise<PreparedOverview> {
  const original = await getOrientedDimensions(input);
  const target = resizedSize(original.width, original.height, profile);
  const raw = await renderRaw(input, target, undefined, options.signal);

  const png = await encodeRaw(raw, "png", options.jpegQuality);
  if (png.base64Bytes <= options.maxBase64Bytes) {
    return { ...png, original };
  }

  for (const quality of qualitySteps(options.jpegQuality)) {
    const jpeg = await encodeRaw(raw, "jpeg", quality);
    if (jpeg.base64Bytes <= options.maxBase64Bytes) {
      return { ...jpeg, original };
    }
  }

  const encoded = await renderWithinBudget(input, nextSmallerSize(target), undefined, "jpeg", options);
  return { ...encoded, original };
}

export async function cropAndMagnify(
  input: ImageInput,
  crop: PixelBox,
  profile: ImageProfile,
  format: OutputFormat,
  options: EncodeOptions,
): Promise<EncodedImage> {
  const target = zoomSize(crop.width, crop.height, profile);
  return renderWithinBudget(input, target, crop, format, options);
}
