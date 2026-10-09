#!/usr/bin/env node
// Deterministically renders the synthetic zoom-qa cases.
//
//   node evals/zoom-qa/generate-cases.mjs
//
// Writes evals/zoom-qa/images/*.png (gitignored, regenerated on demand) and
// evals/zoom-qa/cases.jsonl. Every expected answer comes from the generator's
// own parameters, never from a model, and every target region is recorded in
// original-image pixels so the runner can check whether zoom crops hit it.
//
// Seed cases from real use live in evals/zoom-qa/seeds/seeds.jsonl and are
// appended unchanged (see seeds/README.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const imageDir = join(here, "images");
mkdirSync(imageDir, { recursive: true });

// mulberry32: small, seeded, stable across Node versions.
function rng(seed) {
  // Scramble the seed so adjacent seeds do not give correlated first draws.
  let a = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SANS = "DejaVu Sans";
const MONO = "DejaVu Sans Mono";

async function render(name, width, height, body, background = "#ffffff") {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
<rect width="${width}" height="${height}" fill="${background}"/>
${body}
</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(imageDir, name));
  return name;
}

function colName(i) {
  return i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26);
}

// ---------------------------------------------------------------- table ----
// 3600x2700 spreadsheet, 30 columns x 60 rows of six-digit numbers in 9px
// mono. Pi's standard overview of this is ~1270x950, so digits land at ~3px.
async function table(seed, name) {
  const r = rng(seed);
  const W = 3600, H = 2700, cols = 30, rows = 60, rowHeadW = 80, headH = 40;
  const colW = (W - rowHeadW) / cols, rowH = (H - headH) / rows;
  const values = [];
  let body = `<g font-family="${MONO}" font-size="9" fill="#1f2937">`;
  for (let c = 0; c < cols; c++) {
    const x = rowHeadW + c * colW;
    body += `<rect x="${x}" y="0" width="${colW}" height="${headH}" fill="#e5e7eb" stroke="#9ca3af"/>`;
    body += `<text x="${x + colW / 2 - 6}" y="${headH / 2 + 4}" font-weight="bold">${colName(c)}</text>`;
  }
  for (let row = 0; row < rows; row++) {
    const y = headH + row * rowH;
    values.push([]);
    body += `<rect x="0" y="${y}" width="${rowHeadW}" height="${rowH}" fill="#e5e7eb" stroke="#9ca3af"/>`;
    body += `<text x="20" y="${y + rowH / 2 + 4}" font-weight="bold">${row + 1}</text>`;
    for (let c = 0; c < cols; c++) {
      const x = rowHeadW + c * colW;
      const v = int(r, 100000, 999999);
      values[row].push(v);
      body += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="${row % 2 ? "#f9fafb" : "#ffffff"}" stroke="#d1d5db"/>`;
      body += `<text x="${x + 42}" y="${y + rowH / 2 + 3}">${v}</text>`;
    }
  }
  body += "</g>";
  await render(name, W, H, body);
  const cell = (row, c) => ({ left: Math.round(rowHeadW + c * colW), top: Math.round(headH + row * rowH), width: Math.round(colW), height: Math.round(rowH) });
  return { r, values, cell, cols, rows, W, H };
}

// ---------------------------------------------------------------- chart ----
// 4000x2400 line chart, five series in separate value bands, every point
// labelled with a four-digit value in 10px. Position on the plot can't give
// the exact value; the label has to be read.
const SERIES = [
  { name: "Northwind", color: "#2563eb" },
  { name: "Halvorsen", color: "#dc2626" },
  { name: "Oakridge", color: "#16a34a" },
  { name: "Brightwater", color: "#9333ea" },
  { name: "Castellan", color: "#ea580c" },
];
async function chart(seed, name) {
  const r = rng(seed);
  const W = 4000, H = 2400, left = 160, right = 3700, top = 120, bottom = 2250, months = 24;
  const vmin = 1000, vmax = 6000;
  const xOf = (m) => left + ((m - 1) / (months - 1)) * (right - left);
  const yOf = (v) => bottom - ((v - vmin) / (vmax - vmin)) * (bottom - top);
  const series = shuffle(r, SERIES).map((s, i) => {
    const base = 1100 + i * 1000;
    let v = base + int(r, 100, 400);
    const pts = [];
    for (let m = 1; m <= months; m++) {
      v = Math.min(base + 880, Math.max(base + 20, v + int(r, -120, 120)));
      pts.push(v);
    }
    return { ...s, pts };
  });
  let body = `<g stroke="#e5e7eb" stroke-width="2">`;
  for (let m = 1; m <= months; m++) body += `<line x1="${xOf(m)}" y1="${top}" x2="${xOf(m)}" y2="${bottom}"/>`;
  for (let v = vmin; v <= vmax; v += 500) body += `<line x1="${left}" y1="${yOf(v)}" x2="${right}" y2="${yOf(v)}"/>`;
  body += `</g><g font-family="${SANS}" font-size="14" fill="#374151">`;
  for (let m = 1; m <= months; m++) body += `<text x="${xOf(m) - 8}" y="${bottom + 30}">${m}</text>`;
  body += `<text x="${(left + right) / 2 - 30}" y="${bottom + 70}">Month</text></g>`;
  const labelBox = {};
  for (const s of series) {
    const d = s.pts.map((v, i) => `${i ? "L" : "M"} ${xOf(i + 1).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
    body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="5"/>`;
    s.pts.forEach((v, i) => {
      const x = xOf(i + 1), y = yOf(v);
      body += `<circle cx="${x}" cy="${y}" r="6" fill="${s.color}"/>`;
      body += `<text x="${x - 12}" y="${y - 10}" font-family="${SANS}" font-size="10" fill="#111827">${v}</text>`;
      labelBox[`${s.name}:${i + 1}`] = { left: Math.round(x - 24), top: Math.round(y - 30), width: 56, height: 40 };
    });
  }
  // Small legend in the top-right corner.
  body += `<g font-family="${SANS}" font-size="11">`;
  series.forEach((s, i) => {
    const y = 40 + i * 22;
    body += `<rect x="3740" y="${y - 10}" width="24" height="10" fill="${s.color}"/><text x="3772" y="${y}" fill="#111827">${s.name}</text>`;
  });
  body += "</g>";
  await render(name, W, H, body);
  return { r, series, labelBox, W, H };
}

// ------------------------------------------------------------------- ui ----
// 3200x2000 settings screen: four columns of 15 labelled toggles in 8px, plus
// a 9px build string in the footer.
const UI_A = ["Auto-sync", "Show", "Hide", "Mute", "Pin", "Archive", "Preview", "Backup", "Encrypt", "Compress", "Notify on", "Group", "Sort", "Highlight", "Translate"];
const UI_B = ["contacts", "read receipts", "drafts", "attachments", "calendar invites", "starred threads", "shared folders", "voice notes", "mentions", "large files", "unread badges", "reactions", "link previews", "typing status", "status updates", "old sessions"];
async function ui(seed, name) {
  const r = rng(seed);
  const W = 3200, H = 2000;
  const labels = [];
  const used = new Set();
  while (labels.length < 60) {
    const label = `${pick(r, UI_A)} ${pick(r, UI_B)}`;
    if (!used.has(label)) { used.add(label); labels.push(label); }
  }
  let body = `<rect x="0" y="0" width="${W}" height="70" fill="#111827"/><text x="40" y="45" font-family="${SANS}" font-size="22" fill="#f9fafb">Preferences</text>`;
  body += `<g font-family="${SANS}" font-size="8" fill="#1f2937">`;
  const toggles = [];
  labels.forEach((label, i) => {
    const col = Math.floor(i / 15), row = i % 15;
    const x = 80 + col * 780, y = 140 + row * 112;
    const on = r() < 0.5;
    toggles.push({ label, on, box: { left: x - 10, top: y - 30, width: 420, height: 50 } });
    body += `<rect x="${x - 20}" y="${y - 40}" width="740" height="96" rx="8" fill="#f9fafb" stroke="#e5e7eb"/>`;
    body += `<text x="${x}" y="${y}">${esc(label)}</text>`;
    body += `<text x="${x}" y="${y + 18}" font-size="7" fill="#6b7280">Applies to all linked devices</text>`;
    const tx = x + 360, ty = y - 14;
    body += `<rect x="${tx}" y="${ty}" width="26" height="14" rx="7" fill="${on ? "#22c55e" : "#d1d5db"}"/>`;
    body += `<circle cx="${on ? tx + 19 : tx + 7}" cy="${ty + 7}" r="5" fill="#ffffff"/>`;
  });
  body += "</g>";
  const build = `${int(r, 3, 9)}.${int(r, 10, 29)}.${int(r, 1000, 9999)}-rc${int(r, 2, 9)}`;
  body += `<text x="${W - 260}" y="${H - 24}" font-family="${MONO}" font-size="9" fill="#9ca3af">Build ${build}</text>`;
  await render(name, W, H, body);
  return { r, toggles, labels, build, buildBox: { left: W - 270, top: H - 44, width: 260, height: 30 }, W, H };
}

// -------------------------------------------------------------- diagram ----
// 3600x3600 network: 70 coded nodes on a jittered grid, grey edges, exactly
// one red edge. Node codes are 10px.
async function diagram(seed, name) {
  const r = rng(seed);
  const W = 3600, H = 3600;
  const letters = "ACDEFHJKLMNPRTVWXY";
  const codes = new Set();
  while (codes.size < 70) codes.add(`${pick(r, [...letters])}${pick(r, [...letters])}-${int(r, 10, 99)}`);
  const nodes = [...codes].map((code, i) => {
    const gx = i % 10, gy = Math.floor(i / 10);
    return { code, x: 220 + gx * 350 + int(r, -60, 60), y: 260 + gy * 480 + int(r, -80, 80) };
  });
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (const j of [i + 1, i + 10, i + 11]) {
      if (j < nodes.length && (j !== i + 1 || (i + 1) % 10) && r() < 0.55) edges.push([i, j]);
    }
  }
  const red = edges.splice(int(r, 0, edges.length - 1), 1)[0];
  let body = `<g stroke="#9ca3af" stroke-width="3">`;
  for (const [a, b] of edges) body += `<line x1="${nodes[a].x}" y1="${nodes[a].y}" x2="${nodes[b].x}" y2="${nodes[b].y}"/>`;
  body += `</g><line x1="${nodes[red[0]].x}" y1="${nodes[red[0]].y}" x2="${nodes[red[1]].x}" y2="${nodes[red[1]].y}" stroke="#dc2626" stroke-width="4"/>`;
  body += `<g font-family="${SANS}" font-size="10" fill="#111827">`;
  for (const n of nodes) {
    body += `<circle cx="${n.x}" cy="${n.y}" r="14" fill="#ffffff" stroke="#374151" stroke-width="3"/>`;
    body += `<text x="${n.x + 18}" y="${n.y - 14}">${n.code}</text>`;
  }
  body += "</g>";
  await render(name, W, H, body);
  const a = nodes[red[0]], b = nodes[red[1]];
  const box = {
    left: Math.min(a.x, b.x) - 40, top: Math.min(a.y, b.y) - 40,
    width: Math.abs(a.x - b.x) + 120, height: Math.abs(a.y - b.y) + 80,
  };
  return { r, nodes, red: [a, b], box, W, H };
}

// ---------------------------------------------------------------- label ----
// 4000x3000 cluttered "bench photo" with several small stickers; one may be
// the SERIAL sticker, the rest are decoys with other headings.
const SAFE = "ACDEFGHJKLMNPQRTUVWXY";
const serial = (r) =>
  `${Array.from({ length: 4 }, () => pick(r, [...SAFE + "2346789"])).join("")}-${Array.from({ length: 5 }, () => pick(r, [..."2346789"])).join("")}-${pick(r, [...SAFE])}${pick(r, [...SAFE])}`;
async function label(seed, name, { withSerial }) {
  const r = rng(seed);
  const W = 4000, H = 3000;
  let body = "";
  for (let i = 0; i < 260; i++) {
    const shade = int(r, 90, 170);
    body += `<rect x="${int(r, -200, W)}" y="${int(r, -200, H)}" width="${int(r, 80, 700)}" height="${int(r, 40, 500)}" fill="rgb(${shade},${shade - 10},${shade - 25})" opacity="0.55" transform="rotate(${int(r, -25, 25)})"/>`;
  }
  const headings = shuffle(r, ["MODEL", "LOT", "PART", "BATCH", "REV"]).slice(0, withSerial ? 4 : 5);
  if (withSerial) headings.push("SERIAL");
  const stickers = shuffle(r, headings).map((heading, i) => {
    const cx = 300 + (i % 3) * 1250 + int(r, 0, 600), cy = 300 + Math.floor(i / 3) * 1350 + int(r, 0, 700);
    return { heading, value: serial(r), x: cx, y: cy };
  });
  for (const s of stickers) {
    body += `<rect x="${s.x}" y="${s.y}" width="170" height="54" rx="5" fill="#fefce8" stroke="#a16207" stroke-width="2"/>`;
    body += `<text x="${s.x + 9}" y="${s.y + 18}" font-family="${SANS}" font-size="10" font-weight="bold" fill="#713f12">${s.heading}</text>`;
    body += `<text x="${s.x + 9}" y="${s.y + 40}" font-family="${MONO}" font-size="12" fill="#111827">${s.value}</text>`;
  }
  await render(name, W, H, body, "#7c7468");
  const target = stickers.find((s) => s.heading === "SERIAL");
  return { r, stickers, target, box: target ? { left: target.x, top: target.y, width: 170, height: 54 } : null, W, H };
}

// ----------------------------------------------------------------- easy ----
// Large-type banner: answerable from the overview with no zoom. Used to
// measure over-zooming (zoom calls and cost on cases that don't need them).
const BANNER_WORDS = ["LANTERN", "MERIDIAN", "THRESHOLD", "CASCADE", "OBSIDIAN", "HARBOUR"];
async function easy(seed, name) {
  const r = rng(seed);
  const W = 2400, H = 1600, word = pick(r, BANNER_WORDS);
  let body = `<rect x="200" y="500" width="2000" height="420" rx="30" fill="#1e3a8a"/>`;
  body += `<text x="${1200 - word.length * 62}" y="790" font-family="${SANS}" font-size="190" font-weight="bold" fill="#ffffff">${word}</text>`;
  for (let i = 0; i < 40; i++) body += `<text x="${int(r, 40, 2200)}" y="${pick(r, [int(r, 60, 440), int(r, 980, 1560)])}" font-family="${SANS}" font-size="12" fill="#6b7280">ref ${int(r, 1000, 9999)}</text>`;
  await render(name, W, H, body, "#f3f4f6");
  return { word, box: { left: 200, top: 500, width: 2000, height: 420 }, W, H };
}

// ---------------------------------------------------------------- cases ----

const ANSWER_INSTRUCTION =
  'End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".';

const cases = [];
function addCase({ id, tags, images, question, expected, answer_type, target, image_dir = "images" }) {
  const prompt = `${images.map((f) => `@${f}`).join(" ")} ${question}\n\n${ANSWER_INSTRUCTION}`;
  cases.push({ id, tags, image_dir, images, question, prompt, expected, answer_type, target: target ?? null });
}

// table x8
for (let k = 0; k < 8; k++) {
  const name = `table-${k}.png`;
  const t = await table(1000 + k, name);
  const row = int(t.r, 0, t.rows - 1), c = int(t.r, 0, t.cols - 1);
  addCase({
    id: `table-${k}`, tags: ["table", "tiny-text"], images: [name],
    question: `What number is in column ${colName(c)}, row ${row + 1} of this spreadsheet?`,
    expected: String(t.values[row][c]), answer_type: "number",
    target: { image: 0, ...t.cell(row, c) },
  });
}

// chart x6
for (let k = 0; k < 6; k++) {
  const name = `chart-${k}.png`;
  const ch = await chart(2000 + k, name);
  const s = pick(ch.r, ch.series), m = int(ch.r, 2, 23);
  addCase({
    id: `chart-${k}`, tags: ["chart", "data-label"], images: [name],
    question: `What value is labelled on the ${s.name} line at month ${m}?`,
    expected: String(s.pts[m - 1]), answer_type: "number",
    target: { image: 0, ...ch.labelBox[`${s.name}:${m}`] },
  });
}

// ui x6 (4 toggles, 2 build strings)
for (let k = 0; k < 6; k++) {
  const name = `ui-${k}.png`;
  const u = await ui(3000 + k, name);
  if (k < 4) {
    const t = pick(u.r, u.toggles);
    addCase({
      id: `ui-toggle-${k}`, tags: ["ui", "toggle"], images: [name],
      question: `In this settings screenshot, is "${t.label}" switched on or off?`,
      expected: t.on ? "ON" : "OFF", answer_type: "onoff",
      target: { image: 0, ...t.box },
    });
  } else {
    addCase({
      id: `ui-build-${k}`, tags: ["ui", "footer-text"], images: [name],
      question: "What build number is shown in the footer of this screenshot?",
      expected: u.build, answer_type: "text",
      target: { image: 0, ...u.buildBox },
    });
  }
}

// diagram x6
for (let k = 0; k < 6; k++) {
  const name = `diagram-${k}.png`;
  const d = await diagram(4000 + k, name);
  const [from, to] = d.r() < 0.5 ? d.red : [d.red[1], d.red[0]];
  addCase({
    id: `diagram-${k}`, tags: ["diagram", "line-tracing"], images: [name],
    question: `Which node is connected to ${from.code} by the red line? Give its code.`,
    expected: to.code, answer_type: "text",
    target: { image: 0, ...d.box },
  });
}

// label x5
for (let k = 0; k < 5; k++) {
  const name = `label-${k}.png`;
  const l = await label(5000 + k, name, { withSerial: true });
  addCase({
    id: `label-${k}`, tags: ["label", "tiny-text"], images: [name],
    question: "What is the code printed on the sticker headed SERIAL?",
    expected: l.target.value, answer_type: "text",
    target: { image: 0, ...l.box },
  });
}

// multi-image x3: the question is about the second attachment
{
  const pairs = [
    ["table", "chart"],
    ["chart", "table"],
    ["label", "ui"],
  ];
  for (let k = 0; k < pairs.length; k++) {
    const [first, second] = pairs[k];
    const a = `multi-${k}-a.png`, b = `multi-${k}-b.png`;
    const gens = {
      table: (n) => table(6000 + k * 10 + (n === a ? 0 : 1), n),
      chart: (n) => chart(6100 + k * 10 + (n === a ? 0 : 1), n),
      label: (n) => label(6200 + k * 10 + (n === a ? 0 : 1), n, { withSerial: true }),
      ui: (n) => ui(6300 + k * 10 + (n === a ? 0 : 1), n),
    };
    await gens[first](a);
    const g = await gens[second](b);
    let question, expected, answer_type, box;
    if (second === "chart") {
      const s = pick(g.r, g.series), m = int(g.r, 2, 23);
      question = `In the second image, what value is labelled on the ${s.name} line at month ${m}?`;
      expected = String(s.pts[m - 1]); answer_type = "number"; box = g.labelBox[`${s.name}:${m}`];
    } else if (second === "table") {
      const row = int(g.r, 0, g.rows - 1), c = int(g.r, 0, g.cols - 1);
      question = `In the second image, what number is in column ${colName(c)}, row ${row + 1}?`;
      expected = String(g.values[row][c]); answer_type = "number"; box = g.cell(row, c);
    } else {
      const t = pick(g.r, g.toggles);
      question = `In the second image, is "${t.label}" switched on or off?`;
      expected = t.on ? "ON" : "OFF"; answer_type = "onoff"; box = t.box;
    }
    addCase({
      id: `multi-${k}`, tags: ["multi-image", second], images: [a, b],
      question, expected, answer_type, target: { image: 1, ...box },
    });
  }
}

// easy x4: no zoom needed
for (let k = 0; k < 4; k++) {
  const name = `easy-${k}.png`;
  const e = await easy(7000 + k, name);
  addCase({
    id: `easy-${k}`, tags: ["easy", "no-zoom-needed"], images: [name],
    question: "What word is written on the large blue banner?",
    expected: e.word, answer_type: "text",
    target: { image: 0, ...e.box },
  });
}

// absent x4: the thing asked about is not in the image
{
  const l = await label(8000, "absent-0.png", { withSerial: false });
  addCase({
    id: "absent-label", tags: ["absent", "label"], images: ["absent-0.png"],
    question: "What is the code printed on the sticker headed SERIAL?",
    expected: "NOT FOUND", answer_type: "notfound", target: null,
  });
  void l;
  const u = await ui(8001, "absent-1.png");
  const present = new Set(u.labels);
  let missing;
  for (const a of UI_A) for (const b of UI_B) if (!missing && !present.has(`${a} ${b}`)) missing = `${a} ${b}`;
  addCase({
    id: "absent-ui", tags: ["absent", "ui"], images: ["absent-1.png"],
    question: `In this settings screenshot, is "${missing}" switched on or off?`,
    expected: "NOT FOUND", answer_type: "notfound", target: null,
  });
  await chart(8002, "absent-2.png");
  addCase({
    id: "absent-chart", tags: ["absent", "chart"], images: ["absent-2.png"],
    question: "What value is labelled on the Pemberton line at month 9?",
    expected: "NOT FOUND", answer_type: "notfound", target: null,
  });
  await table(8003, "absent-3.png");
  addCase({
    id: "absent-table", tags: ["absent", "table"], images: ["absent-3.png"],
    question: "What number is in column AH, row 12 of this spreadsheet?",
    expected: "NOT FOUND", answer_type: "notfound", target: null,
  });
}

// Seed cases from real use (optional): appended as-is.
const seedsPath = join(here, "seeds", "seeds.jsonl");
if (existsSync(seedsPath)) {
  for (const line of readFileSync(seedsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const s = JSON.parse(line);
    addCase({
      id: `seed-${s.id}`, tags: ["seed", ...(s.tags ?? [])], image_dir: "seeds", images: s.images,
      question: s.question, expected: s.expected, answer_type: s.answer_type ?? "text", target: s.target ?? null,
    });
  }
}

writeFileSync(join(here, "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
console.log(`wrote ${cases.length} cases to ${join(here, "cases.jsonl")}`);
