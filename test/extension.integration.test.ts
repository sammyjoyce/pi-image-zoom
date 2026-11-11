import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import test from "node:test";
import { basename, join } from "node:path";
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import sharp from "sharp";
import imageZoomExtension from "../extensions/image-zoom.ts";
import { parseZoomContexts } from "../src/context.ts";

class MockPi {
  handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  tools = new Map<string, any>();
  commands = new Map<string, any>();

  on(name: string, handler: (event: any, ctx: any) => any): void {
    const existing = this.handlers.get(name) ?? [];
    existing.push(handler);
    this.handlers.set(name, existing);
  }

  registerTool(tool: any): void {
    this.tools.set(tool.name, tool);
  }

  registerCommand(name: string, command: any): void {
    this.commands.set(name, command);
  }

  async emit(name: string, event: any, ctx: any): Promise<any[]> {
    const results: any[] = [];
    for (const handler of this.handlers.get(name) ?? []) {
      results.push(await handler(event, ctx));
    }
    return results;
  }
}

function makeContext(cwd: string, branch: any[] = []) {
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  return {
    cwd,
    signal: undefined,
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus(key: string, text: string | undefined) {
        statuses.push({ key, text });
      },
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    notifications,
    statuses,
  };
}

async function writeSolidImage(path: string, width: number, height: number, background: string): Promise<void> {
  await sharp({ create: { width, height, channels: 3, background } }).png().toFile(path);
}

async function emitImageResult(pi: MockPi, ctx: any, toolName: string, path: string, extra: Record<string, unknown> = {}) {
  const data = (await readFile(path)).toString("base64");
  const [result] = await pi.emit(
    "tool_result",
    {
      type: "tool_result",
      toolCallId: `${toolName}:${path}`,
      toolName,
      input: { path },
      content: [{ type: "image", data, mimeType: "image/png" }],
      details: undefined,
      isError: false,
      ...extra,
    },
    ctx,
  );
  const text = (result?.content ?? [])
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");
  return { result, contexts: parseZoomContexts(text), text };
}

test("calibrates, recursively zooms, intercepts read, and restores branch state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-integration-"));
  try {
    const imagePath = join(dir, "dense-chart.png");
    const svg = Buffer.from(`
      <svg width="4000" height="2000" xmlns="http://www.w3.org/2000/svg">
        <rect width="4000" height="2000" fill="white"/>
        <g stroke="#c7c7c7" stroke-width="2">
          ${Array.from({ length: 20 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="4000" y2="${i * 100}"/>`).join("")}
          ${Array.from({ length: 40 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="2000"/>`).join("")}
        </g>
        <path d="M 100 1700 C 900 1500, 1300 100, 2100 900 S 3300 1500, 3900 300" fill="none" stroke="#2563eb" stroke-width="12"/>
        <text x="1970" y="810" font-size="26" font-family="sans-serif" fill="#111">peak: 12,345 units</text>
      </svg>`);
    await sharp(svg).png().toFile(imagePath);
    const original = await readFile(imagePath);
    const attached = { type: "image", data: original.toString("base64"), mimeType: "image/png" };

    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);

    const [inputResult] = await pi.emit(
      "input",
      {
        type: "input",
        text: `<file name="${imagePath}"></file>\nRead the small peak annotation precisely.`,
        images: [attached],
        source: "interactive",
      },
      ctx,
    );
    assert.equal(inputResult.action, "transform");
    assert.equal(inputResult.images.length, 1);
    const contexts = parseZoomContexts(inputResult.text);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].sourceId, "image:0");
    assert.equal(contexts[0].imageIndex, 0);
    assert.equal(contexts[0].contentImageIndex, 0);
    assert.deepEqual(contexts[0].original, { width: 4000, height: 2000 });
    assert.ok(contexts[0].view.width <= 1568);
    assert.ok(contexts[0].view.height <= 1568);
    assert.equal(ctx.statuses.at(-1)?.text, undefined);

    const tool = pi.tools.get("zoom_image");
    assert.ok(tool);
    const first = await tool.execute(
      "call-1",
      { source_id: "image:0", x1: 650, y1: 140, x2: 1000, y2: 500 },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(first.details.resultSourceId, "zoom:0");
    assert.equal(first.details.rootId, "image:0");
    assert.equal(first.content[1].type, "image");
    const firstMeta = await sharp(Buffer.from(first.content[1].data, "base64")).metadata();
    assert.equal(firstMeta.width, first.details.output.width);
    assert.equal(firstMeta.height, first.details.output.height);
    assert.ok(first.details.output.width > first.details.clampedBox.x2 - first.details.clampedBox.x1);
    assert.deepEqual(first.details.rootCrop, { left: 650, top: 140, width: 350, height: 360 });
    assert.doesNotMatch(inputResult.text, /Multiply coordinates by/);

    const second = await tool.execute(
      "call-2",
      {
        source_id: "zoom:0",
        x1: Math.floor(first.details.output.width * 0.25),
        y1: Math.floor(first.details.output.height * 0.25),
        x2: Math.ceil(first.details.output.width * 0.75),
        y2: Math.ceil(first.details.output.height * 0.75),
        output_format: "png",
      },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(second.details.resultSourceId, "zoom:1");
    assert.equal(second.details.rootId, "image:0");
    assert.ok(second.details.rootCrop.width < first.details.rootCrop.width);
    assert.ok(second.details.rootCrop.height < first.details.rootCrop.height);
    assert.equal(second.content[1].mimeType, "image/png");

    const unselected = await tool.execute("call-3", { x1: 3000, y1: 1500, x2: 3400, y2: 1800 }, undefined, undefined, ctx);
    assert.equal(unselected.details.sourceId, "image:0");
    assert.deepEqual(unselected.details.rootCrop, { left: 3000, top: 1500, width: 400, height: 300 });

    const [readResult] = await pi.emit(
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "read-1",
        toolName: "read",
        input: { path: imagePath },
        content: [{ type: "text", text: "Read image file [image/png]" }, attached],
        details: undefined,
        isError: false,
      },
      ctx,
    );
    assert.ok(readResult);
    const readContextText = readResult.content.find((part: any) => part.type === "text" && part.text.includes("pi-image-zoom-context"));
    assert.ok(readContextText);
    const readContexts = parseZoomContexts(readContextText.text);
    assert.equal(readContexts[0].imageIndex, 1);
    assert.equal(readContexts[0].origin, "read");
    assert.equal(readContexts[0].contentImageIndex, 0);

    await pi.commands.get("zoom-images").handler("", ctx);
    assert.match(ctx.notifications.at(-1)?.message ?? "", /image:0/);
    assert.match(ctx.notifications.at(-1)?.message ?? "", /zoom:1/);

    const branch = [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: inputResult.text }, ...inputResult.images],
          timestamp: Date.now(),
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "zoom_image",
          content: first.content,
          details: first.details,
          isError: false,
          timestamp: Date.now(),
        },
      },
    ];

    const restoredPi = new MockPi();
    imageZoomExtension(restoredPi as any);
    const restoredCtx = makeContext(dir, branch);
    await restoredPi.emit("session_start", { type: "session_start", reason: "resume" }, restoredCtx);
    const restored = await restoredPi.tools.get("zoom_image").execute(
      "call-restored",
      {
        source_id: "zoom:0",
        x1: 0,
        y1: 0,
        x2: Math.floor(first.details.output.width / 2),
        y2: Math.floor(first.details.output.height / 2),
      },
      undefined,
      undefined,
      restoredCtx,
    );
    assert.equal(restored.details.rootId, "image:0");
    assert.equal(restored.details.resultSourceId, "zoom:1");
    assert.ok(restored.details.rootCrop.width < first.details.rootCrop.width);

  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("zoom_image parameters accept, coerce, and reject arguments through Pi's validator", () => {
  const pi = new MockPi();
  imageZoomExtension(pi as any);
  const tool = pi.tools.get("zoom_image");
  const validate = (args: JsonObject) =>
    validateToolArguments(tool, { type: "toolCall", id: "call", name: "zoom_image", arguments: args });
  const box = { x1: 10, y1: 20, x2: 300, y2: 400 };

  assert.deepEqual(validate(box), box);
  assert.deepEqual(validate({ ...box, path: "a.png", profile: "high", output_format: "png" }), {
    ...box,
    path: "a.png",
    profile: "high",
    output_format: "png",
  });
  assert.deepEqual(validate({ x1: "10", y1: "20", x2: "300", y2: "400" }), box);
  assert.deepEqual(validate({ ...box, source_id: null, path: null, profile: null, output_format: null }), box);

  assert.throws(() => validate({ x1: 1, y1: 2, x2: 3 }), /y2: missing/);
  assert.throws(() => validate({ ...box, image_index: 0 }), /image_index: unknown field/);
  assert.deepEqual(validate(tool.prepareArguments({ ...box, image_index: 2 })), { ...box, source_id: "image:2" });
  assert.deepEqual(validate(tool.prepareArguments({ ...box, image_index: 2, source_id: "image:1" })), {
    ...box,
    source_id: "image:1",
  });
  assert.deepEqual(validate(tool.prepareArguments({ ...box, image_index: 0, source_id: null })), {
    ...box,
    source_id: "image:0",
  });
  for (const sent of ["0", " 0 ", "0.0", "0e0", "+0", "-0", 0.4, false]) {
    assert.deepEqual(validate(tool.prepareArguments({ ...box, image_index: sent })), { ...box, source_id: "image:0" });
  }
  assert.throws(() => validate(tool.prepareArguments({ ...box, image_index: "first" })), /image_index: unknown field/);
  assert.throws(() => validate(tool.prepareArguments({ ...box, image_index: -1 })), /image_index: unknown field/);
  assert.deepEqual(
    validate(tool.prepareArguments({ ...box, path: "a.png", image_index: null, view_width: null, view_height: null })),
    { ...box, path: "a.png" },
  );
  assert.throws(() => validate({ ...box, view_width: 800, view_height: 600 }), /view_width: unknown field/);
  assert.throws(() => validate({ ...box, profile: "null" }), /profile: expected/);
  assert.throws(() => validate({ ...box, output_format: "gif" }), /output_format: expected/);
  assert.throws(() => validate({ ...box, zoom: 2 }), /zoom: unknown field/);
});

test("read results handled at the same time get separate image ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-parallel-"));
  try {
    const images = [
      { path: join(dir, "red.png"), width: 1000, height: 600, background: "#ff0000" },
      { path: join(dir, "green.png"), width: 800, height: 800, background: "#00ff00" },
      { path: join(dir, "blue.png"), width: 3000, height: 400, background: "#0000ff" },
    ];
    for (const image of images) await writeSolidImage(image.path, image.width, image.height, image.background);

    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const registered = await Promise.all(images.map((image) => emitImageResult(pi, ctx, "read", image.path)));
    assert.equal(new Set(registered.map(({ contexts }) => contexts[0].sourceId)).size, images.length);

    const tool = pi.tools.get("zoom_image");
    for (const image of images) {
      const zoomed = await tool.execute("call", { path: image.path, x1: 0, y1: 0, x2: 100, y2: 100 }, undefined, undefined, ctx);
      assert.equal(zoomed.details.root.path, image.path);
      assert.deepEqual(
        { width: zoomed.details.root.width, height: zoomed.details.root.height },
        { width: image.width, height: image.height },
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("placeholder values for unused parameters are ignored", () => {
  const pi = new MockPi();
  imageZoomExtension(pi as any);
  const tool = pi.tools.get("zoom_image");
  const validate = (args: JsonObject) =>
    validateToolArguments(tool, {
      type: "toolCall",
      id: "call",
      name: "zoom_image",
      arguments: tool.prepareArguments(args),
    });
  const box = { x1: 0, y1: 480, x2: 953, y2: 960 };

  assert.deepEqual(
    validate({ ...box, path: "page.png", source_id: "null", profile: "null", output_format: "null", extra: null }),
    { ...box, path: "page.png" },
  );
  assert.deepEqual(validate({ ...box, source_id: "image:0", path: "null", profile: "high" }), {
    ...box,
    source_id: "image:0",
    profile: "high",
  });
  assert.throws(() => validate({ ...box, x1: "null" }), /x1: missing/);
});

test("source_id and path may both be sent when they name the same image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-selectors-"));
  try {
    const red = join(dir, "red.png");
    const green = join(dir, "green.png");
    await writeSolidImage(red, 1000, 600, "#ff0000");
    await writeSolidImage(green, 800, 800, "#00ff00");

    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const { contexts } = await emitImageResult(pi, ctx, "read", red);
    const tool = pi.tools.get("zoom_image");
    const box = { x1: 0, y1: 0, x2: 100, y2: 100 };

    const same = await tool.execute("call", { ...box, source_id: contexts[0].sourceId, path: red }, undefined, undefined, ctx);
    assert.equal(same.details.root.path, red);

    const alias = join(dir, "alias.png");
    await symlink(red, alias);
    const linked = await tool.execute("call", { ...box, source_id: contexts[0].sourceId, path: alias }, undefined, undefined, ctx);
    assert.equal(linked.details.root.path, red);

    await assert.rejects(
      tool.execute("call", { ...box, source_id: same.details.resultSourceId, path: red }, undefined, undefined, ctx),
      /source_id "zoom:0" and path ".*red\.png" name different images/,
    );

    await assert.rejects(
      tool.execute("call", { ...box, source_id: contexts[0].sourceId, path: green }, undefined, undefined, ctx),
      /source_id "image:0" and path ".*green\.png" name different images/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a read of a path with a narrow space in a folder name registers the file Pi opened", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-folder-"));
  try {
    const plainDir = join(dir, "shots here");
    const narrowDir = join(dir, "shots\u202Fhere");
    await mkdir(plainDir);
    await mkdir(narrowDir);
    const piReads = join(plainDir, "capture 1 PM.png");
    await writeSolidImage(piReads, 900, 500, "#ff0000");
    await writeSolidImage(join(narrowDir, "capture 1\u202FPM.png"), 700, 300, "#0000ff");

    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const typed = join(narrowDir, "capture 1 PM.png");
    const read = await emitImageResult(pi, makeContext(dir), "read", piReads, { input: { path: typed } });
    assert.equal(read.contexts[0].path, piReads);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a read of a name that starts with a space or sits in quotes registers the file Pi opened", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-literal-"));
  try {
    const cases = [
      { typed: " Screenshot 5.00.00 PM.png", neighbour: "Screenshot 5.00.00\u202FPM.png" },
      { typed: "'Screenshot 6.00.00 PM.png'", neighbour: "Screenshot 6.00.00\u202FPM.png" },
    ];
    for (const { typed, neighbour } of cases) {
      const piReads = join(dir, typed);
      await writeSolidImage(piReads, 900, 500, "#ff0000");
      await writeSolidImage(join(dir, neighbour), 700, 300, "#0000ff");
      const pi = new MockPi();
      imageZoomExtension(pi as any);
      const read = await emitImageResult(pi, makeContext(dir), "read", piReads, { input: { path: typed } });
      assert.equal(read.contexts[0].path, piReads);
    }

    // Pi joins "~//name" under the home directory. A resolver that treats "/name" as absolute
    // would look at the root of the disk.
    const home = await realpath(homedir());
    const underHome = await mkdtemp(join(home, ".pi-image-zoom-test-"));
    try {
      const piReads = join(underHome, "shot 7.00.00 PM.png");
      await writeSolidImage(piReads, 900, 500, "#ff0000");
      const typed = `~//${basename(underHome)}/shot 7.00.00 PM.png`;
      const pi = new MockPi();
      imageZoomExtension(pi as any);
      const read = await emitImageResult(pi, makeContext(dir), "read", piReads, { input: { path: typed } });
      assert.equal(read.contexts[0].path, piReads);
    } finally {
      await rm(underHome, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a macOS screenshot name typed with a plain space resolves to the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-screenshot-"));
  try {
    const onDisk = join(dir, "Screenshot 2026-10-15 at 4.40.17\u202Fpm.png");
    const typed = join(dir, "Screenshot 2026-10-15 at 4.40.17 pm.png");
    await writeSolidImage(onDisk, 3000, 1600, "#336699");

    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const tool = pi.tools.get("zoom_image");

    const zoomed = await tool.execute("call", { path: typed, x1: 0, y1: 0, x2: 100, y2: 100 }, undefined, undefined, ctx);
    assert.equal(zoomed.details.root.path, onDisk);

    const fresh = new MockPi();
    imageZoomExtension(fresh as any);
    const { contexts } = await emitImageResult(fresh, ctx, "read", onDisk, { input: { path: typed } });
    const [context] = contexts;
    assert.equal(context.path, onDisk);
    assert.deepEqual(context.original, { width: 3000, height: 1600 });

    const exact = await tool.execute("call", { path: onDisk, x1: 0, y1: 0, x2: 100, y2: 100 }, undefined, undefined, ctx);
    assert.equal(exact.details.root.path, onDisk);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a read made by another tool keeps its result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-nested-"));
  try {
    const path = join(dir, "red.png");
    await writeSolidImage(path, 1000, 600, "#ff0000");
    const pi = new MockPi();
    imageZoomExtension(pi as any);

    const ctx = makeContext(dir);
    const { result } = await emitImageResult(pi, ctx, "read", path, {
      toolCallId: "script-1/1",
      parentToolCallId: "script-1",
      structuredContent: { type: "image", mimeType: "image/png" },
    });
    assert.equal(result, undefined);

    const zoomed = await pi.tools
      .get("zoom_image")
      .execute("call", { x1: 0, y1: 0, x2: 100, y2: 100 }, undefined, undefined, ctx);
    assert.equal(zoomed.details.root.path, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an image from another tool becomes a zoom source in its original frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-tool-"));
  try {
    const screenshot = join(dir, "screenshot.png");
    const second = join(dir, "second.png");
    await writeSolidImage(screenshot, 4040, 2320, "#224466");
    await writeSolidImage(second, 640, 480, "#664422");
    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const tool = pi.tools.get("zoom_image");

    const structuredContent = { windows: 3 };
    const { result, contexts } = await emitImageResult(pi, ctx, "desktop", screenshot, { input: {}, structuredContent });
    assert.equal(result.content[0].data, (await readFile(screenshot)).toString("base64"));
    assert.deepEqual(result.structuredContent, structuredContent);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].origin, "tool");
    assert.deepEqual(contexts[0].original, { width: 4040, height: 2320 });
    assert.match(result.content.at(-1).text, /image:0: zoom_image coordinates are pixels of the 4040x2320 original\./);

    const box = { x1: 220, y1: 2060, x2: 960, y2: 2180 };
    const zoomed = await tool.execute("call", box, undefined, undefined, ctx);
    assert.equal(zoomed.details.sourceId, "image:0");
    assert.deepEqual(zoomed.details.rootCrop, { left: 220, top: 2060, width: 740, height: 120 });

    const images = [screenshot, second].map(async (path) => ({
      type: "image",
      data: (await readFile(path)).toString("base64"),
      mimeType: "image/png",
    }));
    const [several] = await pi.emit(
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "script-1",
        toolName: "codemode",
        input: {},
        content: [{ type: "text", text: "Script completed" }, ...(await Promise.all(images))],
        details: undefined,
        isError: false,
      },
      ctx,
    );
    const severalContexts = parseZoomContexts(several.content.at(-1).text);
    assert.deepEqual(
      severalContexts.map(({ sourceId, contentImageIndex, original }) => ({ sourceId, contentImageIndex, original })),
      [
        { sourceId: "image:1", contentImageIndex: 0, original: { width: 4040, height: 2320 } },
        { sourceId: "image:2", contentImageIndex: 1, original: { width: 640, height: 480 } },
      ],
    );

    const { result: ownResult } = await emitImageResult(pi, ctx, "zoom_image", second, { input: {} });
    assert.equal(ownResult, undefined);

    const displayed = await sharp(screenshot).resize(2000, 1149, { fit: "fill" }).png().toBuffer();
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "desktop-1",
          toolName: "desktop",
          content: [
            { type: "image", data: displayed.toString("base64"), mimeType: "image/png" },
            { type: "text", text: "[Image: original 4040x2320, displayed at 2000x1149. Multiply coordinates by 2.02 to map to original image.]" },
            result.content.at(-1),
          ],
          isError: false,
          timestamp: Date.now(),
        },
      },
    ];
    const restoredPi = new MockPi();
    imageZoomExtension(restoredPi as any);
    const restoredCtx = makeContext(dir, branch);
    await restoredPi.emit("session_start", { type: "session_start", reason: "resume" }, restoredCtx);
    const restored = await restoredPi.tools
      .get("zoom_image")
      .execute("call", { ...box, source_id: "image:0" }, undefined, undefined, restoredCtx);
    assert.deepEqual(
      { width: restored.details.root.width, height: restored.details.root.height },
      { width: 2000, height: 1149 },
    );
    assert.deepEqual(restored.details.rootCrop, { left: 108, top: 1020, width: 368, height: 60 });

    const withCrop = [
      ...branch,
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "zoom-1",
          toolName: "zoom_image",
          content: zoomed.content,
          details: zoomed.details,
          isError: false,
          timestamp: Date.now(),
        },
      },
    ];
    const cropPi = new MockPi();
    imageZoomExtension(cropPi as any);
    const cropCtx = makeContext(dir, withCrop);
    await cropPi.emit("session_start", { type: "session_start", reason: "resume" }, cropCtx);
    const { width, height } = zoomed.details.output;
    const again = await cropPi.tools
      .get("zoom_image")
      .execute("call", { source_id: "zoom:0", x1: 0, y1: 0, x2: width, y2: height }, undefined, undefined, cropCtx);
    assert.deepEqual(again.details.rootCrop, { left: 109, top: 1020, width: 366, height: 59 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only the newest tool images keep their full-size bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-retain-"));
  try {
    const path = join(dir, "shot.png");
    await writeSolidImage(path, 400, 300, "#224466");
    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const tool = pi.tools.get("zoom_image");
    for (let index = 0; index < 9; index++) {
      await emitImageResult(pi, ctx, "desktop", path, { input: {}, toolCallId: `desktop-${index}` });
    }

    const box = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const newest = await tool.execute("call", { ...box, source_id: "image:8" }, undefined, undefined, ctx);
    assert.equal(newest.details.rootId, "image:8");
    const oldestKept = await tool.execute("call", { ...box, source_id: "image:1" }, undefined, undefined, ctx);
    assert.equal(oldestKept.details.rootId, "image:1");
    await assert.rejects(
      tool.execute("call", { ...box, source_id: "image:0" }, undefined, undefined, ctx),
      /image:0 is no longer held in memory/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a zoom with no selector picks the same image before and after a reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-image-zoom-default-"));
  try {
    const first = join(dir, "first.png");
    const second = join(dir, "second.png");
    await writeSolidImage(first, 400, 300, "#224466");
    await writeSolidImage(second, 500, 200, "#664422");
    const pi = new MockPi();
    imageZoomExtension(pi as any);
    const ctx = makeContext(dir);
    const box = { x1: 0, y1: 0, x2: 100, y2: 100 };

    const finishedFirst = await emitImageResult(pi, ctx, "desktop", second, { input: {}, toolCallId: "call-b" });
    const finishedSecond = await emitImageResult(pi, ctx, "desktop", first, { input: {}, toolCallId: "call-a" });
    const live = await pi.tools.get("zoom_image").execute("call", box, undefined, undefined, ctx);

    const message = (toolCallId: string, result: any) => ({
      type: "message",
      message: { role: "toolResult", toolCallId, toolName: "desktop", content: result.content, isError: false, timestamp: Date.now() },
    });
    const restoredPi = new MockPi();
    imageZoomExtension(restoredPi as any);
    const restoredCtx = makeContext(dir, [message("call-a", finishedSecond.result), message("call-b", finishedFirst.result)]);
    await restoredPi.emit("session_start", { type: "session_start", reason: "resume" }, restoredCtx);
    const restored = await restoredPi.tools.get("zoom_image").execute("call", box, undefined, undefined, restoredCtx);

    assert.equal(live.details.sourceId, "image:1");
    assert.equal(restored.details.sourceId, live.details.sourceId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
