# Playwright POM Framework (sample system-under-test)

A small, realistic Playwright + TypeScript framework built with the **Page Object Model** pattern. It targets [SauceDemo](https://www.saucedemo.com) and exists as the **example framework** that the RAG + custom-MCP "understand my framework" activity will read, diagram, and generate tests against.

## Layout

```
playwright-pom-framework/
├── playwright.config.ts        Runner config (baseURL, reporters, trace/video)
├── tsconfig.json
├── src/
│   ├── pages/                  Page Objects
│   │   ├── BasePage.ts         Shared navigation + helpers (abstract)
│   │   ├── LoginPage.ts
│   │   ├── InventoryPage.ts
│   │   ├── CartPage.ts
│   │   └── CheckoutPage.ts
│   ├── fixtures/
│   │   └── test-fixtures.ts    Custom fixtures + `loggedIn` session
│   └── data/
│       ├── users.ts            Accounts + data-driven negative-login cases
│       └── products.ts         Product name constants
└── tests/
    ├── auth/login.spec.ts      Positive smoke + data-driven negative logins
    ├── inventory/inventory.spec.ts   Functional: add-to-cart, sorting
    └── e2e/checkout.spec.ts    End-to-end purchase across 4 page objects
```

## Test types demonstrated

| Type | File | Tag |
|------|------|-----|
| Smoke / positive auth | `tests/auth/login.spec.ts` | `@smoke` |
| Data-driven negative | `tests/auth/login.spec.ts` | `@negative` |
| Functional / state | `tests/inventory/inventory.spec.ts` | `@functional` |
| End-to-end journey | `tests/e2e/checkout.spec.ts` | `@e2e` |

## Run

```bash
npm install
npx playwright install chromium

npm test              # all tests, headless
npm run test:headed   # watch them run
npm run test:ui       # Playwright UI mode
npm run test:smoke    # only @smoke
npm run report        # open last HTML report
```

## Pattern notes

- **Page objects** extend `BasePage` and expose intent-level methods (`login`, `addToCart`, `sortBy`) over raw locators, keyed on stable `data-test` attributes.
- **Fixtures** (`test-fixtures.ts`) inject page objects and provide a `loggedIn` fixture so authenticated tests skip boilerplate.
- **Test data** lives in `src/data/`, keeping specs declarative and enabling data-driven loops.
