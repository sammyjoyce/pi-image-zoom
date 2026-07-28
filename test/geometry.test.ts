import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCoordinateBox,
  countImagePatches,
  mapViewBoxToRoot,
  resizedSize,
  zoomSize,
} from "../src/geometry.ts";

const standard = { maxEdge: 1568, maxPatches: 1568 };

test("counts one patch per 28x28 region", () => {
  assert.equal(countImagePatches(28, 28), 1);
  assert.equal(countImagePatches(29, 28), 2);
  assert.equal(countImagePatches(57, 57), 9);
});

test("resizedSize leaves fitting images untouched", () => {
  assert.deepEqual(resizedSize(800, 600, standard), { width: 800, height: 600 });
});

test("resizedSize preserves aspect ratio and budget", () => {
  const size = resizedSize(6000, 4000, standard);
  assert.ok(size.width <= standard.maxEdge);
  assert.ok(size.height <= standard.maxEdge);
  assert.ok(countImagePatches(size.width, size.height) <= standard.maxPatches);
  assert.ok(Math.abs(size.width / size.height - 1.5) < 0.01);
});

test("zoomSize expands a small crop to the available budget", () => {
  const size = zoomSize(200, 100, standard);
  assert.ok(size.width > 200);
  assert.equal(size.width / size.height, 2);
  assert.ok(countImagePatches(size.width, size.height) <= standard.maxPatches);
});

test("clampCoordinateBox clips to the visible image", () => {
  assert.deepEqual(clampCoordinateBox({ x1: -10, y1: 5, x2: 120, y2: 200 }, 100, 150), {
    x1: 0,
    y1: 5,
    x2: 100,
    y2: 150,
  });
  assert.equal(clampCoordinateBox({ x1: 20, y1: 20, x2: 10, y2: 30 }, 100, 100), undefined);
});

test("maps nested view coordinates back to the full-resolution root", () => {
  const mapped = mapViewBoxToRoot(
    { x1: 250, y1: 100, x2: 750, y2: 400 },
    { width: 1000, height: 500 },
    { left: 1000, top: 500, width: 2000, height: 1000 },
    { width: 5000, height: 3000 },
  );
  assert.deepEqual(mapped, { left: 1500, top: 700, width: 1000, height: 600 });
});
