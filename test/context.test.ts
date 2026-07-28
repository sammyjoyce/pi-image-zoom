import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZoomContextBlock,
  extractFileTagPaths,
  parseZoomContexts,
  removeZoomContexts,
  type ZoomContextMetadata,
} from "../src/context.ts";

const metadata: ZoomContextMetadata = {
  version: 1,
  imageIndex: 2,
  sourceId: "image:2",
  contentImageIndex: 0,
  origin: "attachment",
  view: { width: 1200, height: 800 },
  original: { width: 4800, height: 3200 },
  path: "/tmp/chart.png",
};

test("round-trips zoom context metadata", () => {
  const block = buildZoomContextBlock([metadata]);
  assert.deepEqual(parseZoomContexts(block), [metadata]);
  assert.equal(removeZoomContexts(block).includes("pi-image-zoom-context"), false);
});

test("extracts and decodes Pi file tags", () => {
  const text = '<file name="/tmp/a&amp;b.png"></file>\n<file name="/tmp/notes.txt">x</file>';
  assert.deepEqual(extractFileTagPaths(text), ["/tmp/a&b.png", "/tmp/notes.txt"]);
});
