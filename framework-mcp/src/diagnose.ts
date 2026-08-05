import { execFile } from "node:child_process";
import * as path from "node:path";

/**
 * Run Playwright with the JSON reporter and parse the result into a compact,
 * model-actionable structure — the "run + read the failure" half of a repair loop.
 */
export interface Failure {
  title: string;
  file: string;
  line: number;
  message: string;
}
export interface DiagnoseResult {
  passed: number;
  failed: number;
  skipped: number;
  failures: Failure[];
  raw?: string; // present only when JSON couldn't be parsed
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Pure parser: turn a Playwright JSON-reporter object into a structured result. Exported for testing. */
export function parsePlaywrightJson(json: any): DiagnoseResult {
  const failures: Failure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const walkSuite = (s: any) => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const r = results[results.length - 1] ?? {}; // last result wins (handles retries / flaky)
        const status = r.status;
        if (status === "passed" || status === "expected") passed++;
        else if (status === "skipped") skipped++;
        else {
          failed++;
          const e = (Array.isArray(r.errors) && r.errors[0]) || r.error || {};
          const loc = e.location || {};
          failures.push({
            title: spec.title || "(unnamed test)",
            file: spec.file || loc.file || "",
            line: spec.line || loc.line || 0,
            message: stripAnsi(String(e.message || "unknown error")).split("\n").slice(0, 8).join("\n").trim(),
          });
        }
      }
    }
    for (const child of s.suites ?? []) walkSuite(child);
  };
  for (const s of json.suites ?? []) walkSuite(s);
  return { passed, failed, skipped, failures };
}

export function runDiagnose(root: string, opts: { path?: string; grep?: string }): Promise<DiagnoseResult> {
  const bin = path.join(root, "node_modules", ".bin", "playwright");
  const args = ["test", "--reporter=json"];
  if (opts.path) args.push(opts.path);
  if (opts.grep) args.push("--grep", opts.grep);
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` };

  return new Promise((resolve) => {
    execFile(bin, args, { cwd: root, env, timeout: 180_000, maxBuffer: 24 * 1024 * 1024 }, (_err, stdout, stderr) => {
      let json: any;
      try {
        json = JSON.parse(stdout);
      } catch {
        resolve({ passed: 0, failed: 0, skipped: 0, failures: [], raw: stripAnsi(`${stdout}\n${stderr}`).trim().slice(-2000) });
        return;
      }
      resolve(parsePlaywrightJson(json));
    });
  });
}
