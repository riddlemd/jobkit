#!/usr/bin/env node
// refresh.mjs - regenerate ALL global artifacts in one command:
//   1. Resume    resume.md  -> resume.html + dist/resume.{pdf,docx}      (build.mjs)
//   2. Snippets  answers.md -> Espanso config (+ copy + restart)         (sync-snippets.mjs)
//   3. Dashboard score.json -> dist/jobs-dashboard.html                  (dashboard.mjs)
//
// Per-job tailored resumes are built on demand during tailoring, NOT here.
//
// Usage:
//   node scripts/refresh.mjs               full refresh (incl. Espanso sync + restart)
//   node scripts/refresh.mjs --no-espanso  regenerate snippet YAML only (skip Espanso copy/restart)

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resolvePerson, childEnv, SCRIPTS } from "./lib/paths.mjs";

// Person is REQUIRED (--person <slug> or JOBKIT_PERSON) and passed to every child
// via env. `rest` is argv with the --person flag stripped.
const { slug, rest } = resolvePerson();
const noEspanso = rest.includes("--no-espanso");

const steps = [
  ["Resume    (resume.md -> html + pdf + docx)", "build.mjs"],
  noEspanso
    ? ["Snippets  (answers.md -> Espanso YAML only)", "build-snippets.mjs"]
    : ["Snippets  (answers.md -> Espanso + restart)", "sync-snippets.mjs"],
  ["Dashboard (score.json -> jobs-dashboard.html)", "dashboard.mjs"],
];

const results = [];
for (const [label, script] of steps) {
  console.log(`\n=== ${label} ===`);
  try {
    execFileSync(process.execPath, [join(SCRIPTS, script)], { stdio: "inherit", env: childEnv(slug) });
    results.push([label, true]);
  } catch (e) {
    results.push([label, false]);
    console.error(`  ! ${script} failed: ${e.message}`);
  }
}

console.log("\n──────── refresh summary ────────");
for (const [label, ok] of results) console.log(`  ${ok ? "\x1b[32mOK\x1b[0m  " : "\x1b[31mFAIL\x1b[0m"}  ${label}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} step(s) failed - see above.` : "\nAll global artifacts refreshed.");
process.exit(failed ? 1 : 0);
