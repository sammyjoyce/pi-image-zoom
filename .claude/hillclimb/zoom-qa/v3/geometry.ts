export const IMAGE_PATCH_SIZE = 28;

export interface Dimensions {
  width: number;
  height: number;
}

export interface ImageBudget {
  maxEdge: number;
  maxPatches: number;
}

export interface CoordinateBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function countImagePatches(width: number, height: number): number {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  return Math.ceil(width / IMAGE_PATCH_SIZE) * Math.ceil(height / IMAGE_PATCH_SIZE);
}

/**
 * Find the exact aspect-preserving size that fits a model image budget.
 *
 * This is a TypeScript adaptation of the reference approach used by the
 * Anthropic crop-tool cookbook: fit both padded edge limits and 28px-patch
 * limits, using binary search on the long edge.
 */
export function resizedSize(width: number, height: number, budget: ImageBudget): Dimensions {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  assertPositiveInteger(budget.maxEdge, "budget.maxEdge");
  assertPositiveInteger(budget.maxPatches, "budget.maxPatches");

  const fits = (candidateWidth: number, candidateHeight: number): boolean =>
    Math.ceil(candidateWidth / IMAGE_PATCH_SIZE) * IMAGE_PATCH_SIZE <= budget.maxEdge &&
    Math.ceil(candidateHeight / IMAGE_PATCH_SIZE) * IMAGE_PATCH_SIZE <= budget.maxEdge &&
    countImagePatches(candidateWidth, candidateHeight) <= budget.maxPatches;

  if (fits(width, height)) {
    return { width, height };
  }

  if (height > width) {
    const transposed = resizedSize(height, width, budget);
    return { width: transposed.height, height: transposed.width };
  }

  const aspectRatio = width / height;
  let low = 1;
  let high = width;

  while (low + 1 < high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidateHeight = Math.max(Math.round(midpoint / aspectRatio), 1);
    if (fits(midpoint, candidateHeight)) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return {
    width: low,
    height: Math.max(Math.round(low / aspectRatio), 1),
  };
}

/** Return the largest aspect-preserving output that fills the configured budget. */
/**
 * Crops are magnified at most this much. Beyond 2x the model reads no more
 * detail, but every extra pixel is image tokens it re-reads on later turns.
 */
export const MAX_ZOOM_MAGNIFICATION = 2;

export function zoomSize(width: number, height: number, budget: ImageBudget): Dimensions {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  return resizedSize(width * MAX_ZOOM_MAGNIFICATION, height * MAX_ZOOM_MAGNIFICATION, budget);
}

export function clampCoordinateBox(
  box: CoordinateBox,
  viewWidth: number,
  viewHeight: number,
): CoordinateBox | undefined {
  assertPositiveInteger(viewWidth, "viewWidth");
  assertPositiveInteger(viewHeight, "viewHeight");

  const x1 = Math.max(0, Math.min(Math.floor(box.x1), viewWidth));
  const y1 = Math.max(0, Math.min(Math.floor(box.y1), viewHeight));
  const x2 = Math.max(0, Math.min(Math.ceil(box.x2), viewWidth));
  const y2 = Math.max(0, Math.min(Math.ceil(box.y2), viewHeight));

  if (x1 >= x2 || y1 >= y2) {
    return undefined;
  }

  return { x1, y1, x2, y2 };
}

/**
 * Map a box from a visible image coordinate space into a rectangle of the
 * full-resolution root image. Floor/ceil retain boundary pixels.
 */
export function mapViewBoxToRoot(
  viewBox: CoordinateBox,
  view: Dimensions,
  rootRect: PixelBox,
  root: Dimensions,
): PixelBox {
  assertPositiveInteger(view.width, "view.width");
  assertPositiveInteger(view.height, "view.height");
  assertPositiveInteger(root.width, "root.width");
  assertPositiveInteger(root.height, "root.height");
  assertPositiveInteger(rootRect.width, "rootRect.width");
  assertPositiveInteger(rootRect.height, "rootRect.height");

  const rawLeft = rootRect.left + (viewBox.x1 / view.width) * rootRect.width;
  const rawTop = rootRect.top + (viewBox.y1 / view.height) * rootRect.height;
  const rawRight = rootRect.left + (viewBox.x2 / view.width) * rootRect.width;
  const rawBottom = rootRect.top + (viewBox.y2 / view.height) * rootRect.height;

  const left = Math.max(0, Math.min(Math.floor(rawLeft), root.width - 1));
  const top = Math.max(0, Math.min(Math.floor(rawTop), root.height - 1));
  const right = Math.max(left + 1, Math.min(Math.ceil(rawRight), root.width));
  const bottom = Math.max(top + 1, Math.min(Math.ceil(rawBottom), root.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
