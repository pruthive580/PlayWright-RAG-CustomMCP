#!/usr/bin/env node
/**
 * Interactive installer for the PlayWright · RAG · Custom MCP · Adapter bundle.
 * Zero dependencies. Run:  node setup.mjs
 *
 * It will: check prerequisites, ask for your framework path and spec tier,
 * build the MCP, (optionally) load the local models via LM Studio, and write a
 * ready-to-use VS Code MCP config + Copilot model config + adapter launch command.
 */
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // repo root
const NODE = process.execPath;
const C = { g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ${C.g}✓${C.x} ${s}`);
const warn = (s) => say(`  ${C.y}!${C.x} ${s}`);
const bad = (s) => say(`  ${C.r}✗${C.x} ${s}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) =>
  new Promise((res) => rl.question(`${C.c}?${C.x} ${q}${def ? ` ${C.d}[${def}]${C.x}` : ""} `, (a) => res((a || "").trim() || def || "")));
const isYes = (v) => /^y(es)?$/i.test(String(v));

function run(cmd, args, opts = {}) {
  say(`  ${C.d}$ ${cmd} ${args.join(" ")}${C.x}`);
  return spawnSync(cmd, args, { stdio: "inherit", ...opts }).status === 0;
}
function out(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}
function findLms() {
  const home = path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");
  if (fs.existsSync(home)) return home;
  const w = out(process.platform === "win32" ? "where" : "which", ["lms"]);
  return w ? w.split("\n")[0].trim() : null;
}

async function main() {
  say(`\n${C.b}PlayWright · RAG · Custom MCP · Adapter — installer${C.x}`);
  say(`${C.d}Fully-local AI framework assistant. This wizard sets everything up.${C.x}\n`);

  // ── Prerequisites ─────────────────────────────────────────────────────────
  say(`${C.b}1) Prerequisites${C.x}`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  nodeMajor >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} — need 18+`);
  const lms = findLms();
  lms ? ok(`LM Studio CLI: ${lms}`) : warn("LM Studio 'lms' CLI not found — install LM Studio from https://lmstudio.ai (then run its CLI bootstrap). Model loading will be skipped.");

  // ── Framework path ────────────────────────────────────────────────────────
  say(`\n${C.b}2) Framework to analyse${C.x}`);
  const sample = path.join(HERE, "playwright-pom-framework");
  let projectPath = await ask("Path to your Playwright framework (Enter = bundled sample):", sample);
  projectPath = path.resolve(projectPath);
  if (!fs.existsSync(projectPath)) { bad(`Not found: ${projectPath}`); rl.close(); process.exit(1); }
  ok(`Framework: ${projectPath}`);

  // ── Spec tier → model / adapter / context ─────────────────────────────────
  say(`\n${C.b}3) Your machine & model${C.x}`);
  say(`  ${C.d}1) Modest (<=24GB): Qwen3-8B + adapter  ${C.g}(recommended)${C.x}`);
  say(`  ${C.d}2) High-spec (32GB+ / strong GPU): Qwen3-14B, no adapter${C.x}`);
  say(`  ${C.d}3) Custom${C.x}`);
  const tier = await ask("Choose 1/2/3:", "1");
  let model = "qwen/qwen3-8b", useAdapter = true, ctx = 32768;
  if (tier === "2") { model = "qwen/qwen3-14b"; useAdapter = false; ctx = 32768; }
  else if (tier === "3") {
    model = await ask("Model id (as shown in `lms ls`):", "qwen/qwen3-8b");
    useAdapter = isYes(await ask("Enable the slim-agent-adapter? (y/n):", "y"));
    ctx = Number(await ask("Context length:", "32768")) || 32768;
  }
  const embModel = "text-embedding-nomic-embed-text-v1.5";
  const base = useAdapter ? "http://localhost:1235" : "http://localhost:1234";
  ok(`Model ${model} · context ${ctx} · adapter ${useAdapter ? "ON" : "OFF"} · endpoint ${base}`);

  const confirm = await ask("\nProceed with build + setup? (y/n):", "y");
  if (!isYes(confirm)) { warn("Aborted."); rl.close(); return; }

  // ── Build the MCP ─────────────────────────────────────────────────────────
  say(`\n${C.b}4) Build framework-mcp${C.x}`);
  const mcpDir = path.join(HERE, "framework-mcp");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: mcpDir }) ? ok("deps installed") : bad("npm install failed");
  run("npm", ["run", "build"], { cwd: mcpDir }) ? ok("built dist/") : bad("build failed");

  // ── Load models via LM Studio ─────────────────────────────────────────────
  say(`\n${C.b}5) Local models (LM Studio)${C.x}`);
  if (lms) {
    run(lms, ["server", "start"]);
    const listed = out(lms, ["ls"]) || "";
    for (const m of [model, embModel]) {
      if (!listed.includes(m.split("/").pop())) {
        warn(`'${m}' not downloaded yet. Open LM Studio → Discover tab, download it, then press Enter.`);
        await ask("Press Enter when downloaded (or to skip):", "");
      }
    }
    const loadArgs = [model, "-c", String(ctx), "--parallel", "1", "--gpu", "max"];
    run(lms, ["load", ...loadArgs]) ? ok(`loaded ${model} @ ${ctx}`) : warn(`could not load ${model} (download it in LM Studio first)`);
    run(lms, ["load", embModel]) ? ok(`loaded embeddings ${embModel}`) : warn("could not load embedding model");
  } else {
    warn("Skipping model load (no lms CLI). Install LM Studio, then load:");
    say(`     lms load ${model} -c ${ctx} --parallel 1 --gpu max`);
    say(`     lms load ${embModel}`);
  }

  // ── Write configs ─────────────────────────────────────────────────────────
  say(`\n${C.b}6) Write configuration${C.x}`);
  const mcpJson = {
    servers: {
      framework: {
        type: "stdio",
        command: NODE,
        args: [path.join(mcpDir, "dist", "index.js")],
        env: { FRAMEWORK_ROOT: projectPath, FRAMEWORK_ONLY: "1" },
      },
    },
  };
  fs.mkdirSync(path.join(HERE, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(HERE, ".vscode", "mcp.json"), JSON.stringify(mcpJson, null, 2));
  ok(".vscode/mcp.json (open the repo root in VS Code, then MCP: List Servers → framework → Start)");

  const gen = path.join(HERE, "generated");
  fs.mkdirSync(gen, { recursive: true });
  const modelCfg = { id: model, name: `${model} (local${useAdapter ? ", via adapter" : ""})`, url: `${base}/v1/chat/completions`, toolCalling: true, vision: false, maxInputTokens: Math.max(8000, ctx - 6000), maxOutputTokens: 4096 };
  fs.writeFileSync(path.join(gen, "vscode-model.json"), JSON.stringify(modelCfg, null, 2));
  ok("generated/vscode-model.json (paste into Copilot → Manage Models → OpenAI-compatible)");

  let adapterCmd = "";
  if (useAdapter) {
    const overrides = path.join(HERE, "slim-agent-adapter", "overrides.example.json");
    adapterCmd = `TOOL_FILTER=1 TOOL_FILTER_KEEP='^mcp_' TOOL_DENY='create_new_workspace|new_workspace' OVERRIDES='${overrides}' ${NODE} '${path.join(HERE, "slim-agent-adapter", "index.mjs")}'`;
    const sh = `#!/usr/bin/env bash\n# Start the slim-agent-adapter (:1235). Dashboard: http://localhost:1235/dashboard\n${adapterCmd}\n`;
    fs.writeFileSync(path.join(gen, "start-adapter.sh"), sh, { mode: 0o755 });
    ok("generated/start-adapter.sh");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  say(`\n${C.g}${C.b}Setup complete.${C.x} Next steps:\n`);
  let n = 1;
  if (useAdapter) { say(`  ${n++}. Start the adapter:  ${C.c}bash generated/start-adapter.sh${C.x}  ${C.d}(dashboard: http://localhost:1235/dashboard)${C.x}`); }
  else { say(`  ${n++}. Adapter is OFF — VS Code talks to LM Studio (:1234) directly.`); }
  say(`  ${n++}. In VS Code settings, set  ${C.c}"chat.byokUtilityModelDefault": "mainAgent"${C.x}`);
  say(`  ${n++}. Copilot → Manage Models → add the OpenAI-compatible model from  ${C.c}generated/vscode-model.json${C.x}`);
  say(`  ${n++}. Open ${C.c}${HERE}${C.x} in VS Code → Command Palette → "MCP: List Servers" → ${C.c}framework${C.x} → Start`);
  say(`  ${n++}. Agent mode, pick the local model, try:  ${C.c}"How do we log in the standard user?"${C.x}\n`);
  rl.close();
}

main().catch((e) => { bad(String(e && e.stack || e)); rl.close(); process.exit(1); });
