#!/usr/bin/env node
/**
 * slim-agent-adapter
 * -----------------------------------------------------------------------------
 * Zero-dependency OpenAI-compatible proxy that slims the per-request prompt so
 * small local models stay fast on modest hardware — with a live dashboard and a
 * per-request prompt-optimization inspector.
 *
 *   node index.mjs
 *   • proxy:      http://localhost:1235/v1
 *   • dashboard:  http://localhost:1235/dashboard   (click a request to inspect)
 *
 * Per request (schema-preserving): compress tool descriptions, strip param prose,
 * inject `/no_think` for reasoning models. Streams responses through untouched.
 */

import http from "node:http";
import { Readable } from "node:stream";
import fs from "node:fs";

// ─── Config ───────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 1235);
const UPSTREAM = (process.env.UPSTREAM || "http://127.0.0.1:1234").replace(/\/$/, "");
const COMPRESS = process.env.COMPRESS !== "0";
const STRIP_PARAM_DESC = process.env.STRIP_PARAM_DESC !== "0";
const MAX_TOOL_DESC = Number(process.env.MAX_TOOL_DESC || 100);
const TRUNCATE_DESC = process.env.TRUNCATE_DESC === "1"; // opt-in: hard-truncate tool descriptions (LOSSY — can drop behavioural guidance). Off by default.
const OVERRIDES = loadOverrides(process.env.OVERRIDES);   // curated terse descriptions: { "toolName": "shorter desc that keeps the guidance" }
const NO_THINK = process.env.NO_THINK !== "0";
const NO_THINK_MATCH = new RegExp(process.env.NO_THINK_MATCH || "qwen3", "i");
const LOG = process.env.LOG !== "0";
const PASSTHROUGH = process.env.PASSTHROUGH === "1"; // transparent mode: no filtering/slimming/no_think. For high-spec setups that don't need the adapter's help but still want the dashboard.
const TOOL_FILTER = process.env.TOOL_FILTER === "1";                 // opt-in: send only tools relevant to the current prompt
const TOOL_FILTER_MAX = Number(process.env.TOOL_FILTER_MAX || 24);  // hard cap on tools forwarded
const TOOL_FILTER_FLOOR = Number(process.env.TOOL_FILTER_FLOOR || 6); // min tools when the prompt has signal (keeps the agent workable)
const TOOL_FILTER_KEEP = process.env.TOOL_FILTER_KEEP ? new RegExp(process.env.TOOL_FILTER_KEEP, "i") : null; // always-keep tool-name regex (e.g. ^mcp_ to never drop your MCP tools)
const TOOL_DENY = process.env.TOOL_DENY ? new RegExp(process.env.TOOL_DENY, "i") : null; // always-drop tool-name regex (e.g. scaffolders small models misfire on)
const TOOL_SEMANTIC = process.env.TOOL_FILTER_SEMANTIC === "1"; // opt-in: rank tools by embedding similarity instead of keywords (needs an embeddings endpoint; falls back to lexical on error)
const EMBED_URL = process.env.EMBED_URL || UPSTREAM + "/v1/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-nomic-embed-text-v1.5";
const RECENT_CAP = 200;
const DETAIL_CAP = 80;

// ─── Transforms ─────────────────────────────────────────────────────────────
const estTokens = (obj) => Math.round(JSON.stringify(obj).length / 4);

function terse(s, max) {
  const clean = String(s).replace(/\s+/g, " ").trim();
  const dot = clean.indexOf(". ");
  const out = dot > 0 && dot + 1 <= max ? clean.slice(0, dot + 1) : clean.slice(0, max);
  return out.trim();
}
function loadOverrides(path) {
  if (!path) return {};
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch (e) { console.error("[slim] could not load OVERRIDES:", e.message); return {}; }
}
/**
 * Slim a tool description WITHOUT losing behavioural guidance by default.
 *   1. curated override wins (short, but keeps the "call X first / use Y" instructions)
 *   2. else opt-in hard truncation (TRUNCATE_DESC=1) — lossy, off by default
 *   3. else just normalise whitespace (lossless)
 */
function slimDesc(name, desc) {
  const normalized = String(desc).replace(/\s+/g, " ").trim();
  if (OVERRIDES[name]) return OVERRIDES[name];
  if (TRUNCATE_DESC) return terse(normalized, MAX_TOOL_DESC);
  return normalized;
}
function slimTools(tools) {
  return tools.map((t) => {
    if (!t || t.type !== "function" || !t.function) return t;
    const f = { ...t.function };
    if (COMPRESS && typeof f.description === "string") f.description = slimDesc(f.name, f.description);
    if (STRIP_PARAM_DESC && f.parameters && f.parameters.properties) {
      const props = {};
      for (const [k, v] of Object.entries(f.parameters.properties)) {
        const nv = { ...v };
        delete nv.description;
        props[k] = nv;
      }
      f.parameters = { ...f.parameters, properties: props };
    }
    return { ...t, function: f };
  });
}
function isThinker(model) {
  return NO_THINK && NO_THINK_MATCH.test(String(model || ""));
}
function injectNoThink(body) {
  if (!isThinker(body.model)) return body;
  const msgs = Array.isArray(body.messages) ? [...body.messages] : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "user") continue;
    const c = msgs[i].content;
    if (typeof c === "string") {
      if (!/\/no_think\b/.test(c)) msgs[i] = { ...msgs[i], content: c + " /no_think" };
    } else if (Array.isArray(c)) {
      msgs[i] = { ...msgs[i], content: [...c, { type: "text", text: " /no_think" }] };
    }
    break;
  }
  return { ...body, messages: msgs };
}

// ─── Prompt-driven tool filtering ────────────────────────────────────────────
const STOP = new Set(
  "the a an of to in for on and or is are be am was were with without your you i we it they this that these those use used using return returns get gets set list all any some no not into then from at by as off out over please can could would should will do does done make made new".split(/\s+/),
);
function tkn(s) {
  const m = String(s || "").toLowerCase().match(/[a-z0-9]+/g);
  return (m || []).filter((w) => w.length > 2 && !STOP.has(w));
}
function fname(t) { return (t && t.function && t.function.name) || ""; }
/**
 * Keep only the tools relevant to the current prompt.
 *  - lexical score: query terms hitting a tool's NAME (weighted) or description
 *  - always keep tools already used in the conversation (tool_calls / tool msgs) for continuity
 *  - always keep names matching TOOL_FILTER_KEEP (e.g. built-in editor/terminal tools)
 *  - no query signal (a bare "hi") → only the continuity/keep set (usually none)
 *  - capped at TOOL_FILTER_MAX, floored at TOOL_FILTER_FLOOR so the agent stays usable
 */
function filterToolsByPrompt(tools, messages) {
  if (!Array.isArray(tools) || tools.length <= TOOL_FILTER_FLOOR) return tools;
  const msgs = Array.isArray(messages) ? messages : [];
  const q = new Set(tkn(msgs.filter((m) => m.role === "user").map(msgText).join(" ")));

  const referenced = new Set();
  for (const m of msgs) {
    if (Array.isArray(m.tool_calls)) for (const c of m.tool_calls) if (c.function && c.function.name) referenced.add(c.function.name);
    if (m.role === "tool" && m.name) referenced.add(m.name);
  }

  const scored = tools.map((t) => {
    const name = fname(t);
    const nameTokens = new Set(tkn(name.replace(/[_-]/g, " ")));
    const descTokens = tkn((t.function && t.function.description) || "");
    let score = 0;
    for (const w of q) if (nameTokens.has(w)) score += 3;
    for (const w of descTokens) if (q.has(w)) score += 1;
    const keep = referenced.has(name) || (TOOL_FILTER_KEEP && TOOL_FILTER_KEEP.test(name));
    return { t, score, keep };
  });

  const kept = scored.filter((s) => s.keep).map((s) => s.t);
  if (q.size === 0) return kept; // greeting / no signal → continuity+core only

  const rest = scored.filter((s) => !s.keep).sort((a, b) => b.score - a.score);
  const out = [...kept];
  for (const s of rest) {
    if (out.length >= TOOL_FILTER_MAX) break;
    if (s.score > 0 || out.length < TOOL_FILTER_FLOOR) out.push(s.t);
  }
  return out;
}

// Embedding-based (semantic) tool filtering — opt-in via TOOL_FILTER_SEMANTIC=1.
const _toolVecCache = new Map();
function _cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
async function _embed(texts) {
  const r = await fetch(EMBED_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBED_MODEL, input: texts }) });
  if (!r.ok) throw new Error("embeddings HTTP " + r.status);
  return (await r.json()).data.map((d) => d.embedding);
}
const _toolText = (t) => (fname(t) + " " + ((t.function && t.function.description) || "")).replace(/\s+/g, " ").slice(0, 1200);
async function filterToolsSemantic(tools, messages) {
  if (!Array.isArray(tools) || tools.length <= TOOL_FILTER_FLOOR) return tools;
  const msgs = Array.isArray(messages) ? messages : [];
  const query = msgs.filter((m) => m.role === "user").map(msgText).join(" ").slice(0, 2000);
  const referenced = new Set();
  for (const m of msgs) {
    if (Array.isArray(m.tool_calls)) for (const c of m.tool_calls) if (c.function && c.function.name) referenced.add(c.function.name);
    if (m.role === "tool" && m.name) referenced.add(m.name);
  }
  const missing = tools.filter((t) => !_toolVecCache.has(_toolText(t)));
  let qvec;
  try {
    const vecs = await _embed([query, ...missing.map(_toolText)]);
    qvec = vecs[0];
    missing.forEach((t, i) => _toolVecCache.set(_toolText(t), vecs[i + 1]));
  } catch (e) {
    if (LOG) console.error("[slim] semantic filter → lexical fallback:", e.message);
    return filterToolsByPrompt(tools, messages);
  }
  const scored = tools.map((t) => {
    const keep = referenced.has(fname(t)) || (TOOL_FILTER_KEEP && TOOL_FILTER_KEEP.test(fname(t)));
    const v = _toolVecCache.get(_toolText(t));
    return { t, score: v ? _cos(qvec, v) : 0, keep };
  });
  const kept = scored.filter((s) => s.keep).map((s) => s.t);
  const rest = scored.filter((s) => !s.keep).sort((a, b) => b.score - a.score);
  const out = [...kept];
  for (const s of rest) {
    if (out.length >= TOOL_FILTER_MAX) break;
    if (s.score > 0.25 || out.length < TOOL_FILTER_FLOOR) out.push(s.t);
  }
  return out;
}

// ─── Prompt-optimization detail (what the inspector shows) ───────────────────
function toolDiff(before, after) {
  const byName = new Map();
  for (const t of Array.isArray(after) ? after : []) { const n = fname(t); if (n) byName.set(n, t); }
  return (Array.isArray(before) ? before : []).map((b) => {
    const bf = (b && b.function) || {};
    const af = byName.get(bf.name);
    const dropped = !af;
    const aff = (af && af.function) || {};
    const bp = (bf.parameters && bf.parameters.properties) || {};
    const ap = (aff.parameters && aff.parameters.properties) || {};
    const stripped = Object.keys(bp).filter((k) => bp[k] && bp[k].description && !(ap[k] && ap[k].description));
    return { name: bf.name || "?", dropped, descBefore: bf.description || "", descAfter: dropped ? "" : (aff.description || ""), paramsStripped: stripped };
  });
}
function msgText(m) {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === "string" ? p : p.text || "")).join(" ");
  return m.content == null ? "" : String(m.content);
}
function buildDetail(id, body, slimmed) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sys = msgs.filter((m) => m.role === "system");
  const other = msgs.filter((m) => m.role !== "system");
  return {
    id,
    noThink: isThinker(body.model),
    breakdown: {
      system: estTokens(sys),
      messages: estTokens(other),
      toolsBefore: estTokens(body.tools || []),
      toolsAfter: estTokens(slimmed.tools || []),
    },
    tools: toolDiff(body.tools, slimmed.tools),
    messages: msgs.map((m) => ({ role: m.role || "?", text: msgText(m).replace(/\s+/g, " ").trim().slice(0, 500) })),
  };
}

// ─── Metrics state ────────────────────────────────────────────────────────
const startedAt = Date.now();
let seq = 0;
let inflight = 0;
const recent = [];
const sessions = new Map();
const details = new Map();
const totals = { requests: 0, done: 0, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0, latencySum: 0, noThink: 0 };
const sseClients = new Set();

function tick() {
  const line = "data: tick\n\n";
  for (const c of sseClients) { try { c.write(line); } catch { /* dropped */ } }
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
}
function firstUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p.text || "").join(" ");
  }
  return typeof messages[0]?.content === "string" ? messages[0].content : "";
}

// ─── Chat proxy with metrics ────────────────────────────────────────────────
async function forwardChat(res, slimmed, rec) {
  const t0 = rec.ts;
  totals.requests++;
  totals.tokensBefore += rec.before;
  totals.tokensAfter += rec.after;
  totals.tokensSaved += rec.saved;
  if (rec.noThink) totals.noThink++;
  inflight++;
  recent.push(rec);
  if (recent.length > RECENT_CAP) recent.shift();
  const sess = sessions.get(rec.sessionId) || { id: rec.sessionId, firstSeen: t0, model: rec.model, requests: 0, savedTokens: 0, preview: rec.preview };
  sess.requests++; sess.savedTokens += rec.saved; sess.lastSeen = t0; sess.model = rec.model;
  sessions.set(rec.sessionId, sess);
  tick();

  const finish = (httpStatus) => {
    if (rec.status !== "processing") return;
    rec.httpStatus = httpStatus;
    rec.status = httpStatus >= 400 ? "error" : "done";
    rec.totalMs = Date.now() - t0;
    totals.done++;
    totals.latencySum += rec.totalMs;
    inflight = Math.max(0, inflight - 1);
    tick();
  };

  try {
    const up = await fetch(UPSTREAM + "/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slimmed),
    });
    rec.ttfbMs = Date.now() - t0;
    rec.httpStatus = up.status;
    tick();
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
    res.on("close", () => finish(up.status));
    res.on("finish", () => finish(up.status));
    if (up.body) Readable.fromWeb(up.body).pipe(res);
    else { res.end(); finish(up.status); }
    if (LOG) console.error(`[slim] #${rec.id} ${rec.tools} tools · ~${rec.before}→${rec.after} tok (−${rec.savedPct}%)${rec.noThink ? " · no_think" : ""} · ttfb ${rec.ttfbMs}ms`);
  } catch (e) {
    finish(502);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

function metricsJSON() {
  const avgSavedPct = totals.tokensBefore ? Math.round((totals.tokensSaved / totals.tokensBefore) * 100) : 0;
  const avgLatency = totals.done ? Math.round(totals.latencySum / totals.done) : 0;
  const sess = [...sessions.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 30);
  return {
    uptimeMs: Date.now() - startedAt,
    config: { upstream: UPSTREAM, compress: COMPRESS, stripParamDesc: STRIP_PARAM_DESC, noThink: NO_THINK, maxToolDesc: MAX_TOOL_DESC },
    inflight,
    totals: { ...totals, avgSavedPct, avgLatency, sessions: sessions.size },
    sessions: sess,
    recent: recent.slice(-60).reverse(),
  };
}

// ─── Server ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "/";

    if (req.method === "GET" && (url === "/" || url.startsWith("/dashboard"))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }
    if (req.method === "GET" && url.startsWith("/metrics")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(metricsJSON()));
      return;
    }
    if (req.method === "GET" && url.startsWith("/inspect")) {
      const id = Number(new URL(url, "http://x").searchParams.get("id"));
      const d = details.get(id);
      res.writeHead(d ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(d || { error: "not found (only recent requests are kept)" }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("retry: 2000\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "GET" && url.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, upstream: UPSTREAM }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      const up = await fetch(UPSTREAM + url);
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
      if (up.body) Readable.fromWeb(up.body).pipe(res); else res.end();
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"invalid json"}'); return; }

      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const before = estTokens(body);
      let slimmed = body;
      let keptTools = toolCount;
      if (!PASSTHROUGH && toolCount) {
        let tools = body.tools;
        if (TOOL_DENY) tools = tools.filter((t) => !TOOL_DENY.test(fname(t)));
        if (TOOL_FILTER) tools = TOOL_SEMANTIC ? await filterToolsSemantic(tools, body.messages) : filterToolsByPrompt(tools, body.messages);
        keptTools = tools.length;
        if (COMPRESS || STRIP_PARAM_DESC) tools = slimTools(tools);
        slimmed = { ...slimmed, tools };
      }
      if (!PASSTHROUGH) slimmed = injectNoThink(slimmed);
      const after = estTokens(slimmed);
      const uText = firstUserText(body.messages);

      const rec = {
        id: ++seq, ts: Date.now(), sessionId: hash(uText || String(body.model || "x")),
        model: String(body.model || "?"), tools: toolCount, toolsKept: keptTools,
        before, after, saved: before - after, savedPct: before ? Math.round(((before - after) / before) * 100) : 0,
        noThink: isThinker(body.model), status: "processing", ttfbMs: null, totalMs: null, httpStatus: null,
        preview: uText.replace(/\s+/g, " ").trim().slice(0, 80),
      };
      details.set(rec.id, buildDetail(rec.id, body, slimmed));
      if (details.size > DETAIL_CAP) details.delete(details.keys().next().value);
      return forwardChat(res, slimmed, rec);
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
});

server.listen(PORT, () => {
  console.error(`slim-agent-adapter → :${PORT} proxying ${UPSTREAM}`);
  console.error(`  proxy:      http://localhost:${PORT}/v1`);
  console.error(`  dashboard:  http://localhost:${PORT}/dashboard`);
  console.error(`  passthrough=${PASSTHROUGH} compress=${COMPRESS} stripParamDesc=${STRIP_PARAM_DESC} truncateDesc=${TRUNCATE_DESC} overrides=${Object.keys(OVERRIDES).length} noThink=${NO_THINK}`);
  console.error(`  toolFilter=${TOOL_FILTER}${TOOL_FILTER ? ` (${TOOL_SEMANTIC ? "semantic" : "lexical"} max=${TOOL_FILTER_MAX} floor=${TOOL_FILTER_FLOOR}${TOOL_FILTER_KEEP ? ` keep=/${TOOL_FILTER_KEEP.source}/` : ""})` : ""}${TOOL_DENY ? ` deny=/${TOOL_DENY.source}/` : ""}`);
});

// ─── Embedded dashboard ─────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>slim-agent-adapter · dashboard</title>
<style>
  :root{--bg:#0a0e17;--card:#121a28;--line:#1e293b;--ink:#e7eefb;--muted:#8ea2be;
    --cyan:#2dd4bf;--blue:#4f8cff;--violet:#a78bfa;--green:#34d399;--amber:#fbbf24;--red:#f87171;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:linear-gradient(160deg,#0c1424,#080b13);color:var(--ink);
    font:14px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;padding:22px 26px;min-height:100vh}
  .mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
  header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}
  h1{font-size:19px;letter-spacing:-.01em} h1 b{color:var(--cyan)}
  .chip{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#bcd;border:1px solid var(--line);border-radius:999px;padding:3px 9px}
  .live{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green)}
  .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:18px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi .n{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
  .kpi .l{color:var(--muted);font-size:12px;margin-top:2px}
  .kpi .n.c{color:var(--cyan)}.kpi .n.g{color:var(--green)}.kpi .n.v{color:var(--violet)}.kpi .n.b{color:var(--blue)}.kpi .n.a{color:var(--amber)}
  .grid{display:grid;grid-template-columns:1fr 1.6fr;gap:16px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .panel h2{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:12px 16px;border-bottom:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;color:var(--muted);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:8px 12px;border-bottom:1px solid var(--line)}
  td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top} tr:last-child td{border-bottom:none}
  tbody tr[data-id]:hover{background:rgba(79,140,255,.07)}
  .num{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
  .save{color:var(--green);font-weight:700} .sid{font-family:ui-monospace,Menlo,monospace;color:var(--violet)}
  .pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px;display:inline-block}
  .p-processing{background:rgba(251,191,36,.15);color:var(--amber)} .p-done{background:rgba(52,211,153,.15);color:var(--green)} .p-error{background:rgba(248,113,113,.15);color:var(--red)}
  .prev{color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .scroll{max-height:52vh;overflow:auto} .empty{color:var(--muted);padding:22px 16px;text-align:center;font-size:13px}
  .flash{animation:fl 1s ease}@keyframes fl{from{background:rgba(79,140,255,.14)}to{background:transparent}}
  /* inspector modal */
  .backdrop{position:fixed;inset:0;background:rgba(4,8,16,.74);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .modal{background:var(--card);border:1px solid var(--line);border-radius:16px;width:min(780px,94vw);max-height:88vh;overflow:auto}
  .mh{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line)}
  .mh h3{font-size:15px} .mh h3 span{color:var(--muted);font-weight:400;font-size:13px;margin-left:6px}
  .x{cursor:pointer;color:var(--muted);font-size:16px;background:none;border:1px solid var(--line);border-radius:8px;padding:3px 9px}
  .mb{padding:16px 18px}
  .brk{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
  .brk span{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
  .brk b{color:var(--ink);font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
  .brk .cut{border-color:rgba(52,211,153,.4)} .brk .cut b{color:var(--green)}
  .brk .nt{color:var(--amber);border-color:rgba(251,191,36,.4)} .brk .keep b{color:var(--muted)}
  .tool{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
  .tool .tn{font-family:ui-monospace,Menlo,monospace;color:var(--cyan);font-weight:700;font-size:13px;margin-bottom:5px}
  .tool .d{font-size:12.5px;line-height:1.45}
  .tool .bef{color:#6b7a90;text-decoration:line-through;text-decoration-color:rgba(248,113,113,.55)}
  .tool .aft{color:var(--green)}
  .tool .ps{margin-top:7px;font-size:11.5px;color:var(--muted)}
  .pchip{font-family:ui-monospace,Menlo,monospace;font-size:11px;border:1px solid rgba(248,113,113,.35);border-radius:6px;padding:1px 6px;color:#f6a3a3;margin-right:4px}
  .hint{color:var(--muted);font-size:11px;margin-top:6px}
</style></head><body>
  <header>
    <h1>slim<b>·</b>agent<b>·</b>adapter</h1>
    <span class="chip" id="cfg">…</span>
    <span class="live"><span class="dot" id="dot"></span><span id="livetxt">connecting…</span></span>
  </header>
  <div class="kpis" id="kpis"></div>
  <div class="grid">
    <div class="panel"><h2>Sessions</h2><div class="scroll"><table id="sess">
      <thead><tr><th>Session</th><th>Model</th><th class="num">Reqs</th><th class="num">Saved</th></tr></thead><tbody></tbody></table></div></div>
    <div class="panel"><h2>Requests (live) · click a row to see the optimization</h2><div class="scroll"><table id="reqs">
      <thead><tr><th>#</th><th>Session</th><th>Prompt</th><th class="num">Tools</th><th class="num">Tokens</th><th class="num">Saved</th><th class="num">ttfb</th><th class="num">total</th><th>Status</th></tr></thead><tbody></tbody></table></div></div>
  </div>

  <div class="backdrop" id="bd" onclick="if(event.target.id==='bd')closeInspect()">
    <div class="modal"><div class="mh"><h3 id="mt">Prompt optimization</h3><button class="x" onclick="closeInspect()">✕ close</button></div><div class="mb" id="mbody"></div></div>
  </div>

<script>
const $=s=>document.querySelector(s);
const fmt=n=>n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':String(n);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function kpi(n,l,cls){return '<div class="kpi"><div class="n '+(cls||'')+'">'+n+'</div><div class="l">'+l+'</div></div>';}
let lastIds=new Set();
async function refresh(){
  let m; try{ m=await (await fetch('/metrics')).json(); }catch(e){ return; }
  const t=m.totals;
  $('#cfg').textContent='→ '+m.config.upstream.replace(/^https?:\\/\\//,'')+' · compress '+(m.config.compress?'on':'off')+' · no_think '+(m.config.noThink?'on':'off');
  $('#kpis').innerHTML=kpi(fmt(t.requests),'Requests','b')+kpi(fmt(t.tokensSaved),'Tokens saved','g')+kpi(t.avgSavedPct+'%','Avg savings','c')+kpi(t.avgLatency+'ms','Avg latency','v')+kpi(m.inflight,'In-flight',m.inflight?'a':'')+kpi(fmt(t.sessions),'Sessions','');
  $('#sess').querySelector('tbody').innerHTML = m.sessions.length? m.sessions.map(s=>'<tr><td class="sid">'+s.id+'</td><td class="prev">'+esc(s.model)+'</td><td class="num">'+s.requests+'</td><td class="num save">'+fmt(s.savedTokens)+'</td></tr>').join('') : '<tr><td colspan="4" class="empty">no sessions yet</td></tr>';
  $('#reqs').querySelector('tbody').innerHTML = m.recent.length? m.recent.map(r=>{
    const flash=!lastIds.has(r.id)?'flash':'';
    const toolsCell = !r.tools ? '<td class="num" style="color:#8ea2be">chat</td>'
      : (r.toolsKept!=null && r.toolsKept!==r.tools
          ? '<td class="num"><b style="color:#2dd4bf">'+r.toolsKept+'</b><span style="color:#5b6b85">/'+r.tools+'</span></td>'
          : '<td class="num">'+r.tools+'</td>');
    return '<tr class="'+flash+'" data-id="'+r.id+'" onclick="openInspect('+r.id+')" style="cursor:pointer"><td class="num">'+r.id+'</td><td class="sid">'+r.sessionId+'</td><td class="prev" title="'+esc(r.preview||'')+'" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.preview||'·')+'</td>'+toolsCell+'<td class="num">'+fmt(r.before)+'→'+fmt(r.after)+'</td><td class="num save">'+r.savedPct+'%</td><td class="num">'+(r.ttfbMs??'·')+'</td><td class="num">'+(r.totalMs??'·')+'</td><td><span class="pill p-'+r.status+'">'+r.status+'</span></td></tr>';
  }).join('') : '<tr><td colspan="9" class="empty">waiting for requests… send one through the adapter</td></tr>';
  lastIds=new Set(m.recent.map(r=>r.id));
}
async function openInspect(id){
  let d; try{ d=await (await fetch('/inspect?id='+id)).json(); }catch(e){ return; }
  if(d.error){ return; }
  const b=d.breakdown, cutPct=b.toolsBefore?Math.round((1-b.toolsAfter/b.toolsBefore)*100):0;
  const keptTools=d.tools.filter(t=>!t.dropped), dropTools=d.tools.filter(t=>t.dropped);
  const toolsHtml=keptTools.map(t=>{
    const trimmed=t.descBefore!==t.descAfter;
    let body='';
    if(trimmed){ body='<div class="d bef">'+esc(t.descBefore)+'</div><div class="d aft">'+esc(t.descAfter||'(description removed)')+'</div>'; }
    else if(t.descAfter){ body='<div class="d aft">'+esc(t.descAfter)+'</div>'; }
    const ps=t.paramsStripped.length?'<div class="ps">params slimmed (prose dropped, types/enums kept): '+t.paramsStripped.map(p=>'<span class="pchip">'+esc(p)+'</span>').join('')+'</div>':'';
    return '<div class="tool"><div class="tn">'+esc(t.name)+'</div>'+body+ps+'</div>';
  }).join('') || '<div class="empty">no tools in this request — this is a plain chat / utility call</div>';
  const dropHtml=dropTools.length?'<div style="margin-top:14px;color:#8ea2be;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Filtered out — not relevant to this prompt ('+dropTools.length+')</div><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">'+dropTools.map(t=>'<span class="mono" style="font-size:11px;color:#5b6b85;border:1px solid #24324a;border-radius:6px;padding:2px 7px;text-decoration:line-through">'+esc(t.name)+'</span>').join('')+'</div>':'';
  const rc={system:'#8ea2be',user:'#4f8cff',assistant:'#34d399',tool:'#a78bfa'};
  const msgsHtml=(d.messages||[]).map(mm=>{
    const c=rc[mm.role]||'#8ea2be';
    return '<div style="border-left:2px solid '+c+';padding:5px 10px;margin:6px 0;background:#0d1524;border-radius:6px">'+
      '<span class="mono" style="color:'+c+';font-size:11px;text-transform:uppercase;letter-spacing:.04em">'+esc(mm.role)+'</span>'+
      '<div style="color:#cdd8ec;margin-top:3px;white-space:pre-wrap;word-break:break-word">'+esc(mm.text||'(empty)')+'</div></div>';
  }).join('') || '<div class="empty">no messages</div>';
  const label='Request #'+d.id+(d.tools.length?' · '+d.tools.length+' tool schema(s)':' · plain chat (no tools)');
  $('#mt').innerHTML='Incoming request <span>'+label+'</span>';
  $('#mbody').innerHTML=
    '<div class="brk">'+
      '<span class="keep">system prompt <b>'+b.system+'</b> tok · untouched</span>'+
      '<span class="keep">conversation <b>'+b.messages+'</b> tok · untouched</span>'+
      '<span class="cut">tools <b>'+b.toolsBefore+'→'+b.toolsAfter+'</b> tok · −'+cutPct+'%</span>'+
      (d.noThink?'<span class="nt">/no_think injected</span>':'')+
    '</div>'+
    '<div class="hint">The adapter only compresses tool schemas (and disables thinking) — it never rewrites your system prompt or conversation. Plain chat/utility calls pass straight through.</div>'+
    '<div style="margin-top:16px;color:#8ea2be;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Prompt sent to the model</div>'+
    '<div style="margin-top:6px">'+msgsHtml+'</div>'+
    '<div style="margin-top:16px;color:#8ea2be;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Tools sent to the model ('+keptTools.length+(dropTools.length?' of '+d.tools.length:'')+')</div>'+
    '<div style="margin-top:6px">'+toolsHtml+'</div>'+
    dropHtml;
  $('#bd').style.display='flex';
}
function closeInspect(){ $('#bd').style.display='none'; }
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeInspect(); });
let deb; function nudge(){clearTimeout(deb);deb=setTimeout(refresh,120);}
try{const es=new EventSource('/events'); es.onopen=()=>{$('#livetxt').textContent='live';}; es.onmessage=nudge; es.onerror=()=>{$('#livetxt').textContent='reconnecting…';}; }catch(e){}
refresh(); setInterval(refresh,2000);
</script></body></html>`;
