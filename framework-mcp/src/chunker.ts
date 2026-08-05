import { Project, SyntaxKind } from "ts-morph";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * AST-aware chunking. Instead of arbitrary sliding windows, chunk source by
 * meaningful units — a class summary, each method, each top-level function or
 * declaration, each test() — so every retrieved chunk is a complete, self-
 * contained thought. Markdown is chunked by heading section. Oversized units
 * fall back to bounded line windows.
 */
export interface CtxChunk {
  file: string;
  symbol: string; // e.g. "LoginPage.login", "class LoginPage", "invalidLogins", "test: rejects login"
  kind: "method" | "class" | "function" | "statement" | "test" | "doc";
  startLine: number;
  endLine: number;
  text: string;
}

const MAX_LINES = 70;

function splitOversize(c: CtxChunk): CtxChunk[] {
  const lines = c.text.split("\n");
  if (lines.length <= MAX_LINES) return [c];
  const out: CtxChunk[] = [];
  const win = 55;
  const step = 45;
  for (let s = 0; s < lines.length; s += step) {
    const body = lines.slice(s, s + win).join("\n").trim();
    if (body.length >= 20) {
      out.push({
        ...c,
        text: body,
        startLine: c.startLine + s,
        endLine: c.startLine + Math.min(s + win, lines.length) - 1,
        symbol: s ? `${c.symbol} (part ${Math.floor(s / step) + 1})` : c.symbol,
      });
    }
    if (s + win >= lines.length) break;
  }
  return out.length ? out : [c];
}

function chunkLines(rel: string, text: string, kind: CtxChunk["kind"] = "statement", symbol?: string, win = 45, overlap = 10): CtxChunk[] {
  const lines = text.split("\n");
  const out: CtxChunk[] = [];
  const step = Math.max(1, win - overlap);
  for (let s = 0; s < lines.length; s += step) {
    const body = lines.slice(s, s + win).join("\n").trim();
    if (body.length >= 20) out.push({ file: rel, symbol: symbol || rel, kind, startLine: s + 1, endLine: Math.min(s + win, lines.length), text: body });
    if (s + win >= lines.length) break;
  }
  return out;
}

function chunkMarkdown(rel: string, text: string): CtxChunk[] {
  const lines = text.split("\n");
  const chunks: CtxChunk[] = [];
  let start = 0;
  let heading = rel;
  const flush = (end: number) => {
    const body = lines.slice(start, end).join("\n").trim();
    if (body.length >= 20) chunks.push({ file: rel, symbol: heading, kind: "doc", startLine: start + 1, endLine: end, text: body });
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      if (i > start) flush(i);
      start = i;
      heading = lines[i].replace(/^#+\s*/, "").trim() || rel;
    }
  }
  flush(lines.length);
  return chunks;
}

interface Lineable { getText(): string; getStartLineNumber(): number; getEndLineNumber(): number }

function chunkTs(rel: string, file: string): CtxChunk[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: false, skipLibCheck: true } });
  let sf;
  try { sf = project.addSourceFileAtPath(file); } catch { return chunkLines(rel, fs.readFileSync(file, "utf8")); }

  const chunks: CtxChunk[] = [];
  const add = (symbol: string, kind: CtxChunk["kind"], node: Lineable) => {
    const t = node.getText().trim();
    if (t.length >= 20) chunks.push({ file: rel, symbol, kind, startLine: node.getStartLineNumber(), endLine: node.getEndLineNumber(), text: t });
  };

  for (const cls of sf.getClasses()) {
    const name = cls.getName() ?? "Anon";
    const ext = cls.getExtends()?.getExpression().getText();
    const props = cls.getProperties().map((p) => p.getText().trim());
    const sigs = cls.getMethods().map((m) => `${m.getName()}(${m.getParameters().map((p) => p.getName()).join(", ")})`);
    const summary = [`class ${name}${ext ? ` extends ${ext}` : ""} {`, ...props.map((p) => "  " + p), ...sigs.map((s) => "  " + s + ";"), "}"].join("\n");
    chunks.push({ file: rel, symbol: `class ${name}`, kind: "class", startLine: cls.getStartLineNumber(), endLine: cls.getEndLineNumber(), text: summary });
    for (const m of cls.getMethods()) add(`${name}.${m.getName()}`, "method", m);
  }
  for (const fn of sf.getFunctions()) { const n = fn.getName(); if (n) add(n, "function", fn); }
  for (const vs of sf.getVariableStatements()) { const d = vs.getDeclarations()[0]; add(d?.getName() ?? "const", "statement", vs); }
  if (rel.endsWith(".spec.ts")) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText();
      if (callee === "test" || /^test\.(only|skip|fixme)$/.test(callee)) {
        const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ?? call;
        const title = (call.getArguments()[0]?.getText() ?? "test").replace(/['"`]/g, "");
        add(`test: ${title.slice(0, 48)}`, "test", stmt);
      }
    }
  }
  return chunks.length ? chunks : chunkLines(rel, sf.getFullText());
}

/** Chunk a single .ts or .md file into AST-aware units. */
export function chunkFileAst(root: string, file: string): CtxChunk[] {
  const rel = path.relative(root, file);
  let raw: CtxChunk[];
  if (file.endsWith(".md")) raw = chunkMarkdown(rel, fs.readFileSync(file, "utf8"));
  else if (file.endsWith(".ts")) raw = chunkTs(rel, file);
  else return [];
  return raw.flatMap(splitOversize);
}
