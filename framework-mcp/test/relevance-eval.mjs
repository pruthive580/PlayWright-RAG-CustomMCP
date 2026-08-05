#!/usr/bin/env node
/**
 * Cross-repo retrieval-relevance eval. For every page-object method in each repo,
 * synthesizes a natural query from the method name and checks whether retrieve_context
 * surfaces that exact method in the top-k. Reports hit@k / MRR per repo and overall.
 *
 * These are NAME-DERIVED queries — a capability floor (favourable to retrieval), not a
 * hard semantic benchmark. Needs the embedding model loaded.
 *
 * Usage:  EVAL_DIR=/path/to/dir/of/cloned/repos node test/relevance-eval.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProject, listPageObjects } from "../dist/analysis.js";
import { buildIndex } from "../dist/rag.js";
import { retrieveContext } from "../dist/context.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.EVAL_DIR;
if (!base) { console.error("Set EVAL_DIR to a directory containing cloned Playwright repos."); process.exit(2); }
const K = Number(process.env.EVAL_K || 6);
const splitCamel = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase().trim();
const repos = fs.readdirSync(base).filter((d) => { try { return fs.statSync(path.join(base, d)).isDirectory(); } catch { return false; } }).sort();

let gTot = 0, gHit = 0, gRR = 0, rc = 0;
for (const r of repos) {
  const root = path.join(base, r);
  try { await buildIndex(root); } catch { continue; }
  const pos = listPageObjects(createProject(root), root).filter((p) => !p.abstract);
  const cases = [];
  for (const p of pos) for (const m of p.methods) {
    const name = m.split("(")[0];
    if (/^(constructor|goto|navigate)$/i.test(name) || name.length < 3) continue;
    cases.push({ cls: p.name, method: name, q: "how do we " + splitCamel(name) });
  }
  if (!cases.length) continue;
  let hit = 0, rr = 0;
  for (const c of cases) {
    const pack = await retrieveContext(root, c.q, { tokenBudget: 1200 });
    const rank = pack.items.findIndex((it) => it.symbol === `${c.cls}.${c.method}`) + 1;
    if (rank > 0 && rank <= K) { hit++; rr += 1 / rank; }
  }
  gTot += cases.length; gHit += hit; gRR += rr; rc++;
  console.log(`  ${r.padEnd(40)} ${String(cases.length).padStart(3)} methods · hit@${K} ${(100 * hit / cases.length).toFixed(0)}% · MRR ${(rr / cases.length).toFixed(2)}`);
}
console.log(`\n=== ${gHit}/${gTot} = ${(100 * gHit / gTot).toFixed(0)}% hit@${K} · MRR ${(gRR / gTot).toFixed(2)} across ${rc} repos (name-derived queries) ===`);
