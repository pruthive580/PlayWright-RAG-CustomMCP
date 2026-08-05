# MCP + Adapter Validation Report

Result: **28/28 checks passed**.
Adapter slimming over 13 live model calls: 20637 → 11901 tool tokens (**-42%**).

| Layer | Check | Result | Detail |
|---|---|---|---|
| surface | `tool inventory` | ✅ PASS | 13 tools: build_rag_index, code_map, create_test_file, get_architecture, get_test_conventi |
| mcp | `list_page_objects` | ✅ PASS | [ { "name": "BasePage", "abstract": true, "file": "src/pages/BasePage.ts", "meth |
| mcp | `list_tests` | ✅ PASS | [ { "file": "tests/auth/login.spec.ts", "suites": [ "Authentication" ], "tests": |
| mcp | `get_test_conventions` | ✅ PASS | { "importHeader": "import { test, expect } from '../../src/fixtures/test-fixture |
| mcp | `search_code` | ✅ PASS | [ { "file": ".framework-mcp-index.json", "line": 1, "text": "{\"model\":\"text-e |
| mcp | `read_file` | ✅ PASS | 1 import { Page, Locator, expect } from '@playwright/test'; 2 import { BasePage  |
| mcp | `get_architecture` | ✅ PASS | ```mermaid %%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 45, 'rankSpa |
| mcp | `get_architecture[pages]` | ✅ PASS | ```mermaid classDiagram class BasePage { <<abstract>> +goto() +waitForVisible()  |
| mcp | `build_rag_index` | ✅ PASS | { "chunks": 58, "files": 18 } |
| mcp | `semantic_search` | ✅ PASS | [ { "file": "tests/auth/login.spec.ts", "symbol": "test: standard user can log i |
| mcp | `retrieve_context` | ✅ PASS | Context pack for: "how do we log in the standard user" — 11 chunks, ~988 tokens  |
| mcp | `code_map` | ✅ PASS | ### src/pages/BasePage.ts class BasePage «abstract» + goto() + waitForVisible(lo |
| mcp | `create_test_file` | ✅ PASS | Created tests/generated/_probe.spec.ts |
| mcp | `run_test` | ✅ PASS | Running 1 test using 1 worker ✓ 1 [chromium] › tests/generated/_probe.spec.ts:4: |
| mcp | `write_architecture_doc` | ✅ PASS | Wrote ARCHITECTURE._probe.md |
| adapter | `get_architecture` | ✅ PASS | model called get_architecture |
| adapter | `list_page_objects` | ✅ PASS | model called list_page_objects |
| adapter | `get_test_conventions` | ✅ PASS | model called get_test_conventions |
| adapter | `list_tests` | ✅ PASS | model called list_tests |
| adapter | `search_code` | ✅ PASS | model called search_code |
| adapter | `read_file` | ✅ PASS | model called read_file |
| adapter | `semantic_search` | ✅ PASS | model called semantic_search |
| adapter | `build_rag_index` | ✅ PASS | model called build_rag_index |
| adapter | `create_test_file` | ✅ PASS | model called create_test_file |
| adapter | `write_architecture_doc` | ✅ PASS | model called write_architecture_doc |
| adapter | `run_test` | ✅ PASS | model called run_test |
| e2e | `get_architecture` | ✅ PASS | executed → ```mermaid %%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 45 |
| e2e | `list_page_objects` | ✅ PASS | executed → [ { "name": "BasePage", "abstract": true, "file": "src/pages/BasePage. |

Layers: **surface** = exact 11-tool inventory · **mcp** = each tool executed directly over stdio · **adapter** = 14B selected+filled the tool through the slim-agent-adapter (:1235) · **e2e** = model's chosen call executed back through MCP.
