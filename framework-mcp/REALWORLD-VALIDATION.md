# Real-World Validation — framework-mcp on 21 open-source Playwright repos

The framework-mcp analysis layer is **framework-agnostic**: point `FRAMEWORK_ROOT` at any
Playwright + TypeScript repo and it auto-detects page objects, the import header, fixtures,
tags, and data files. To prove that (not just claim it), it was run against **21 diverse
open-source Playwright frameworks** — different folder layouts, fixture styles, and import
conventions.

**Result: 0 crashes. Page objects detected on 17/21; tests on 18/21. Every non-detection is
legitimate** (a JS-only repo, a CLI tool, a Cucumber repo, or a repo with no page-object
classes) — there were **no false negatives on an actual TS Page-Object framework.**

## Results

| Repo | .ts | Page objects | Tests | Fixtures | Detected import header |
|---|--:|--:|--:|--:|---|
| akshayp7/playwright-typescript-playwright-test | 26 | 6 | 14 | 7 | `@playwright/test` |
| checkly/playwright-examples | 34 | 3 | 17 | 3 | `@playwright/test` |
| ortoniKC/Playwright-Test-Runner | 60 | 3 | 70 | 3 | `@playwright/test` |
| ortoniKC/Playwright_Cucumber_TS | 16 | 6 | 0* | 0 | `@playwright/test` |
| VinayKumarBM/playwright-sample-project | 59 | 13 | 18 | 1 | `@base-test` |
| LambdaTest/playwright-sample | 6 | 0† | 33 | 1 | `@playwright/test` |
| MarcusFelling/demo.playwright | 35 | 1 | 67 | 2 | `@playwright/test` |
| abhaybharti/playwright-framework-template | 79 | 1 | 98 | 6 | `../../fixtures/customFixtures` |
| kstvds24/playwright-enterprise-framework | 40 | 8 | 6 | 2 | `../../src/fixtures/baseFixture` |
| bindu-h24/playwright-ui-api-framework | 35 | 10 | 7 | 6 | `../fixtures/testFixture` |
| MahrukhJawed/playwright-automation | 17 | 5 | 7 | 6 | `../../fixtures/apiFixtures` |
| idavidov13/PW-Framework-Step-By-Step | 17 | 3 | 12 | 4 | `../../fixtures/pom/test-options` |
| ChethanN18/Playwright-Automation-Framework | 20 | 4 | 5 | 2 | `../fixtures/pageFixture` |
| sharisroy/playwright-web-framework | 14 | 6 | 14 | 0 | `@playwright/test` |
| darshaan-chavda/playwright-ts-web-pom | 8 | 4 | 4 | 0 | `@playwright/test` |
| andrewbayd/playwright-page-object | 8 | 4 | 1 | 0 | `@playwright/test` |
| ramjangatisetty/e2e-…-framework-template | 13 | 3 | 2 | 0 | `../setup` |
| kirbycope/playwright-typescript | 5 | 1 | 1 | 1 | `./fixtures/login.fixture` |
| BakkappaN/Playwright-TypeScript-Framework | 4 | 0† | 26 | 0 | `@playwright/test` |
| vasu31dev/playwright-ts-cli | 3 | — | — | — | (CLI tool, n/a) |
| NarendraCodeHub/QA-Practice-Playwright-Automation | 0 | — | — | — | (JavaScript repo, n/a) |

\* Cucumber repo — uses `.feature` files + step defs, not `test()`/`describe()`, so 0 Playwright
specs is expected (its 6 page objects were still detected).
† No page-object *classes* in the repo (tests call `page.*` directly), so PO=0 is correct.

## Why this matters

- **Header detection is real:** ~10 distinct import conventions were inferred correctly —
  `@playwright/test`, `@base-test`, `../setup`, `../../fixtures/customFixtures`,
  `./fixtures/login.fixture`, and more — instead of assuming one hardcoded path.
- **Layout-agnostic:** page objects were found whether under `pages/`, `src/pages/`,
  `tests/pages/`, `po/`, or root-level dirs.
- **Robust at scale:** the largest repos (79 files / 98 tests, 60 files / 70 tests) analysed in
  well under 200 ms with no errors.

## Known scope boundaries (future work)

- **JavaScript-only repos** (e.g. QA-Practice above) aren't analysed — the layer is TypeScript
  (ts-morph) today. A `.js` mode is a natural extension.
- **Cucumber/BDD** (`.feature` + steps) isn't parsed as "tests" — page objects are still found.

_Reproduce: `FRAMEWORK_ROOT=/path/to/any/playwright-repo node -e "..."` using `dist/analysis.js`._
