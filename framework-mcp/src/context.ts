import * as path from "node:path";
import { Scope } from "ts-morph";
import { createProject } from "./analysis.js";
import { embed, cosine, ensureIndex, loadIndex, IndexedChunk } from "./rag.js";

/**
 * The context engine. Turns "understand the codebase" into a tight, token-
 * budgeted context pack a small-context local model can actually use:
 *   hybrid ranking (semantic + lexical) -> relevance filter -> MMR de-dup ->
 *   pack to a token budget. Plus a signatures-only code map for cheap breadth.
 */
const STOP = new Set(
  "the a an of to in for on and or is are be am was were with without your you it we this that these those use used using return returns get set list all any some no not into then from at by as off out over how where what which when do does done make new".split(/\s+/),
);
function terms(s: string): string[] {
  return (String(s || "").toLowerCase().match(/[a-z0-9_]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
}
const estTokens = (s: string) => Math.ceil(s.length / 4);

/** Lexical overlap of the query with a chunk, with a boost for symbol/file-name hits. */
function lexicalScore(qTerms: Set<string>, chunk: IndexedChunk): number {
  if (qTerms.size === 0) return 0;
  const body = new Set(terms(`${chunk.symbol} ${chunk.file} ${chunk.text}`));
  const ident = new Set(terms(`${chunk.symbol} ${chunk.file}`));
  let bodyHit = 0;
  let identHit = 0;
  for (const t of qTerms) {
    if (body.has(t)) bodyHit++;
    if (ident.has(t)) identHit++;
  }
  return (bodyHit / qTerms.size) * 0.7 + (identHit / qTerms.size) * 0.3;
}

export interface ContextItem {
  file: string;
  symbol: string;
  kind: string;
  startLine: number;
  endLine: number;
  score: number;
  text: string;
}
export interface ContextPack {
  query: string;
  tokenBudget: number;
  tokensUsed: number;
  items: ContextItem[];
  text: string;
}

export interface RetrieveOptions {
  tokenBudget?: number;
  kinds?: string[];
  candidates?: number;
  minScore?: number;
  lambda?: number;
}

/**
 * Retrieve a curated context pack for a natural-language query.
 * Hybrid score = 0.65*semantic + 0.35*lexical; candidates are filtered by a
 * relevance floor, then MMR (lambda) trades relevance against diversity while
 * packing chunks until the token budget is reached.
 */
export async function retrieveContext(root: string, query: string, opts: RetrieveOptions = {}): Promise<ContextPack> {
  const tokenBudget = opts.tokenBudget ?? 2500;
  const candidatesN = opts.candidates ?? 40;
  const minScore = opts.minScore ?? 0.12;
  const lambda = opts.lambda ?? 0.7;
  const maxItems = 12;

  await ensureIndex(root);
  let chunks = loadIndex(root);
  if (opts.kinds && opts.kinds.length) chunks = chunks.filter((c) => opts.kinds!.includes(c.kind));

  const [qvec] = await embed([query]);
  const qTerms = new Set(terms(query));

  const scored = chunks
    .map((c) => {
      const sem = cosine(qvec, c.vector);
      const lex = lexicalScore(qTerms, c);
      return { c, score: 0.65 * sem + 0.35 * lex };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, candidatesN);

  // MMR selection within the token budget.
  const selected: { c: IndexedChunk; score: number }[] = [];
  let used = 0;
  const pool = [...scored];
  while (pool.length && selected.length < maxItems && used < tokenBudget) {
    let bestI = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const s of selected) maxSim = Math.max(maxSim, cosine(pool[i].c.vector, s.c.vector));
      const mmr = lambda * pool[i].score - (1 - lambda) * maxSim;
      if (mmr > bestVal) { bestVal = mmr; bestI = i; }
    }
    if (bestI < 0) break;
    const [chosen] = pool.splice(bestI, 1);
    const cost = estTokens(chosen.c.text) + 12;
    if (selected.length > 0 && used + cost > tokenBudget) continue; // too big now — skip, keep filling with smaller
    selected.push(chosen);
    used += cost;
  }

  const items: ContextItem[] = selected.map((s) => ({
    file: s.c.file,
    symbol: s.c.symbol,
    kind: s.c.kind,
    startLine: s.c.startLine,
    endLine: s.c.endLine,
    score: Number(s.score.toFixed(3)),
    text: s.c.text,
  }));
  const text = items
    .map((it) => `// ${it.file} › ${it.symbol}  [L${it.startLine}-${it.endLine}] (${it.kind}, score ${it.score})\n${it.text}`)
    .join("\n\n---\n\n");

  return { query, tokenBudget, tokensUsed: used, items, text };
}

/** A signatures-only skeleton of the framework — breadth without the token cost of full source. */
export function codeMap(root: string, opts: { area?: string } = {}): string {
  const project = createProject(root);
  const rel = (p: string) => path.relative(root, p);
  const files = project
    .getSourceFiles()
    .filter((sf) => !opts.area || sf.getFilePath().includes(opts.area))
    .sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));

  const out: string[] = [];
  for (const sf of files) {
    const lines: string[] = [];
    for (const cls of sf.getClasses()) {
      const ext = cls.getExtends()?.getExpression().getText();
      lines.push(`class ${cls.getName() ?? "Anon"}${ext ? ` extends ${ext}` : ""}${cls.isAbstract() ? " «abstract»" : ""}`);
      for (const m of cls.getInstanceMethods().filter((x) => x.getScope() !== Scope.Private)) {
        lines.push(`  + ${m.getName()}(${m.getParameters().map((p) => p.getName()).join(", ")})`);
      }
    }
    for (const fn of sf.getFunctions()) {
      if (fn.isExported() && fn.getName()) lines.push(`fn ${fn.getName()}(${fn.getParameters().map((p) => p.getName()).join(", ")})`);
    }
    for (const vs of sf.getVariableStatements()) {
      if (vs.isExported()) for (const d of vs.getDeclarations()) lines.push(`const ${d.getName()}`);
    }
    if (lines.length) {
      out.push(`### ${rel(sf.getFilePath())}`);
      out.push(...lines, "");
    }
  }
  return out.join("\n").trim() || "(no exported symbols found)";
}
