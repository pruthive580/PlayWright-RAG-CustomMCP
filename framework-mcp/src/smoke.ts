/**
 * Non-MCP smoke test: exercises the analysis layer directly so we can verify
 * the tool logic without a full protocol handshake.
 *   FRAMEWORK_ROOT=/path node dist/smoke.js
 */
import * as path from "node:path";
import { createProject, listPageObjects, listTests, architecture, searchCode } from "./analysis.js";

const ROOT = path.resolve(
  process.env.FRAMEWORK_ROOT || process.argv[2] || process.cwd(),
);

const project = createProject(ROOT);

console.log("=== PAGE OBJECTS ===");
console.log(JSON.stringify(listPageObjects(project, ROOT), null, 2));

console.log("\n=== TESTS ===");
console.log(JSON.stringify(listTests(ROOT), null, 2));

console.log("\n=== SEARCH: 'addToCart' ===");
console.log(JSON.stringify(searchCode(ROOT, "addToCart"), null, 2));

console.log("\n=== ARCHITECTURE (overview) ===");
console.log(architecture(project, ROOT, "overview"));

console.log("\n=== ARCHITECTURE (pages) ===");
console.log(architecture(project, ROOT, "pages"));
