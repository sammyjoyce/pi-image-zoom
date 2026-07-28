import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cropAndMagnify, getOrientedDimensions, prepareOverview } from "../src/image.ts";

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
