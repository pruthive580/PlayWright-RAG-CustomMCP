#!/usr/bin/env node
/**
 * Robustness battery for the self-healing engine (diagnose parser).
 * Feeds parsePlaywrightJson every Playwright JSON-reporter shape and asserts the
 * structured result — no browsers needed, so it covers failure modes at scale.
 */
import { parsePlaywrightJson } from "../dist/diagnose.js";

const spec = (title, file, line, status, err) => ({
  title, file, line,
  tests: [{ results: [{ status, ...(err ? (Array.isArray(err) ? { errors: err } : { error: err }) : {}) }] }],
});
const suite = (specs, suites = []) => ({ specs, suites });

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "  <-- " + detail}`);
};

// 1. all pass
let r = parsePlaywrightJson({ suites: [suite([spec("a", "a.ts", 1, "passed"), spec("b", "a.ts", 5, "passed")])] });
check("all pass → passed=2 failed=0", r.passed === 2 && r.failed === 0, JSON.stringify(r));

// 2. assertion failure with location
r = parsePlaywrightJson({ suites: [suite([spec("x", "x.ts", 10, "failed", [{ message: "Error: expect(received).toBe(expected)", location: { file: "x.ts", line: 12 } }])])] });
check("assertion fail → failed=1, file+line+msg", r.failed === 1 && r.failures[0].file === "x.ts" && r.failures[0].line === 10 && /expect/.test(r.failures[0].message), JSON.stringify(r));

// 3. timeout
r = parsePlaywrightJson({ suites: [suite([spec("t", "t.ts", 3, "timedOut", { message: "Test timeout of 30000ms exceeded." })])] });
check("timeout → failed=1, msg captured", r.failed === 1 && /timeout/i.test(r.failures[0].message), JSON.stringify(r));

// 4. error without a location (falls back to spec file/line)
r = parsePlaywrightJson({ suites: [suite([spec("n", "n.ts", 7, "failed", [{ message: "boom" }])])] });
check("error no-location → uses spec file/line", r.failures[0].file === "n.ts" && r.failures[0].line === 7, JSON.stringify(r));

// 5. nested suites
r = parsePlaywrightJson({ suites: [suite([], [suite([], [suite([spec("deep", "d.ts", 2, "failed", [{ message: "deep err" }])])])])] });
check("nested suites → failed=1", r.failed === 1 && r.failures[0].title === "deep", JSON.stringify(r));

// 6. multiple failures
r = parsePlaywrightJson({ suites: [suite([spec("f1", "a.ts", 1, "failed", [{ message: "e1" }]), spec("f2", "b.ts", 2, "failed", [{ message: "e2" }])])] });
check("multiple failures → failed=2", r.failed === 2 && r.failures.length === 2, JSON.stringify(r));

// 7. skipped
r = parsePlaywrightJson({ suites: [suite([spec("s", "s.ts", 1, "skipped")])] });
check("skipped → skipped=1, failed=0", r.skipped === 1 && r.failed === 0, JSON.stringify(r));

// 8. flaky / retry (last result wins → passed)
r = parsePlaywrightJson({ suites: [{ specs: [{ title: "flk", file: "f.ts", line: 1, tests: [{ results: [{ status: "failed", errors: [{ message: "flaky" }] }, { status: "passed" }] }] }] }] });
check("flaky retry (last passes) → passed=1 failed=0", r.passed === 1 && r.failed === 0, JSON.stringify(r));

// 9. empty / no suites
r = parsePlaywrightJson({});
check("empty json → all zero, no throw", r.passed === 0 && r.failed === 0 && r.failures.length === 0, JSON.stringify(r));

// 10. malformed-ish (missing tests array)
r = parsePlaywrightJson({ suites: [{ specs: [{ title: "m", file: "m.ts", line: 1 }] }] });
check("spec missing tests[] → no throw", r.passed === 0 && r.failed === 0, JSON.stringify(r));

console.log(`\n  diagnose battery: ${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
