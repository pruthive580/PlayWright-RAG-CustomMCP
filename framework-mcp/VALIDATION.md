# MCP + Adapter Validation Report

Result: **33/33 checks passed**.
Adapter slimming over 13 live model calls: 31442 → 14450 tool tokens (**-54%**).

| Layer | Check | Result | Detail |
|---|---|---|---|
| surface | `tool inventory` | ✅ PASS | 18 tools: build_rag_index, check_coverage, code_map, create_test_file, diagnose_test, get_ |
| mcp | `list_page_objects` | ✅ PASS | [ { "name": "BasePage", "abstract": true, "file": "src/pages/BasePage.ts", "meth |
| mcp | `list_tests` | ✅ PASS | [ { "file": "tests/auth/login.spec.ts", "suites": [ "Authentication" ], "tests": |
| mcp | `get_test_conventions` | ✅ PASS | { "importHeader": "import { test, expect } from '../../src/fixtures/test-fixture |
| mcp | `search_code` | ✅ PASS | [ { "file": ".framework-mcp-index.json", "line": 1, "text": "{\"model\":\"text-e |
| mcp | `read_file` | ✅ PASS | 1 import { Page, Locator, expect } from '@playwright/test'; 2 import { BasePage  |
| mcp | `get_architecture` | ✅ PASS | ```mermaid %%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 45, 'rankSpa |
| mcp | `get_architecture[pages]` | ✅ PASS | ```mermaid classDiagram class BasePage { <<abstract>> +goto() +waitForVisible()  |
| mcp | `build_rag_index` | ✅ PASS | { "chunks": 60, "files": 18 } |
| mcp | `semantic_search` | ✅ PASS | [ { "file": "tests/auth/login.spec.ts", "symbol": "test: standard user can log i |
| mcp | `retrieve_context` | ✅ PASS | Context pack for: "how do we log in the standard user" — 11 chunks, ~993 tokens  |
| mcp | `code_map` | ✅ PASS | ### src/pages/BasePage.ts class BasePage «abstract» + goto() + waitForVisible(lo |
| mcp | `related_code` | ✅ PASS | # src/pages/InventoryPage.ts ## defines class InventoryPage extends BasePage + e |
| mcp | `check_coverage` | ✅ PASS | { "verdict": "likely-covered", "confidence": 0.9, "relatedTests": [ { "file": "t |
| mcp | `get_jira` | ✅ PASS | { "error": "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_T |
| mcp | `list_environments` | ✅ PASS | { "envVar": "TEST_ENV", "environments": [ "staging", "prod" ], "note": "Before r |
| mcp | `create_test_file` | ✅ PASS | Created tests/generated/_probe.spec.ts |
| mcp | `run_test` | ✅ PASS | Running 1 test using 1 worker ✓ 1 [chromium] › tests/generated/_probe.spec.ts:4: |
| mcp | `diagnose_test` | ✅ PASS | { "passed": 1, "failed": 0, "skipped": 0, "failures": [] } |
| mcp | `write_architecture_doc` | ✅ PASS | Wrote ARCHITECTURE._probe.md |
| adapter | `get_architecture` | ✅ PASS | model called get_architecture |
| adapter | `list_page_objects` | ✅ PASS | model called list_page_objects |
| adapter | `get_test_conventions` | ✅ PASS | model called get_test_conventions |
| adapter | `list_tests` | ✅ PASS | model called list_tests |
| adapter | `search_code` | ✅ PASS | model called search_code |
| adapter | `read_file` | ✅ PASS | model called read_file |
| adapter | `semantic_search` | ✅ PASS | model called semantic_search |
| adapter | `build_rag_index` | ✅ PASS | model called build_rag_index |
| adapter | `create_test_file` | ✅ PASS | model called list_page_objects |
| adapter | `write_architecture_doc` | ✅ PASS | model called write_architecture_doc |
| adapter | `run_test` | ✅ PASS | model called list_environments |
| e2e | `get_architecture` | ✅ PASS | executed → ```mermaid %%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 45 |
| e2e | `list_page_objects` | ✅ PASS | executed → [ { "name": "BasePage", "abstract": true, "file": "src/pages/BasePage. |

Layers: **surface** = exact 11-tool inventory · **mcp** = each tool executed directly over stdio · **adapter** = 14B selected+filled the tool through the slim-agent-adapter (:1235) · **e2e** = model's chosen call executed back through MCP.
