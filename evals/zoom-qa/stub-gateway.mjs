#!/usr/bin/env node
// Scripted stand-in for the Messages API, used to wire-check the runner and
// grader without spending anything. Not a model: it reads cases.jsonl, finds
// the case by its question text, and plays a fixed script.
//
//   STUB_MODE=oracle node evals/zoom-qa/stub-gateway.mjs 8787
//   ZOOM_EVAL_BASE_URL=http://127.0.0.1:8787 PI_GATEWAY_KEY=stub node evals/zoom-qa/run-eval.mjs ...
//
// STUB_MODE:
//   oracle   zoom onto the answer region (when zoom_image is offered), then
//            reply with the reference answer            -> expect ~100% correct
//   null     reply "ANSWER: 0" without zooming           -> expect ~0% correct
//   empty    reply with no ANSWER line                   -> expect format_ok 0
//   flaky    first request per case returns 529, then behaves like oracle
//   refuse   stop_reason "refusal" on the first turn
// STUB_MODEL overrides the model id echoed back (to test the served-model check).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cases = readFileSync(join(here, "cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const mode = process.env.STUB_MODE || "oracle";
const port = Number(process.argv[2] || 8787);
const seen = new Set();

function textOf(content) {
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function sse(res, model, blocks, stopReason) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: `msg_stub_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: `toolu_stub_${index}_${Date.now()}`, name: b.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null, ...(stopReason === "refusal" ? { stop_details: { type: "refusal", category: null, explanation: "Stub refusal." } } : {}) }, usage: { output_tokens: 40 } });
  send("message_stop", {});
  res.end();
}

createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.endsWith("/v1/messages")) { res.writeHead(404).end(); return; }
    const params = JSON.parse(body);
    const model = process.env.STUB_MODEL || params.model;
    const firstUser = textOf(params.messages.find((m) => m.role === "user")?.content ?? "");
    // Several cases share a question; the attached file names disambiguate.
    const c = cases.find((x) => firstUser.includes(x.question) && x.images.every((f) => firstUser.includes(`/${f.split("/").pop()}"`)));
    if (!c) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stub: unknown case" } })); return; }

    if (mode === "flaky" && !seen.has(c.id)) {
      seen.add(c.id);
      res.writeHead(529, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
      return;
    }
    if (mode === "refuse") return sse(res, model, [], "refusal");
    if (mode === "null") return sse(res, model, [{ type: "text", text: "It looks like zero.\n\nANSWER: 0" }], "end_turn");
    if (mode === "empty") return sse(res, model, [{ type: "text", text: "I can't tell." }], "end_turn");

    const zoomed = params.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
    const offersZoom = (params.tools ?? []).some((t) => t.name === "zoom_image");
    if (!zoomed && offersZoom && c.target) {
      // Map the answer region from original pixels into the coordinate space
      // the extension reported for that image.
      const contexts = [...firstUser.matchAll(/<pi-image-zoom-context>([\s\S]*?)<\/pi-image-zoom-context>/g)].map((m) => JSON.parse(m[1]));
      const ctx = contexts.find((x) => x.imageIndex === c.target.image) ?? contexts[c.target.image];
      if (ctx) {
        const sx = ctx.view.width / ctx.original.width, sy = ctx.view.height / ctx.original.height;
        const pad = 40;
        const input = {
          image_index: ctx.imageIndex,
          x1: Math.max(0, Math.floor((c.target.left - pad) * sx)), y1: Math.max(0, Math.floor((c.target.top - pad) * sy)),
          x2: Math.ceil((c.target.left + c.target.width + pad) * sx), y2: Math.ceil((c.target.top + c.target.height + pad) * sy),
        };
        return sse(res, model, [{ type: "text", text: "Zooming in." }, { type: "tool_use", name: "zoom_image", input }], "tool_use");
      }
    }
    return sse(res, model, [{ type: "text", text: `Read it.\n\nANSWER: ${c.expected}` }], "end_turn");
  });
}).listen(port, "127.0.0.1", () => console.error(`stub gateway (${mode}) on http://127.0.0.1:${port}`));
