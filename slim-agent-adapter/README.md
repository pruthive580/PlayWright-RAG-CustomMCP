# slim-agent-adapter

A **zero-dependency, OpenAI-compatible proxy** that makes agentic AI usable on **modest hardware** (16–24 GB Macs, small local models). It sits between your agent client (VS Code Copilot Chat / Cline / Continue) and your local model server (LM Studio / Ollama), and **slims the per-request prompt** so small models stay fast.

Built for the local-LLM QA / test-automation community — where the promise of "AI writes your tests" usually dies not because the model is bad, but because the **prompt overhead is too heavy** for the hardware.

## The problem it solves

Every agent turn re-sends the full prompt to the model:

```
[ client agent system prompt ] + [ ALL tool schemas ] + [ conversation ]
```

With an MCP setup (e.g. Playwright MCP + a custom MCP = 30+ tools), the **tool schemas alone are ~15–20K tokens** — re-processed on *every* turn. On a small local model that's slow prefill on each step, and on a 24 GB Mac it also drives memory pressure. Reasoning models (Qwen3) add more latency by "thinking" before every answer.

## What it does (per request — all schema-preserving)

| Transform | Effect |
|---|---|
| **Normalise tool descriptions** | Collapses whitespace — **lossless by default**. Behavioural guidance ("call X first", "never do Y") is kept, not thrown away. |
| **Curated overrides** *(opt-in, recommended)* | Point `OVERRIDES` at a JSON file of hand-tuned shorter descriptions that **keep the guidance a model needs to call the tool correctly**. Safe savings. |
| **Hard truncation** *(opt-in, off by default)* | `TRUNCATE_DESC=1` clips descriptions to `MAX_TOOL_DESC` chars. Biggest cut but **lossy** — can drop prerequisites, so it's not the default. |
| **Strip parameter prose** | Drops `description` on each param but **keeps** `type` / `enum` / `required` — so tool calls still validate |
| **Auto `/no_think` (Qwen3)** | Appends the control token to disable reasoning latency, no per-request effort |
| **Streams through untouched** | SSE responses pass straight back; tool calls unaffected |

It **never rewrites the client's agent system prompt** — that would break agent behaviour. The leverage is entirely on the tool payload + thinking.

**Design principle:** never trade correctness for tokens. The default is lossless; the recommended mode is curated overrides (see `overrides.example.json`) that stay short *and* keep the guidance; aggressive truncation is available but opt-in.

**Measured (validated end-to-end):** on a real 11-tool MCP payload driving a local Qwen3-14B, curated overrides + param-stripping cut **~16%** off tool tokens with **26/26** tool-selection/execution checks still passing — the model called the right tool, with valid args, on every action. Turning on `TRUNCATE_DESC` pushes the cut past 30–40% where a setup can tolerate lossy descriptions.

## Run

```bash
node index.mjs           # or: npm start
# slim-agent-adapter → :1235 proxying http://127.0.0.1:1234
```

No install, no build, no dependencies (Node 18+).

## Point your client at it

Change your client's base URL from the model server (`:1234`) to the adapter (`:1235`):

- **VS Code Copilot (custom endpoint):** model `url` → `http://localhost:1235/v1/chat/completions`
- **Cline / Continue (LM Studio provider):** base URL → `http://localhost:1235`
- **Anything OpenAI-compatible:** base URL → `http://localhost:1235/v1`

Keep your model server (LM Studio/Ollama) running as usual on `:1234`.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `1235` | Adapter listen port |
| `UPSTREAM` | `http://127.0.0.1:1234` | Your local model server |
| `OVERRIDES` | *(none)* | Path to a JSON file of curated terse descriptions `{ "toolName": "shorter desc" }`. **Recommended** — see `overrides.example.json`. |
| `TRUNCATE_DESC` | `0` | Opt-in hard truncation of descriptions (lossy). Off by default. |
| `MAX_TOOL_DESC` | `100` | Max chars kept per description when `TRUNCATE_DESC=1` |
| `STRIP_PARAM_DESC` | `1` | Drop per-parameter prose (keeps type/enum/required) |
| `COMPRESS` | `1` | Master switch for description handling |
| `NO_THINK` | `1` | Inject `/no_think` for matching models |
| `NO_THINK_MATCH` | `qwen3` | Regex of model ids to disable thinking on |
| `LOG` | `1` | Log per-request token savings to stderr |

Recommended launch:

```bash
OVERRIDES=./overrides.example.json node index.mjs
```

## Honest tradeoffs

- **The default never drops guidance.** Structure (names, params, types, enums, `required`) is always untouched, so function-calling stays correct. Description text is lossless by default; the recommended `OVERRIDES` mode is hand-verified to keep prerequisites; only opt-in `TRUNCATE_DESC` is lossy — use it only where descriptions can be safely clipped.
- **Keeps the tool list stable** so your model server's KV-cache prefix reuse still works across turns. (Aggressive per-message tool *filtering* — even fewer tokens, at the cost of cache churn — is on the roadmap as an opt-in mode.)

## Observability

- **`/metrics`** — cumulative token-savings, latency, session and per-request stats (JSON)
- **`/dashboard`** — live view of incoming requests, sessions, and a per-request "prompt optimization" inspector showing the before/after tool payload
- **`/inspect?id=N`** / **`/events`** (SSE) — per-request detail and a live feed

## Roadmap

- **Relevance tool-filtering** (opt-in) — send only tools likely needed for the current message
- **Utility-model routing** — route small helper calls to a tiny model, main calls to the big one
- Grow into a shared toolkit for local-LLM **QA / test-automation** workflows

## License

MIT
