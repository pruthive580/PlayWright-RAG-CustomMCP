#!/usr/bin/env node
/**
 * Test-generation correctness on arbitrary frameworks. For each repo, feeds a local
 * model that repo's detected conventions (import header, fixtures, page objects) and
 * asks for one spec, then statically verifies the result: uses the repo's header,
 * references a real page object/fixture, has a test(), and parses as valid TypeScript.
 *
 * Usage:  EVAL_DIR=/path/to/repos [MODEL=qwen/qwen3-8b] [MODEL_URL=http://localhost:1234/v1/chat/completions] node test/gen-eval.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ts } from "ts-morph";
import { createProject, listPageObjects, getTestConventions, extractCode } from "../dist/analysis.js";

const base = process.env.EVAL_DIR;
if (!base) { console.error("Set EVAL_DIR to a directory containing cloned Playwright repos."); process.exit(2); }
const MODEL = process.env.MODEL || "qwen/qwen3-8b";
const URL = process.env.MODEL_URL || "http://localhost:1234/v1/chat/completions";
const repos = fs.readdirSync(base).filter((d) => { try { return fs.statSync(path.join(base, d)).isDirectory(); } catch { return false; } }).sort();

const parses = (code) => { const o = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true }); return (o.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length === 0; };
async function gen(messages) {
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 700, messages }) });
  return ((await r.json()).choices?.[0]?.message?.content || "");
}

let H = 0, P = 0, T = 0, V = 0, N = 0;
for (const r of repos) {
  const root = path.join(base, r);
  const conv = getTestConventions(createProject(root), root);
  const pos = listPageObjects(createProject(root), root).filter((p) => !p.abstract && p.methods.length);
  if (!pos.length) continue;
  const target = pos.sort((a, b) => b.methods.length - a.methods.length)[0];
  const spec = (conv.importHeader.match(/from ['"]([^'"]+)['"]/) || [])[1] || "@playwright/test";
  const raw = await gen([
    { role: "system", content: "You write exactly ONE Playwright test spec in TypeScript following the given framework conventions. Output ONLY code." },
    { role: "user", content: `Import header (use EXACTLY): ${conv.importHeader}\nFixtures: ${conv.fixtures.join(", ") || "(none — import the page object class)"}\nPage objects & methods:\n${pos.map((p) => `${p.name}: ${p.methods.slice(0, 8).join(", ")}`).join("\n")}\n\nWrite a short spec using ${target.name} with one action and one expect() assertion. /no_think` },
  ]);
  const code = extractCode(raw);
  const names = [...pos.map((p) => p.name), ...conv.fixtures];
  const hasHeader = code.includes(spec), usesPO = names.some((n) => new RegExp("\\b" + n + "\\b").test(code)), hasTest = /\btest\s*\(/.test(code), ok = parses(code);
  N++; H += hasHeader; P += usesPO; T += hasTest; V += ok;
  console.log(`  ${r.padEnd(40)} header ${hasHeader ? "✓" : "✗"} · PO/fixture ${usesPO ? "✓" : "✗"} · test() ${hasTest ? "✓" : "✗"} · valid TS ${ok ? "✓" : "✗"}`);
}
console.log(`\n=== ${N} unseen repos: header ${H}/${N} · framework PO/fixture ${P}/${N} · test() ${T}/${N} · valid TS ${V}/${N} ===`);
