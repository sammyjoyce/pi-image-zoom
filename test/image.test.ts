import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { cropAndMagnify, getOrientedDimensions, prepareOverview, saveCrop, saveFormatForPath } from "../src/image.ts";

const tinyProfile = { name: "standard" as const, maxEdge: 280, maxPatches: 100 };
const encodeOptions = { maxBase64Bytes: 1_000_000, jpegQuality: 92 };

async function makeTestImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="800" height="400"><rect x="300" y="120" width="200" height="160" fill="#111"/><text x="330" y="210" font-size="30" fill="white">DETAIL</text></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
}

test("save formats follow the file extension without case sensitivity", () => {
  for (const [path, format] of [["crop.PNG", "png"], ["crop.jpg", "jpeg"], ["crop.JPEG", "jpeg"], ["crop.webp", "webp"]] as const) {
    assert.equal(saveFormatForPath(path), format);
  }
  assert.equal(saveFormatForPath("crop.gif"), undefined);
  assert.equal(saveFormatForPath("crop"), undefined);
});

test("saves a PNG with the source crop's dimensions and pixels", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "crop.png");
  const saved = await saveCrop(
    await makeTestImage(),
    { left: 250, top: 100, width: 300, height: 200 },
    path,
    "png",
    encodeOptions,
  );

  assert.deepEqual(saved, { path, format: "png", width: 300, height: 200 });
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 300);
  assert.equal(info.height, 200);
  const inside = (40 * info.width + 100) * info.channels;
  const outside = (10 * info.width + 10) * info.channels;
  assert.deepEqual([...data.subarray(inside, inside + 3)], [17, 17, 17], "the rectangle keeps its source pixels");
  assert.deepEqual([...data.subarray(outside, outside + 3)], [245, 245, 245], "the background keeps its source pixels");
});

test("saves EXIF orientation 6 crops in the oriented coordinate frame", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-oriented-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } })
    .composite([{
      input: await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).png().toBuffer(),
      left: 0,
      top: 0,
    }])
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  const path = join(dir, "oriented.png");
  await saveCrop(input, { left: 25, top: 5, width: 15, height: 20 }, path, "png", encodeOptions);

  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 15);
  assert.equal(info.height, 20);
  const inside = (5 * info.width + 10) * info.channels;
  const outside = (5 * info.width + 2) * info.channels;
  assert.deepEqual([...data.subarray(inside, inside + 3)], [255, 0, 0], "rotation places the red rectangle at the oriented right edge");
  assert.deepEqual([...data.subarray(outside, outside + 3)], [255, 255, 255], "the oriented crop includes white left of the rectangle");
});

test("PNG and lossless WebP preserve alpha while JPEG flattens onto white", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-alpha-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = await sharp(Buffer.from([12, 34, 56, 128, 0, 0, 0, 0]), {
    raw: { width: 2, height: 1, channels: 4 },
  }).png().toBuffer();

  for (const format of ["png", "webp"] as const) {
    const path = join(dir, `crop.${format}`);
    await saveCrop(input, { left: 0, top: 0, width: 2, height: 1 }, path, format, encodeOptions);
    assert.equal((await sharp(path).metadata()).format, format);
    const data = await sharp(path).raw().toBuffer();
    assert.deepEqual([...data.subarray(0, 4)], [12, 34, 56, 128], `${format} preserves colour and alpha`);
    assert.equal(data[7], 0, `${format} preserves full transparency`);
  }
  const path = join(dir, "white.jpg");
  await saveCrop(input, { left: 1, top: 0, width: 1, height: 1 }, path, "jpeg", encodeOptions);
  assert.deepEqual([...(await sharp(path).raw().toBuffer())], [255, 255, 255], "JPEG flattens transparency onto white");
});

test("a jpg save path writes a JPEG", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-jpeg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "crop.jpg");
  await saveCrop(await makeTestImage(), { left: 300, top: 120, width: 200, height: 160 }, path, "jpeg", encodeOptions);
  assert.equal((await sharp(path).metadata()).format, "jpeg");
});

test("prepares a calibrated overview within the image budget", async () => {
  const input = await makeTestImage();
  assert.deepEqual(await getOrientedDimensions(input), { width: 800, height: 400 });

  const overview = await prepareOverview(input, tinyProfile, encodeOptions);
  assert.equal(overview.original.width, 800);
  assert.equal(overview.original.height, 400);
  assert.ok(overview.width <= 280);
  assert.ok(overview.height <= 280);
  assert.ok(overview.data.length <= encodeOptions.maxBase64Bytes);
});

test("crops from the source and magnifies the result", async () => {
  const input = await makeTestImage();
  const result = await cropAndMagnify(
    input,
    { left: 300, top: 120, width: 200, height: 160 },
    tinyProfile,
    "jpeg",
    encodeOptions,
  );

  assert.equal(result.mimeType, "image/jpeg");
  assert.ok(result.width > 200 || result.height > 160);
  const decoded = await sharp(Buffer.from(result.data, "base64")).metadata();
  assert.equal(decoded.width, result.width);
  assert.equal(decoded.height, result.height);
});
