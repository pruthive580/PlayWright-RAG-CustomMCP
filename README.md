# PlayWright · RAG · Custom MCP · Adapter

**A framework-aware AI coding assistant that runs _fully local_ on a 24 GB laptop.**

> Made GitHub Copilot's **agent mode** run well on a fully local **Qwen3-8B (32K)** on a **24 GB Apple-Silicon** machine — by cutting per-turn **tool/prompt overhead** with a model-agnostic adapter and feeding only **relevant context** through a RAG engine. **No cloud, no API keys.**

Most "run AI coding locally" setups die not because the model is bad, but because the **tool payload + context overwhelm** small models on modest hardware. This bundle solves *both ends at once* — shrink what's **sent** each turn, and feed only what's **relevant** — so a small local model punches well above its weight.

---

## What's in the box

| Component | What it is |
|---|---|
| 🧠 **`framework-mcp`** | A **Custom MCP server + context engine**. Gives the model deep, structured knowledge of *your* Playwright framework (page objects, fixtures, conventions), generates tests in *your* pattern, draws architecture diagrams from real static analysis (ts-morph), and — the headline — a **RAG context engine** that returns a tight, token-budgeted slice of the codebase per question. |
| ⚡ **`slim-agent-adapter`** | A **zero-dependency, model-agnostic** OpenAI-compatible proxy. Filters the tool payload down to what the current prompt needs, slims tool schemas, disables Qwen3 "thinking", and ships a **live dashboard**. This is what makes agent mode usable on modest hardware. |
| 🎭 **`playwright-pom-framework`** | A **sample Playwright + TypeScript Page Object Model** framework (SauceDemo) — the system-under-test the MCP understands. 7 spec files, 18 tests, smoke → complex. |
| 🌐 **Playwright MCP** *(optional)* | The official [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) for live browser automation. **Off by default** to keep the tool load light; enable it only when you need a real browser. |

---

## Architecture

```mermaid
flowchart TB
  subgraph vscode["VS Code · Copilot Agent mode"]
    chat["Chat / Agent"]
  end

  subgraph adapter["slim-agent-adapter  :1235  (zero-dep proxy)"]
    filt["prompt-driven tool filter<br/>keep MCP · deny scaffolders"]
    slim["schema slimming · /no_think"]
    dash["live dashboard /dashboard"]
  end

  subgraph lms["LM Studio  :1234  (fully local)"]
    llm["Qwen3-8B · 32K context"]
    emb["nomic-embed-text (embeddings)"]
  end

  subgraph mcp["framework-mcp  (context engine · stdio)"]
    tools["15 tools: retrieve_context, code_map,<br/>get_architecture, create_test_file, run_test…"]
    rag["AST chunks → hybrid rank → MMR → token budget"]
  end

  fw["playwright-pom-framework<br/>(page objects · fixtures · tests)"]

  chat -- "chat completions" --> filt --> slim --> llm
  emb --- rag
  chat -- "MCP (tools)" --> tools
  tools --- rag
  rag -- "reads / analyses" --> fw
  llm -. "picks a tool" .-> tools
```

**The flow:** VS Code sends each turn to the **adapter**, which trims the tool payload and forwards to **Qwen3-8B** in LM Studio. When the model calls a tool, VS Code routes it to **framework-mcp**, whose **context engine** (built on local embeddings) returns just the relevant, budgeted slice of the framework — so 32K of context goes a long way.

---

## Why it's special

- **It runs on a potato.** M-series / 24 GB unified memory / Qwen3-8B / 32K — and it's *stable* (the 14B repeatedly crashed the machine; the 8B + these two layers does not).
- **It solves the real killer** — not model quality, but the **token/tool overload** every local setup hits and no one packages a fix for.
- **Framework-aware, not generic** — writes tests in *your* POM conventions; diagrams come from *real* static analysis, not hallucination.
- **Model-agnostic + reusable** — the adapter works with any OpenAI-compatible local model; the context-engine pattern works on any codebase.
- **Observable** — the dashboard shows exactly what's optimized per request, which local setups never expose.

Honest scope: this is **not** a frontier coding agent. It's a capable, private, framework-aware assistant that actually works on hardware you already own.

---

## Requirements

- **Node.js 18+**
- **[LM Studio](https://lmstudio.ai)** (local model server on `:1234`)
- Models (download in LM Studio's *Discover* tab):
  - `qwen/qwen3-8b` — the chat/agent model
  - `text-embedding-nomic-embed-text-v1.5` — embeddings for RAG
- **VS Code** with GitHub Copilot Chat (agent mode + a custom OpenAI-compatible model endpoint)
- ~24 GB RAM recommended (works within it — see [Troubleshooting](#troubleshooting))

---

## Setup

```bash
git clone https://github.com/pruthive580/PlayWright-RAG-CustomMCP.git
cd PlayWright-RAG-CustomMCP
```

### Quick start (recommended) — interactive installer

```bash
node setup.mjs
```

It checks prerequisites, asks for your **framework path** and **machine tier**, builds the MCP, loads the local models via LM Studio, and writes your VS Code MCP config + Copilot model config + adapter launch command. **Pick tier 2 (high-spec) to skip the adapter entirely** — if you can comfortably run a 14B, you don't need it.

<details>
<summary><b>Manual setup</b> (if you'd rather do it by hand)</summary>

**1. Build the MCP (context engine)**
```bash
cd framework-mcp
npm install
npm run build          # produces dist/index.js
cd ..
```

**2. Install the sample framework (only if you want to run its tests)**
```bash
cd playwright-pom-framework
npm install
npx playwright install chromium
cd ..
```

**3. Load the models in LM Studio**
- Start LM Studio → *Developer* tab → **Start Server** (`:1234`)
- Load `qwen/qwen3-8b` with a **32K** context, single slot:
  ```bash
  lms load qwen/qwen3-8b -c 32768 --parallel 1 --gpu max
  lms load text-embedding-nomic-embed-text-v1.5
  ```
  > Tip: LM Studio's `--parallel` defaults to 4, which **quadruples** the KV cache — always pass `--parallel 1` for single-user.

**4. Start the adapter** (recommended flags shown)
```bash
cd slim-agent-adapter
TOOL_FILTER=1 TOOL_FILTER_KEEP='^mcp_' TOOL_DENY='create_new_workspace|new_workspace' \
  OVERRIDES=./overrides.example.json node index.mjs
# → slim-agent-adapter on :1235 ; dashboard at http://localhost:1235/dashboard
```

**5. Point VS Code Copilot at the adapter.** Add a custom model (Copilot → *Manage Models* → OpenAI-compatible):
```json
{
  "id": "qwen/qwen3-8b",
  "name": "Qwen3 8B (local, via adapter)",
  "url": "http://localhost:1235/v1/chat/completions",
  "toolCalling": true,
  "vision": false,
  "maxInputTokens": 26000,
  "maxOutputTokens": 4096
}
```
Also set `"chat.byokUtilityModelDefault": "mainAgent"` in VS Code settings so Copilot uses your one model for everything (no phantom "utility model").

**6. Wire the MCP.** Open the **repo root** in VS Code — `.vscode/mcp.json` is already configured. Command Palette → **"MCP: List Servers"** → `framework` → **Start**. The 15 tools (incl. `retrieve_context`, `code_map`) appear in the 🔧 tools picker.

</details>

---

## Usage

In Copilot **Agent mode** (model = your local Qwen3-8B), try:

| Prompt | What happens |
|---|---|
| "How do we log in the standard user?" | `retrieve_context` returns a cited ~1K-token pack; the model answers from it |
| "Give me a code map of the page objects." | `code_map` — a signatures-only skeleton |
| "Create the architecture of this codebase as a md file." | `write_architecture_doc` → `ARCHITECTURE.md` with Mermaid diagrams |
| "Write a test that removes an item from the cart." | `retrieve_context` → `get_test_conventions` → `create_test_file` (POM-correct) |

Keep the **dashboard** (`http://localhost:1235/dashboard`) open to watch each request, the tool filtering, and the token savings live.

---

## Components in depth

### `framework-mcp` — the context engine (15 tools)

Understanding: `list_page_objects`, `list_tests`, `get_test_conventions`, `search_code`, `read_file`, `get_architecture`.
RAG / context: **`retrieve_context`** (hybrid semantic+keyword ranking → MMR de-dup → token-budgeted, cited pack), **`code_map`** (skeleton), **`related_code`** (import-graph neighbourhood: deps + dependents), `semantic_search`, `build_rag_index`.
Generation & repair: `create_test_file` (POM-correct), `write_architecture_doc`, `run_test`, **`diagnose_test`** (run → structured failure + fix-context, for a generate→run→repair loop).

The retrieval upgrade in one line: **AST-aware chunking** (whole methods/classes/tests, not line fragments) → **hybrid ranking** → **MMR** → **token budget**. Validated **28/28** (see `framework-mcp/VALIDATION.md`); retrieval quality **hit@6 = 100%, MRR 0.80** on the sample (`framework-mcp/test/eval-retrieval.mjs`).

**Framework-agnostic:** point `FRAMEWORK_ROOT` at *your own* Playwright TS repo — the MCP auto-detects page objects, the import header, fixtures, tags, and data files — **verified on 166 real OSS Playwright repos, 0 crashes** — tests detected in 121/130 spec-bearing repos, 43 distinct import-header conventions inferred (see [`framework-mcp/REALWORLD-VALIDATION.md`](framework-mcp/REALWORLD-VALIDATION.md)).

### `slim-agent-adapter` — the overhead cutter

| Feature | Effect |
|---|---|
| `TOOL_FILTER=1` | Forward only tools relevant to the current prompt (e.g. 63 → 6–24) |
| `TOOL_FILTER_KEEP='^mcp_'` | Never drop your MCP tools |
| `TOOL_DENY='create_new_workspace…'` | Drop hijack-prone built-ins small models misfire on |
| `TOOL_FILTER_SEMANTIC=1` | Rank tools by embedding similarity instead of keywords (opt-in; falls back to lexical) |
| `OVERRIDES=…` | Curated terse tool descriptions that keep behavioural guidance |
| `/no_think` (Qwen3) | Disable reasoning latency automatically |
| `/dashboard` | Live requests, sessions, and a per-request prompt-optimization inspector |

Measured **−25% to −42%** tool tokens per turn. See `slim-agent-adapter/README.md` for all env vars.

**Optional / switchable.** High-spec users who can run a larger model don't need the adapter — pick **tier 2** in the installer and VS Code talks to LM Studio (`:1234`) directly. Or keep it in the loop for the dashboard but turn off every transform with `PASSTHROUGH=1`.

---

## Troubleshooting

- **Whole system memory pressure / crash** → you're likely on the 14B. Use **Qwen3-8B**, load with `--parallel 1`, and keep Playwright MCP off unless needed. Close Chrome during heavy runs.
- **"No lowest priority node found"** (Copilot) → the tool payload doesn't fit `maxInputTokens`. Raise it (given 32K context), and/or trim tools in the 🔧 picker.
- **Model calls `create_new_workspace` / "needs empty workspace"** → run the adapter with `TOOL_DENY='create_new_workspace|new_workspace'` (default in setup above).
- **"No models loaded"** after idle → LM Studio auto-unloaded the model; disable idle auto-unload, or just re-send (it reloads).
- **Context fills fast** → that's the ~60 tool schemas re-sent each turn, not your prompt. Trim the 🔧 picker and lean on `retrieve_context` instead of dumping files.
- **Mermaid doesn't render** → install the `bierner.markdown-mermaid` VS Code extension, then `Cmd+Shift+V`. (GitHub renders Mermaid natively.)

---

## Repo layout

```
PlayWright-RAG-CustomMCP/
├── .vscode/mcp.json           # portable MCP config (open the repo root)
├── framework-mcp/             # custom MCP + RAG context engine (build → dist/)
│   ├── src/{index,analysis,chunker,context,rag,browser}.ts
│   └── test/validate.mjs      # 28/28 end-to-end validation harness
├── slim-agent-adapter/        # zero-dep OpenAI-compatible proxy (node index.mjs)
├── playwright-pom-framework/  # sample Playwright POM system-under-test
└── README.md
```

## Credits

- Browser automation via the official [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp).
- Runs locally on [LM Studio](https://lmstudio.ai) with [Qwen3](https://github.com/QwenLM/Qwen3) + `nomic-embed-text`.

## License

MIT
