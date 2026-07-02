#!/usr/bin/env node
// sync-snippets.mjs - one command to push answers.md changes into Espanso.
// 1) regenerate dist/espanso/jobkit.yml from answers.md
// 2) copy it into the Espanso match/ folder
// 3) restart Espanso so the new expansions load
//
// Usage: node scripts/sync-snippets.mjs

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePerson, childEnv, SCRIPTS } from "./lib/paths.mjs";

// Person root (requires --person <slug> or JOBKIT_PERSON). Espanso itself is a single
// GLOBAL config, so whoever you sync LAST becomes the live person in the expander.
const { root: ROOT, slug } = resolvePerson();
const firstExisting = ps => ps.find(p => p && existsSync(p));

// 1) build (pass the person through to the child via env)
console.log(`[1/3] Generating snippets from answers.md (person: ${slug}) ...`);
execFileSync(process.execPath, [join(SCRIPTS, "build-snippets.mjs")], { stdio: "inherit", env: childEnv(slug) });

// 2) copy into Espanso match dir
const src = join(ROOT, "dist", "espanso", "jobkit.yml");
const matchDir = process.env.APPDATA ? join(process.env.APPDATA, "espanso", "match") : null;
if (!matchDir || !existsSync(matchDir)) {
  console.error(`\n[2/3] Espanso match dir not found (${matchDir}). Is Espanso installed? Run: espanso path`);
  process.exit(1);
}
const dest = join(matchDir, "jobkit.yml");
copyFileSync(src, dest);
console.log(`\n[2/3] Copied -> ${dest}`);

// 3) restart Espanso (best-effort)
const esp = firstExisting([
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Espanso", "espansod.exe"),
  "C:/Program Files/Espanso/espansod.exe",
  "C:/Program Files/Espanso/espanso.exe",
]);
if (!esp) {
  console.log("[3/3] Espanso binary not found - copied the file, but restart it yourself to load changes.");
  process.exit(0);
}
try {
  execFileSync(esp, ["restart"], { stdio: "ignore" });
  const status = execFileSync(esp, ["status"], { encoding: "utf8" }).trim();
  console.log(`[3/3] Espanso restarted - ${status}`);
} catch (e) {
  console.log("[3/3] Restart reported an issue (often harmless). Verify with: espansod.exe status");
}
console.log("\nDone. Test a trigger (e.g. type ;email) in any text field.");
