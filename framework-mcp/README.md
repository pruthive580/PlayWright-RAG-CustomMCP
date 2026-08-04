# framework-mcp (v2)

A custom [MCP](https://modelcontextprotocol.io) server that works **at par with the official Playwright MCP** — it drives a live browser (navigate, snapshot, click, type, screenshot) — **plus** a framework-aware layer that makes every generated test follow **this project's** Page Object Model conventions instead of raw Playwright.

Design principle for local models: heavy lifting is deterministic (ts-morph static analysis, real browser control, path-safe IO); the model just orchestrates and composes.

## Tools (18)

**Understand the framework**
| Tool | Purpose |
|------|---------|
| `list_page_objects` | Page Object classes + public methods + locators (ts-morph) |
| `list_tests` | Spec files, titles, `@tags` |
| `get_test_conventions` | **The pattern engine** — import header, fixtures, method catalog, tags, data files, rules, template |
| `search_code` / `read_file` | Grep + read (path-guarded) |
| `get_architecture` | Mermaid diagram (`overview` / `pages`) |

**Drive the browser (Playwright-MCP equivalent)**
| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open a URL |
| `browser_snapshot` | Interactive elements with `ref`s + selectors |
| `browser_click` / `browser_type` / `browser_select_option` / `browser_press_key` | Interact by ref or selector |
| `browser_screenshot` | PNG of the page |
| `browser_console` | Console logs + page errors |
| `browser_get_recorded_steps` | Raw actions performed this session (to translate into page-object calls) |
| `browser_close` | End the session |

**Generate + run**
| Tool | Purpose |
|------|---------|
| `create_test_file` | Write a new `*.spec.ts` into `tests/` |
| `run_test` | Run Playwright (`path`/`grep` optional) and return results |

## Config

- `FRAMEWORK_ROOT` — the Playwright project to analyse/drive (env, then argv[2], then a default).
- `MCP_HEADLESS=1` — run the browser headless (default is headed so you can watch).

## Build

```bash
npm install
npm run build
FRAMEWORK_ROOT=/Users/bhargav/playwright-pom-framework npm run smoke
```

## Use in VS Code with the local Qwen3 (LM Studio)

1. **Start LM Studio's server and load the model** — `~/.lmstudio/bin/lms server start` and load `qwen/qwen3-8b` (or from the app).
2. **This repo already has `.vscode/mcp.json`** in the framework project (`playwright-pom-framework/.vscode/mcp.json`). Open **that** project in VS Code → the `framework` MCP server is detected; **Start** it and confirm 18 tools.
3. **Point VS Code chat at the local model**, either:
   - **GitHub Copilot Chat** → model picker → *Manage Models* → add an **OpenAI-compatible** provider: base URL `http://localhost:1234/v1`, model `qwen/qwen3-8b`. Switch chat to **Agent mode** and select the model.
   - **or the *Continue* / *Cline* extension**, which natively support LM Studio + MCP (most reliable for local models).
4. **Prompt in Agent mode**, e.g.:
   - *"Explain this framework and show its architecture diagram."*
   - *"Open saucedemo, log in, add a backpack to the cart, then write a test for it in this framework's Page Object style and run it."*

The model calls `get_test_conventions` + `list_page_objects`, drives the browser, then writes a spec using your fixtures and page-object methods (never raw `page.*`).
