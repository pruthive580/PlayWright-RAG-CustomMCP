#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import { execFile } from "node:child_process";
import {
  createProject,
  listPageObjects,
  listTests,
  searchCode,
  readFileSafe,
  createTestFile,
  architecture,
  getTestConventions,
  writeArchitectureDoc,
} from "./analysis.js";
import { semanticSearch, buildIndex } from "./rag.js";
import { retrieveContext, codeMap, relatedCode } from "./context.js";
import { runDiagnose } from "./diagnose.js";
import { BrowserSession } from "./browser.js";

const ROOT = path.resolve(
  process.env.FRAMEWORK_ROOT || process.argv[2] || process.cwd(),
);
const HEADLESS = process.env.MCP_HEADLESS === "1";

const server = new McpServer({ name: "framework-mcp", version: "2.0.0" });
const browser = new BrowserSession(HEADLESS);

function reply(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

// ─── Framework understanding ────────────────────────────────────────────────

server.registerTool(
  "list_page_objects",
  {
    title: "List Page Objects",
    description:
      "List every Playwright Page Object class with its public methods and locators. Call before writing a test so you use real methods.",
    inputSchema: {},
  },
  async () => reply(listPageObjects(createProject(ROOT), ROOT)),
);

server.registerTool(
  "list_tests",
  {
    title: "List Tests",
    description:
      "List spec files with describe blocks, test titles, and tags. Use as examples of the framework's conventions.",
    inputSchema: {},
  },
  async () => reply(listTests(ROOT)),
);

server.registerTool(
  "get_test_conventions",
  {
    title: "Get Test Conventions",
    description:
      "Return THIS framework's test-writing rules: import header, available fixtures, page-object method catalog, tag vocabulary, data files, and a template. ALWAYS call this before generating a test so the output matches the framework's Page Object Model pattern instead of raw Playwright.",
    inputSchema: {},
  },
  async () => reply(getTestConventions(createProject(ROOT), ROOT)),
);

server.registerTool(
  "search_code",
  {
    title: "Search Code",
    description: "Grep the framework source (.ts/.json/.md) for a string or regex. Returns file:line matches.",
    inputSchema: {
      query: z.string().describe("Text or regular expression"),
      regex: z.boolean().optional(),
      maxResults: z.number().optional(),
    },
  },
  async ({ query, regex, maxResults }) => reply(searchCode(ROOT, query, { regex, maxResults })),
);

server.registerTool(
  "read_file",
  {
    title: "Read File",
    description: "Read a framework file (path relative to the framework root), optionally a line range.",
    inputSchema: { path: z.string(), startLine: z.number().optional(), endLine: z.number().optional() },
  },
  async ({ path: rel, startLine, endLine }) => reply(readFileSafe(ROOT, rel, startLine, endLine)),
);

server.registerTool(
  "get_architecture",
  {
    title: "Get Architecture Diagram",
    description:
      "Return a Mermaid diagram from static analysis. scope='overview' (dependency flowchart) or 'pages' (class diagram). Return the diagram to the user verbatim; do not rewrite it.",
    inputSchema: { scope: z.enum(["overview", "pages"]).default("overview") },
  },
  async ({ scope }) => reply("```mermaid\n" + architecture(createProject(ROOT), ROOT, scope) + "\n```"),
);

server.registerTool(
  "semantic_search",
  {
    title: "Semantic Search (RAG)",
    description:
      "Natural-language vector search over the framework using local embeddings. Use for fuzzy 'where/how do we…' questions that exact grep can't answer (e.g. 'where do we handle authentication failures'). Returns the most relevant code/doc chunks with file:line and a similarity score. Builds the local index automatically on first use.",
    inputSchema: { query: z.string().describe("Natural-language question"), topK: z.number().optional() },
  },
  async ({ query, topK }) => reply(await semanticSearch(ROOT, query, topK ?? 6)),
);

server.registerTool(
  "build_rag_index",
  {
    title: "Build RAG Index",
    description:
      "(Re)build the local embedding index for the framework. Run after significant code changes so semantic_search reflects the latest source.",
    inputSchema: {},
  },
  async () => reply(await buildIndex(ROOT)),
);

server.registerTool(
  "retrieve_context",
  {
    title: "Retrieve Context (RAG pack)",
    description:
      "PREFERRED first step for understanding the codebase before you answer a question or write a test. Give a natural-language query; returns a compact, TOKEN-BUDGETED context pack — the most relevant code/test/doc chunks, AST-aware (whole methods/classes, not line fragments), ranked by hybrid semantic+keyword score, de-duplicated (MMR), each with a 'file › symbol [lines]' citation. Use this INSTEAD of reading whole files — it keeps the small local context window focused. Options: tokenBudget (default 2500) and kinds (method/class/function/statement/test/doc).",
    inputSchema: {
      query: z.string().describe("Natural-language question about the framework"),
      tokenBudget: z.number().optional(),
      kinds: z.array(z.enum(["method", "class", "function", "statement", "test", "doc"])).optional(),
    },
  },
  async ({ query, tokenBudget, kinds }) => {
    const pack = await retrieveContext(ROOT, query, { tokenBudget, kinds });
    const header = `Context pack for: "${pack.query}" — ${pack.items.length} chunks, ~${pack.tokensUsed} tokens (budget ${pack.tokenBudget})`;
    return reply(pack.items.length ? `${header}\n\n${pack.text}` : `${header}\n\n(no relevant chunks found — try rephrasing or a broader query)`);
  },
);

server.registerTool(
  "code_map",
  {
    title: "Code Map (skeleton)",
    description:
      "Return a signatures-only skeleton of the framework — classes with their public methods, plus exported functions and constants, grouped by file. Cheap BREADTH when you need the shape of the codebase without spending tokens on full source. Optional 'area' substring filter (e.g. 'pages', 'tests', 'data').",
    inputSchema: { area: z.string().optional() },
  },
  async ({ area }) => reply(codeMap(ROOT, { area })),
);

server.registerTool(
  "related_code",
  {
    title: "Related Code (structural / import graph)",
    description:
      "Given a file path or a symbol name (class / exported function), return its dependency neighbourhood: the symbols it defines, the project files it imports (dependencies), and the files that import it (dependents). Use this to understand impact/coupling before editing — the structural complement to retrieve_context.",
    inputSchema: { target: z.string().describe("A file path (relative to root) or a class/function name") },
  },
  async ({ target }) => reply(relatedCode(ROOT, target)),
);

// ─── Browser automation ─────────────────────────────────────────────────────
// Disabled when FRAMEWORK_ONLY=1 — use this when the official @playwright/mcp
// server is running alongside and owns all browser driving (no tool overlap).
if (!process.env.FRAMEWORK_ONLY) {
server.registerTool(
  "browser_navigate",
  {
    title: "Browser: Navigate",
    description: "Open a URL in the live browser session. Then call browser_snapshot to see the page.",
    inputSchema: { url: z.string().describe("Full URL, e.g. https://www.saucedemo.com") },
  },
  async ({ url }) => reply(await browser.navigate(url)),
);

server.registerTool(
  "browser_snapshot",
  {
    title: "Browser: Snapshot",
    description:
      "Return the current page's interactive elements, each with a ref (e1, e2, …) and a selector. Use a ref or selector with the click/type tools. Call after every navigation or action that changes the page.",
    inputSchema: {},
  },
  async () => reply(await browser.snapshot()),
);

server.registerTool(
  "browser_click",
  {
    title: "Browser: Click",
    description: "Click an element by ref (from the latest snapshot) or by CSS selector.",
    inputSchema: { ref: z.string().optional(), selector: z.string().optional() },
  },
  async ({ ref, selector }) => reply(await browser.click(ref, selector)),
);

server.registerTool(
  "browser_type",
  {
    title: "Browser: Type",
    description: "Fill text into an input by ref or selector. Set submit=true to press Enter after.",
    inputSchema: {
      ref: z.string().optional(),
      selector: z.string().optional(),
      text: z.string(),
      submit: z.boolean().optional(),
    },
  },
  async ({ ref, selector, text, submit }) => reply(await browser.type(ref, selector, text, submit)),
);

server.registerTool(
  "browser_select_option",
  {
    title: "Browser: Select Option",
    description: "Select an option (by value) in a <select> by ref or selector.",
    inputSchema: { ref: z.string().optional(), selector: z.string().optional(), value: z.string() },
  },
  async ({ ref, selector, value }) => reply(await browser.selectOption(ref, selector, value)),
);

server.registerTool(
  "browser_press_key",
  {
    title: "Browser: Press Key",
    description: "Press a keyboard key (e.g. Enter, Tab, Escape).",
    inputSchema: { key: z.string() },
  },
  async ({ key }) => reply(await browser.pressKey(key)),
);

server.registerTool(
  "browser_screenshot",
  {
    title: "Browser: Screenshot",
    description: "Capture a PNG screenshot of the current page.",
    inputSchema: {},
  },
  async () => {
    const buf = await browser.screenshot();
    return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" }] };
  },
);

server.registerTool(
  "browser_console",
  {
    title: "Browser: Console Messages",
    description: "Return console logs and page errors captured during this browser session.",
    inputSchema: {},
  },
  async () => reply(browser.consoleMessages()),
);

server.registerTool(
  "browser_get_recorded_steps",
  {
    title: "Browser: Recorded Steps",
    description:
      "Return the raw actions performed this session (navigate/click/type/select), each with its selector and value. Translate these into page-object method calls (using get_test_conventions and list_page_objects) to write a framework-style test.",
    inputSchema: {},
  },
  async () => reply(browser.steps),
);

server.registerTool(
  "browser_close",
  {
    title: "Browser: Close",
    description: "Close the live browser session.",
    inputSchema: {},
  },
  async () => reply(await browser.close()),
);
} // end browser tools (FRAMEWORK_ONLY guard)

// ─── Test generation + running ──────────────────────────────────────────────

server.registerTool(
  "create_test_file",
  {
    title: "Create Test File",
    description:
      "Write a new spec into tests/ (path relative to tests/, must end with .spec.ts). Call get_test_conventions and list_page_objects first so the spec uses the framework's fixtures and page-object methods (never raw page.* calls).",
    inputSchema: { path: z.string(), content: z.string() },
  },
  async ({ path: rel, content }) => reply(`Created ${createTestFile(ROOT, rel, content)}`),
);

server.registerTool(
  "write_architecture_doc",
  {
    title: "Write Architecture Doc",
    description:
      "Generate a complete architecture markdown file (both Mermaid diagrams + page-object/method table + test tags) and WRITE it into the framework in one deterministic call. Prefer this over composing the doc yourself — it never mis-types the diagram. Optional 'path' relative to the framework root (default ARCHITECTURE.md).",
    inputSchema: { path: z.string().optional() },
  },
  async ({ path: rel }) => reply(`Wrote ${writeArchitectureDoc(createProject(ROOT), ROOT, rel)}`),
);

server.registerTool(
  "run_test",
  {
    title: "Run Test",
    description:
      "Run Playwright tests in the framework. Pass a spec path (relative to the framework root) to run one file, or omit to run all. Returns the result summary.",
    inputSchema: { path: z.string().optional(), grep: z.string().optional() },
  },
  async ({ path: rel, grep }) => {
    const bin = path.join(ROOT, "node_modules", ".bin", "playwright");
    const args = ["test"];
    if (rel) args.push(rel);
    if (grep) args.push("--grep", grep);
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` };
    const out: string = await new Promise((resolve) => {
      execFile(bin, args, { cwd: ROOT, env, timeout: 180_000 }, (err, stdout, stderr) => {
        const body = `${stdout}\n${stderr}`.trim();
        resolve(body || (err ? String(err) : "(no output)"));
      });
    });
    return reply(out.length > 4000 ? out.slice(-4000) : out);
  },
);

server.registerTool(
  "diagnose_test",
  {
    title: "Diagnose Test (run + parse failures + fix context)",
    description:
      "Run a spec (or all tests) and return a STRUCTURED result: pass/fail/skip counts and, for each failure, the test title, file:line, and the error message — PLUS a retrieve_context pack relevant to the top failure so you can fix it immediately. Use this as a repair loop: diagnose_test → edit the spec with create_test_file → diagnose_test again, until failed=0.",
    inputSchema: { path: z.string().optional(), grep: z.string().optional() },
  },
  async ({ path: rel, grep }) => {
    const res = await runDiagnose(ROOT, { path: rel, grep });
    const payload: Record<string, unknown> = { passed: res.passed, failed: res.failed, skipped: res.skipped, failures: res.failures };
    if (res.raw) payload.raw = res.raw;
    if (res.failures.length) {
      const f = res.failures[0];
      const pack = await retrieveContext(ROOT, `${f.title} ${f.message}`, { tokenBudget: 1500 });
      if (pack.items.length) payload.fixContext = pack.text;
    }
    return reply(payload);
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`framework-mcp v2 connected. FRAMEWORK_ROOT=${ROOT} headless=${HEADLESS}`);
}

main().catch((err) => {
  console.error("framework-mcp failed to start:", err);
  process.exit(1);
});
