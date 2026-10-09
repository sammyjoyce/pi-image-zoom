import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { join } from "node:path";
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
      { image_index: 0, x1: 650, y1: 140, x2: 1000, y2: 500 },
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
