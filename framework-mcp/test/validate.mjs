#!/usr/bin/env node
/**
 * MCP + adapter end-to-end validation.
 *
 * Layer 1 (MCP direct): spawn framework-mcp over stdio (FRAMEWORK_ONLY=1),
 *   assert the exact tool surface, then CALL every tool with real args and
 *   validate the output. Proves each action works.
 *
 * Layer 2 (through the adapter): drive the local 14B via the slim-agent-adapter
 *   (:1235) and confirm the model SELECTS the right tool and fills valid args
 *   for each action — and for two read-only tools, execute the model's chosen
 *   call back through MCP to close the full loop.
 *
 * Run: node test/validate.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FRAMEWORK_ROOT || path.resolve(HERE, "../../playwright-pom-framework");
const DIST = process.env.MCP_DIST || path.resolve(HERE, "../dist/index.js");
const ADAPTER = process.env.ADAPTER_URL || "http://localhost:1235";
const MODEL = process.env.MODEL || "qwen/qwen3-8b";

const rows = [];
const record = (layer, name, pass, detail) => {
  rows.push({ layer, name, pass, detail });
  const tag = pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${tag}] ${layer} · ${name} — ${detail}`);
};

const textOf = (res) =>
  (res?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

const EXPECTED_TOOLS = [
  "list_page_objects", "list_tests", "get_test_conventions", "search_code",
  "read_file", "get_architecture", "semantic_search", "build_rag_index",
  "retrieve_context", "code_map",
  "create_test_file", "write_architecture_doc", "run_test",
];

const PROBE_SPEC = `import { test, expect } from '../../src/fixtures/test-fixtures';

test.describe('MCP probe', () => {
  test('inventory loads for the standard user @smoke', async ({ loggedIn }) => {
    const names = await loggedIn.itemNames();
    expect(names.length).toBeGreaterThan(0);
  });
});
`;

async function metrics() {
  try {
    const r = await fetch(`${ADAPTER}/metrics`);
    return await r.json();
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n=== Layer 1: MCP direct tool execution (FRAMEWORK_ONLY=1) ===\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST],
    env: { ...process.env, FRAMEWORK_ONLY: "1", FRAMEWORK_ROOT: ROOT, MCP_HEADLESS: "1" },
  });
  const client = new Client({ name: "validator", version: "1.0.0" });
  await client.connect(transport);

  // Structural check: exact tool surface.
  const listed = (await client.listTools()).tools;
  const names = listed.map((t) => t.name).sort();
  const surfaceOk =
    names.length === EXPECTED_TOOLS.length &&
    EXPECTED_TOOLS.every((n) => names.includes(n));
  record("surface", "tool inventory", surfaceOk, `${names.length} tools: ${names.join(", ")}`);

  const call = async (name, args) => textOf(await client.callTool({ name, arguments: args }));

  const cases = [
    ["list_page_objects", {}, (t) => /LoginPage/.test(t) && /InventoryPage/.test(t)],
    ["list_tests", {}, (t) => /spec/i.test(t) && /@e2e|checkout|Authentication/i.test(t)],
    ["get_test_conventions", {}, (t) => /loggedIn/.test(t) && /(fixture|template|method)/i.test(t)],
    ["search_code", { query: "loggedIn" }, (t) => /test-fixtures/.test(t)],
    ["read_file", { path: "src/pages/LoginPage.ts", startLine: 1, endLine: 12 }, (t) => /class LoginPage/.test(t)],
    ["get_architecture", { scope: "overview" }, (t) => /```mermaid/.test(t) && /(flowchart|graph)/i.test(t)],
    ["get_architecture[pages]", { scope: "pages" }, (t) => /classDiagram/.test(t), "get_architecture"],
    ["build_rag_index", {}, (t) => /(chunk|index|embed)/i.test(t)],
    ["semantic_search", { query: "where do we sign in the standard user", topK: 3 }, (t) => /\.(ts|md)/.test(t)],
    ["retrieve_context", { query: "how do we log in the standard user", tokenBudget: 1000 }, (t) => /Context pack/.test(t) && /›/.test(t) && /LoginPage/.test(t)],
    ["code_map", { area: "pages" }, (t) => /class LoginPage/.test(t) && /\+ login/.test(t)],
    ["create_test_file", { path: "generated/_probe.spec.ts", content: PROBE_SPEC }, (t) => /Created/.test(t)],
    ["run_test", { path: "tests/generated/_probe.spec.ts" }, (t) => /passed/.test(t)],
    ["write_architecture_doc", { path: "ARCHITECTURE._probe.md" }, (t) => /Wrote/.test(t)],
  ];

  for (const [label, args, check, toolNameOverride] of cases) {
    try {
      const out = await call(toolNameOverride ?? label, args);
      const ok = check(out);
      record("mcp", label, ok, ok ? out.replace(/\s+/g, " ").slice(0, 80) : `unexpected: ${out.slice(0, 120)}`);
    } catch (e) {
      record("mcp", label, false, `threw: ${String(e).slice(0, 120)}`);
    }
  }

  // ── Layer 2: through the adapter (model selects + fills args) ──────────────
  console.log(`\n=== Layer 2: ${MODEL} tool selection THROUGH the adapter (:1235) ===\n`);

  const openaiTools = listed.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const before = await metrics();

  const askModel = async (prompt) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const r = await fetch(`${ADAPTER}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          max_tokens: 400,
          tools: openaiTools,
          tool_choice: "auto",
          messages: [
            { role: "system", content: "You are a Playwright test-automation assistant. Use exactly one of the provided tools to satisfy the user's request." },
            { role: "user", content: prompt },
          ],
        }),
      });
      const j = await r.json();
      return j?.choices?.[0]?.message?.tool_calls ?? [];
    } finally {
      clearTimeout(timer);
    }
  };

  const modelCases = [
    ["get_architecture", "Give me a Mermaid architecture diagram of this framework (overview scope)."],
    ["list_page_objects", "List every Page Object class and the methods it exposes."],
    ["get_test_conventions", "What test-writing conventions must I follow before I write a test here?"],
    ["list_tests", "List the existing spec files and their tags."],
    ["search_code", "Grep the framework source code for the term loggedIn."],
    ["read_file", "Open and show me the contents of the file src/pages/LoginPage.ts."],
    ["semantic_search", "Semantically search the framework for where we handle login failures."],
    ["build_rag_index", "Rebuild the semantic-search embedding index."],
    ["create_test_file", "Create a new spec file at generated/model_probe.spec.ts that checks the inventory page loads."],
    ["write_architecture_doc", "Generate and write the ARCHITECTURE.md documentation file."],
    ["run_test", "Run the smoke tests for me."],
  ];

  for (const [expected, prompt] of modelCases) {
    try {
      const calls = await askModel(prompt);
      const picked = calls.map((c) => c.function?.name);
      const hit = picked.includes(expected);
      let argsOk = true;
      if (hit) {
        const c = calls.find((c) => c.function?.name === expected);
        try { JSON.parse(c.function.arguments || "{}"); } catch { argsOk = false; }
      }
      record("adapter", expected, hit && argsOk,
        hit ? `model called ${expected}${argsOk ? "" : " (bad args JSON)"}` : `model picked [${picked.join(", ") || "none"}]`);
    } catch (e) {
      record("adapter", expected, false, `threw: ${String(e).slice(0, 100)}`);
    }
  }

  // Close the full loop for two read-only tools: execute the model's chosen call.
  console.log("\n=== Layer 2b: full loop (model → adapter → MCP execution) ===\n");
  for (const [expected, prompt] of [
    ["get_architecture", "Show me the overview architecture diagram."],
    ["list_page_objects", "List the page objects."],
  ]) {
    try {
      const calls = await askModel(prompt);
      const c = calls.find((c) => c.function?.name === expected);
      if (!c) { record("e2e", expected, false, "model did not pick the tool"); continue; }
      const args = JSON.parse(c.function.arguments || "{}");
      const out = await call(expected, args);
      record("e2e", expected, out.length > 0, `executed → ${out.replace(/\s+/g, " ").slice(0, 70)}`);
    } catch (e) {
      record("e2e", expected, false, `threw: ${String(e).slice(0, 100)}`);
    }
  }

  const after = await metrics();

  // ── Cleanup temp artifacts ────────────────────────────────────────────────
  for (const p of ["tests/generated/_probe.spec.ts", "ARCHITECTURE._probe.md"]) {
    try { fs.rmSync(path.join(ROOT, p)); } catch {}
  }
  try {
    const gen = path.join(ROOT, "tests/generated");
    if (fs.existsSync(gen) && fs.readdirSync(gen).length === 0) fs.rmdirSync(gen);
  } catch {}

  await client.close();

  // ── Report ────────────────────────────────────────────────────────────────
  const pass = rows.filter((r) => r.pass).length;
  const total = rows.length;
  const saved = before && after ? {
    reqs: after.totals.requests - before.totals.requests,
    before: after.totals.tokensBefore - before.totals.tokensBefore,
    after: after.totals.tokensAfter - before.totals.tokensAfter,
  } : null;

  console.log(`\n=== RESULT: ${pass}/${total} checks passed ===`);
  if (saved && saved.before > 0) {
    const pct = Math.round((1 - saved.after / saved.before) * 100);
    console.log(`Adapter over ${saved.reqs} model calls: ${saved.before} → ${saved.after} tool tokens (-${pct}%)\n`);
  }

  const md = [
    "# MCP + Adapter Validation Report",
    "",
    `Result: **${pass}/${total} checks passed**.`,
    saved && saved.before > 0
      ? `Adapter slimming over ${saved.reqs} live model calls: ${saved.before} → ${saved.after} tool tokens (**-${Math.round((1 - saved.after / saved.before) * 100)}%**).`
      : "",
    "",
    "| Layer | Check | Result | Detail |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.layer} | \`${r.name}\` | ${r.pass ? "✅ PASS" : "❌ FAIL"} | ${r.detail.replace(/\|/g, "\\|").slice(0, 90)} |`),
    "",
    "Layers: **surface** = exact 11-tool inventory · **mcp** = each tool executed directly over stdio · **adapter** = 14B selected+filled the tool through the slim-agent-adapter (:1235) · **e2e** = model's chosen call executed back through MCP.",
    "",
  ].join("\n");
  const outPath = path.resolve(HERE, "../VALIDATION.md");
  fs.writeFileSync(outPath, md);
  console.log("Wrote " + outPath);

  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("harness crashed:", e); process.exit(2); });
