# pi-image-zoom

A Pi extension that gives multimodal models an iterative **lean in and look closer** tool.

The extension registers `zoom_image`, which accepts an absolute pixel rectangle, crops that region from the full-resolution source, magnifies it up to 2x within the image budget, and returns the crop as the tool result. It is based on the design in Anthropic's [`crop_tool.ipynb`](https://github.com/anthropics/claude-cookbooks/blob/main/multimodal/crop_tool.ipynb), adapted for Pi's extension and session model.

## What is different from a basic crop command

- **Coordinate-calibrated inputs.** Attached, pasted, dropped, and `read` images are prepared before the model sees them, and Pi receives the exact visible dimensions in a small context block.
- **Full-resolution crops.** File-backed images are always cropped from the original file, not the overview sent to the model.
- **Recursive zoom without generation loss.** Every crop gets a `zoom:N` source ID whose coordinate space maps back to the original image. A second zoom therefore crops the original pixels again rather than cropping the enlarged JPEG.
- **Multiple images.** The model can select `image_index`, `source_id`, or a direct `path`.
- **Provider-safe history.** Zoom results default to high-quality 4:4:4 JPEG and are kept below a configurable base64 payload budget. PNG remains available for tiny text and line art.
- **Branch-aware state.** Root images and zoom transforms are reconstructed from the active Pi session branch after resume, reload, or tree navigation.

## Install

From this directory:

```bash
npm install
pi install .
```

Try it without adding it to settings:

```bash
npm install
pi -e .
```

For project-local installation:

```bash
npm install
pi install -l .
```

Pi packages execute with the permissions of the Pi process. Review `extensions/image-zoom.ts` before installing.

Pi loads the extension from this directory, so it uses this directory's `node_modules`. If Pi reports `Cannot find module 'sharp'`, the dependencies are not installed. Run this here, then restart Pi:

```bash
npm ci
```

## Use

Attach an image in any normal Pi way, then ask a question that may require fine detail:

```text
@dense-chart.png At month 48, which line is higher? Zoom as needed before answering.
```

Pi injects metadata similar to:

```text
image:0 (image_index 0): zoom_image coordinates are pixels of the 4032x2366 original. The attached picture is a 1432x840 preview; multiply preview coordinates by 2.82.
```

The model can then call, in original pixels:

```json
{
  "image_index": 0,
  "x1": 1520,
  "y1": 590,
  "x2": 2540,
  "y2": 1470
}
```

The result reports a recursive source, for example `zoom:0`, and its new coordinate space. A tighter pass uses that source directly:

```json
{
  "source_id": "zoom:0",
  "x1": 700,
  "y1": 250,
  "x2": 1500,
  "y2": 900,
  "output_format": "png"
}
```

You can inspect the registry manually with:

```text
/zoom-images
```

### Direct filesystem images

`zoom_image` can operate on an image that was not attached:

```json
{
  "path": "./screenshots/settings.png",
  "x1": 100,
  "y1": 80,
  "x2": 600,
  "y2": 420
}
```

When the model saw an externally resized copy rather than an image calibrated by this extension, it can also pass `view_width` and `view_height` so coordinates map back to the original.

## Profiles

The default is the cookbook's broadly compatible standard image budget:

| Profile | Maximum padded edge | Maximum 28×28 patches |
| --- | ---: | ---: |
| `standard` | 1568 px | 1568 |
| `high` | 2576 px | 4784 |

Set the default before starting Pi:

```bash
export PI_IMAGE_ZOOM_PROFILE=high
```

A tool call can override it with `"profile": "high"` or `"profile": "standard"`.

## Configuration

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `PI_IMAGE_ZOOM_PROFILE` | `standard` | Default `standard` or `high` image budget |
| `PI_IMAGE_ZOOM_MAX_BASE64_BYTES` | 4.5 MiB | Maximum encoded payload for each overview or crop |
| `PI_IMAGE_ZOOM_MAX_SOURCE_BYTES` | 100 MiB | Maximum filesystem source file size |
| `PI_IMAGE_ZOOM_JPEG_QUALITY` | `92` | First JPEG quality attempted before stepping down |

## Source fidelity

For `@file`, drag/drop paths, and images loaded through Pi's `read` tool, the extension retains the path and crops the full-resolution original on every call.

Clipboard-only images have no durable source path. The extension uses the calibrated image Pi received as their root so coordinates and resumed sessions stay deterministic; it cannot recover pixels that were already discarded before the extension received the attachment.

## Development

Use Node.js 22.19 or newer, matching current Pi releases.

```bash
npm install
npm run check
npm run pack:check
```

The tests cover budget sizing, coordinate clamping/mapping, context persistence, overview preparation, crop magnification, recursive zooms, built-in `read` interception, commands, and session restoration.

## Attribution

The coordinate-space and budget-filling crop pattern is inspired by Anthropic's MIT-licensed Claude cookbook. This package is an independent TypeScript implementation for Pi and is also MIT licensed.
