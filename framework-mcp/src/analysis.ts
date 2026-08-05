import { Project, Scope, SourceFile } from "ts-morph";
import * as path from "node:path";
import * as fs from "node:fs";

/** Directories never worth walking or analysing. */
const IGNORE = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  "blob-report",
  ".git",
  ".cache",
]);

/** Load the framework's TypeScript sources into a ts-morph project (all .ts, ignoring node_modules/dist). */
export function createProject(root: string): Project {
  const project = new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
  });
  for (const f of walk(root)) {
    if (f.endsWith(".ts") && !f.endsWith(".d.ts")) {
      try { project.addSourceFileAtPath(f); } catch { /* skip unparsable files */ }
    }
  }
  return project;
}

/** A class is treated as a Page Object if it lives in a page-ish folder, is named *Page, or drives locators. */
function looksLikePageDir(fp: string): boolean {
  return /(^|\/)(pages?|page[-_]?objects?|po|screens?|components?)(\/|$)/i.test(fp);
}
function classDrivesUi(clsText: string): boolean {
  return /\bLocator\b|page\.locator|getByRole|getByTestId|getByText|getByLabel|this\.page\b/.test(clsText);
}

/** Recursively list files under a directory, skipping ignored folders. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export interface PageObjectInfo {
  name: string;
  extends?: string;
  abstract: boolean;
  file: string;
  methods: string[];
  locators: string[];
}

/** Extract every Page Object class (any class under src/pages) with its public API. */
export function listPageObjects(project: Project, root: string): PageObjectInfo[] {
  const result: PageObjectInfo[] = [];
  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (/\.(spec|test)\.ts$/.test(fp)) continue; // skip test files
    const inPageDir = looksLikePageDir(fp);
    for (const cls of sf.getClasses()) {
      const name = cls.getName() ?? "";
      const isPage = inPageDir || /page$|screen$|component$/i.test(name) || classDrivesUi(cls.getText());
      if (!isPage) continue;
      const methods = cls
        .getInstanceMethods()
        .filter((m) => m.getScope() !== Scope.Private)
        .map((m) => `${m.getName()}(${m.getParameters().map((p) => p.getName()).join(", ")})`);
      const locators = cls
        .getProperties()
        .filter((p) => (p.getTypeNode()?.getText() ?? "").includes("Locator"))
        .map((p) => p.getName());
      result.push({
        name: cls.getName() ?? "(anonymous)",
        extends: cls.getExtends()?.getExpression().getText(),
        abstract: cls.isAbstract(),
        file: path.relative(root, sf.getFilePath()),
        methods,
        locators,
      });
    }
  }
  return result;
}

export interface TestInfo {
  file: string;
  suites: string[];
  tests: { title: string; tags: string[] }[];
}

/** List spec files with their describe blocks, test titles, and @tags. */
export function listTests(root: string): TestInfo[] {
  const files = walk(root).filter((f) => /\.(spec|test)\.ts$/.test(f));
  return files.map((f) => {
    const textBody = fs.readFileSync(f, "utf8");
    const suites = [...textBody.matchAll(/describe\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    const tests = [...textBody.matchAll(/(?:^|\s)test\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => {
      const title = m[1];
      const tags = [...title.matchAll(/@[\w-]+/g)].map((t) => t[0]);
      return { title, tags };
    });
    return { file: path.relative(root, f), suites, tests };
  });
}

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

/** Grep-style search over .ts/.json/.md sources. */
export function searchCode(
  root: string,
  query: string,
  opts: { regex?: boolean; maxResults?: number } = {},
): SearchHit[] {
  const max = opts.maxResults ?? 50;
  const re = opts.regex ? new RegExp(query, "i") : null;
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const file of walk(root)) {
    if (!/\.(ts|json|md)$/.test(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const matched = re ? re.test(lines[i]) : lines[i].toLowerCase().includes(needle);
      if (matched) {
        hits.push({ file: path.relative(root, file), line: i + 1, text: lines[i].trim().slice(0, 200) });
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}

/** Read a framework file (relative path), optionally a line range. Guards path traversal. */
export function readFileSafe(root: string, rel: string, start?: number, end?: number): string {
  const abs = path.resolve(root, rel);
  if (abs !== path.resolve(root) && !abs.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("Path escapes framework root");
  }
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${rel}`);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const s = start ? Math.max(1, start) : 1;
  const e = end ? Math.min(lines.length, end) : lines.length;
  return lines
    .slice(s - 1, e)
    .map((l, i) => `${s + i}\t${l}`)
    .join("\n");
}

/** Write a new spec under tests/. Guards path traversal and enforces .spec.ts. */
export function createTestFile(root: string, rel: string, content: string): string {
  if (!rel.endsWith(".spec.ts")) throw new Error("Test file name must end with .spec.ts");
  const testsRoot = path.resolve(root, "tests");
  const abs = path.resolve(testsRoot, rel);
  if (!abs.startsWith(testsRoot + path.sep)) throw new Error("Test path escapes tests/ directory");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return path.relative(root, abs);
}

function safeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Class diagram of the page objects, with inheritance edges. */
function pagesClassDiagram(project: Project): string {
  const body: string[] = ["classDiagram"];
  const edges: string[] = [];
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().includes("/pages/")) continue;
    for (const cls of sf.getClasses()) {
      const name = cls.getName() ?? "Anon";
      body.push(`  class ${name} {`);
      if (cls.isAbstract()) body.push(`    <<abstract>>`);
      for (const m of cls.getInstanceMethods().filter((x) => x.getScope() !== Scope.Private)) {
        body.push(`    +${m.getName()}()`);
      }
      body.push(`  }`);
      const ext = cls.getExtends()?.getExpression().getText();
      if (ext) edges.push(`  ${ext} <|-- ${name}`);
    }
  }
  return [...body, ...edges].join("\n");
}

/** Dependency flowchart derived from the import graph, grouped and colour-coded by layer. */
function overviewFlowchart(project: Project, root: string): string {
  const groupOf = (file: string): string => {
    if (file.includes("/tests/")) return "Tests";
    if (file.includes("/fixtures/")) return "Fixtures";
    if (file.includes("/pages/")) return "Pages";
    if (file.includes("/data/")) return "Data";
    return "Other";
  };
  const isProjectFile = (p: string) => !p.includes("/node_modules/") && !p.includes("/dist/");
  const nodes = new Map<string, { id: string; label: string; group: string; base: boolean }>();
  const edges = new Set<string>();

  const register = (sf: SourceFile): string => {
    const p = sf.getFilePath();
    const id = safeId(path.relative(root, p));
    if (!nodes.has(id)) {
      const label = path.basename(p).replace(/\.ts$/, "");
      nodes.set(id, { id, label, group: groupOf(p), base: /BasePage/.test(label) });
    }
    return id;
  };

  for (const sf of project.getSourceFiles()) {
    if (!isProjectFile(sf.getFilePath())) continue;
    const from = register(sf);
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target || !isProjectFile(target.getFilePath())) continue;
      edges.add(`  ${from} --> ${register(target)}`);
    }
  }

  const titles: Record<string, string> = {
    Tests: "Tests",
    Fixtures: "Fixtures",
    Pages: "Page Objects",
    Data: "Test Data",
    Other: "Other",
  };

  const out: string[] = [
    "%%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 45, 'rankSpacing': 55}}}%%",
    "flowchart TD",
  ];

  for (const group of ["Tests", "Fixtures", "Pages", "Data", "Other"]) {
    const members = [...nodes.values()].filter((n) => n.group === group);
    if (members.length === 0) continue;
    out.push(`  subgraph ${group}["${titles[group]}"]`);
    out.push(`    direction TB`);
    for (const n of members) out.push(`    ${n.id}("${n.label}")`);
    out.push(`  end`);
  }

  out.push("");
  for (const e of edges) out.push(e);

  out.push("");
  out.push("  classDef tests fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;");
  out.push("  classDef fixtures fill:#ede9fe,stroke:#7c3aed,color:#4c1d95;");
  out.push("  classDef pages fill:#dcfce7,stroke:#16a34a,color:#14532d;");
  out.push("  classDef data fill:#ffedd5,stroke:#ea580c,color:#7c2d12;");
  out.push("  classDef base fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px;");

  const classFor = (n: { group: string; base: boolean }): string => {
    if (n.base) return "base";
    switch (n.group) {
      case "Tests": return "tests";
      case "Fixtures": return "fixtures";
      case "Pages": return "pages";
      case "Data": return "data";
      default: return "";
    }
  };
  for (const n of nodes.values()) {
    const cls = classFor(n);
    if (cls) out.push(`  class ${n.id} ${cls};`);
  }

  return out.join("\n");
}

/** Produce a Mermaid diagram for the requested scope. */
export function architecture(project: Project, root: string, scope: "overview" | "pages"): string {
  return scope === "pages" ? pagesClassDiagram(project) : overviewFlowchart(project, root);
}

/** Extract fixture names from any file that calls test/base.extend(...). */
function extractFixtureNames(root: string): string[] {
  const names: string[] = [];
  for (const f of walk(root)) {
    if (!/\.ts$/.test(f) || /\.d\.ts$/.test(f)) continue;
    const body = fs.readFileSync(f, "utf8");
    if (!/\.extend\s*[<(]/.test(body)) continue;
    for (const m of body.matchAll(/(\w+)\s*:\s*async\s*\(/g)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Infer the framework's test-import header from the most common one across specs. */
function detectImportHeader(root: string): string {
  const counts = new Map<string, number>();
  for (const f of walk(root)) {
    if (!/\.(spec|test)\.ts$/.test(f)) continue;
    const m = fs.readFileSync(f, "utf8").match(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"][^'"]+['"]/);
    if (m) {
      let line = m[0].replace(/\s+/g, " ").trim();
      if (!line.endsWith(";")) line += ";";
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  let best = "import { test, expect } from '@playwright/test';";
  let n = 0;
  for (const [line, c] of counts) if (c > n) { best = line; n = c; }
  return best;
}

/** Find data files (JSON/TS) under any data-ish directory. */
function detectDataFiles(root: string): string[] {
  return walk(root)
    .filter((f) => /(^|\/)(data|test[-_]?data|testdata)(\/)/i.test(f) && /\.(ts|json)$/.test(f) && !/\.d\.ts$/.test(f))
    .map((f) => path.relative(root, f));
}

export interface TestConventions {
  importHeader: string;
  fixtures: string[];
  pageObjects: { name: string; methods: string[] }[];
  dataFiles: string[];
  tags: string[];
  rules: string[];
  template: string;
}

/**
 * The framework's test-writing conventions, assembled from static analysis.
 * This is what makes generated tests match THIS framework instead of generic Playwright.
 */
export function getTestConventions(project: Project, root: string): TestConventions {
  const pageObjects = listPageObjects(project, root)
    .filter((p) => !p.abstract)
    .map((p) => ({ name: p.name, methods: p.methods }));
  const tagSet = new Set<string>();
  for (const t of listTests(root)) for (const tc of t.tests) for (const tag of tc.tags) tagSet.add(tag);
  const tags = [...tagSet].sort();
  const fixtures = extractFixtureNames(root);
  const dataFiles = detectDataFiles(root);
  const importHeader = detectImportHeader(root);
  const usesFixtureImport = !/@playwright\/test/.test(importHeader);
  const poNames = pageObjects.map((p) => p.name);

  return {
    importHeader,
    fixtures,
    pageObjects,
    dataFiles,
    tags,
    rules: [
      "RAG-first: call retrieve_context (or code_map) to understand existing code before writing, instead of reading whole files — it returns just the relevant, token-budgeted slice, which keeps the local context window focused.",
      `Import test/expect using THIS framework's header: ${importHeader}  (adjust the ../ depth to your spec's folder).`,
      poNames.length
        ? `Use the framework's page objects (${poNames.slice(0, 8).join(", ")}${poNames.length > 8 ? ", …" : ""}) and their methods instead of raw page.click / page.fill / page.goto.`
        : "Prefer existing helper / page-object classes over raw page.* calls where they exist.",
      fixtures.length
        ? `Access shared setup through the existing fixtures (${fixtures.slice(0, 8).join(", ")}) — e.g. async ({ ${fixtures[0]} }) => ...`
        : (usesFixtureImport ? "Use the framework's custom fixtures rather than the bare @playwright/test." : ""),
      tags.length ? `Tag tests using the existing vocabulary: ${tags.join(", ")}.` : "",
      dataFiles.length ? `Import reusable data from: ${dataFiles.slice(0, 6).join(", ")} — don't hard-code values that already exist there.` : "",
      "Wrap tests in test.describe('<Suite>', ...). Place the spec alongside the existing tests and create it with the create_test_file tool.",
    ].filter(Boolean),
    template: [
      importHeader,
      "",
      "test.describe('<Suite name>', () => {",
      `  test('<what it verifies>${tags.length ? " " + tags[0] : ""}', async ({ ${fixtures[0] ?? "page"} }) => {`,
      "    // Use the framework's page objects / fixtures — avoid raw page.* where a helper exists.",
      "  });",
      "});",
    ].join("\n"),
  };
}

/** Assemble a complete architecture markdown document (both diagrams + tables). */
export function buildArchitectureDoc(project: Project, root: string): string {
  const name = path.basename(root);
  const pageObjects = listPageObjects(project, root);
  const tagCounts = new Map<string, number>();
  for (const t of listTests(root)) {
    for (const tc of t.tests) for (const tag of tc.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const lines: string[] = [
    `# ${name} — Architecture`,
    "",
    "_Generated by **framework-mcp** from static analysis (ts-morph). Regenerate any time with the `write_architecture_doc` tool._",
    "",
    "## Dependency overview",
    "",
    "```mermaid",
    architecture(project, root, "overview"),
    "```",
    "",
    "## Page Object Model",
    "",
    "```mermaid",
    architecture(project, root, "pages"),
    "```",
    "",
    "## Page objects & methods",
    "",
    "| Class | Extends | Public methods |",
    "|---|---|---|",
  ];
  for (const p of pageObjects) {
    const methods = p.methods.map((m) => `\`${m}\``).join(", ") || "—";
    lines.push(`| \`${p.name}\`${p.abstract ? " _(abstract)_" : ""} | ${p.extends ? `\`${p.extends}\`` : "—"} | ${methods} |`);
  }
  lines.push("", "## Tests", "", "| Tag | Count |", "|---|---|");
  for (const [tag, n] of [...tagCounts.entries()].sort()) lines.push(`| ${tag} | ${n} |`);
  lines.push("");
  return lines.join("\n");
}

/** Write the architecture markdown into the framework (path-guarded). */
export function writeArchitectureDoc(project: Project, root: string, rel = "ARCHITECTURE.md"): string {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error("Path escapes framework root");
  fs.writeFileSync(abs, buildArchitectureDoc(project, root), "utf8");
  return path.relative(root, abs);
}
