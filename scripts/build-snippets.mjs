#!/usr/bin/env node
// build-snippets.mjs - generate an Espanso text-expander config from answers.md.
//
// answers.md stays the single source of truth; this picks selected fields/snippets out
// of it and emits an Espanso match file you load once. Then typing a trigger like
// ";email" expands to your value in ANY text field on ANY site/app (local, private).
//
// Usage:
//   node scripts/build-snippets.mjs
//
// Output: dist/espanso/jobkit.yml   (copy into your Espanso match dir - command printed).
// Convention: in an answers.md value, text after " // " is a private note and is dropped.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePerson } from "./lib/paths.mjs";

// Person root (requires --person <slug> or JOBKIT_PERSON): answers.md source +
// dist/espanso output both live under the person's dir.
const { root: ROOT } = resolvePerson();
const PREFIX = ";"; // trigger prefix, e.g. ";email"
const src = readFileSync(join(ROOT, "answers.md"), "utf8");

// value before " // " note, trimmed
const cleanVal = v => v.split(" // ")[0].trim();
const isPlaceholder = v => !v || /<[^>]+>/.test(v) || v.startsWith("_");

// 1) all 2-column table rows -> { label: value }
const fields = {};
for (const line of src.split(/\r?\n/)) {
  const m = line.match(/^\|([^|]+)\|([^|]+)\|\s*$/);
  if (!m) continue;
  const label = m[1].trim(), value = m[2].trim();
  if (!label || label === "Field" || label === "Question" || /^-+$/.test(label)) continue;
  fields[label] = value;
}

// 2) snippet: find "### ...heading..." then join following blockquote lines into one paragraph
function snippet(headingIncludes) {
  const lines = src.split(/\r?\n/);
  const i = lines.findIndex(l => /^###\s/.test(l) && l.toLowerCase().includes(headingIncludes.toLowerCase()));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j];
    if (/^#{1,3}\s/.test(t)) break;
    if (/^\s*>/.test(t)) body.push(t.replace(/^\s*>\s?/, "").trim());
    else if (body.length && !t.trim()) break;
  }
  return body.filter(Boolean).join(" ").trim() || null;
}

// --- what to expose (values come from answers.md; triggers + selection live here) ---
const FIELDS = [
  ["name", "Full name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"],
  ["linkedin", "LinkedIn"], ["github", "GitHub / Portfolio"], ["years", "Total years of experience"],
  ["auth", "Authorized to work in the US?"], ["sponsor", "Require visa sponsorship now or in future?"],
  ["relocate", "Willing to relocate?"], ["remote", "Remote / hybrid / onsite preference"],
  ["salary", "Desired salary / rate"], ["start", "Earliest start date"],
  ["comp", "Current/most recent compensation"], ["gender", "Gender"], ["race", "Race/Ethnicity"],
  ["veteran", "Veteran status"], ["disability", "Disability status"], ["edu", "Highest level"],
];
const SNIPPETS = [
  ["pitch", "Tell me about yourself"], ["why", "Why are you interested"],
  ["strength", "Greatest strength"],
];

const matches = [], cheat = [], skipped = [];
const add = (trig, raw) => {
  const val = cleanVal(raw);
  if (isPlaceholder(val)) { skipped.push(trig); return; }
  matches.push({ trigger: PREFIX + trig, replace: val });
  cheat.push([PREFIX + trig, val]);
};

for (const [trig, label] of FIELDS) {
  if (fields[label] == null) { skipped.push(`${trig} (label not found: ${label})`); continue; }
  add(trig, fields[label]);
}
for (const [trig, head] of SNIPPETS) {
  const s = snippet(head);
  if (s == null) { skipped.push(`${trig} (snippet not found: ${head})`); continue; }
  add(trig, s);
}

// --- emit Espanso YAML (block scalars avoid all quoting/escaping issues) ---
const esc = s => s; // block scalar is literal; no escaping needed
const yaml = "# Generated from answers.md by scripts/build-snippets.mjs - DO NOT EDIT BY HAND.\n" +
  "# Rebuild: node scripts/build-snippets.mjs\n" +
  "matches:\n" +
  matches.map(m => {
    const body = esc(m.replace).split("\n").map(l => "      " + l).join("\n");
    return `  - trigger: "${m.trigger}"\n    replace: |-\n${body}\n`;
  }).join("");

const outDir = join(ROOT, "dist", "espanso");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "jobkit.yml");
writeFileSync(outFile, yaml);

// --- report ---
console.log(`Generated ${matches.length} expansions -> dist/espanso/jobkit.yml\n`);
const pad = Math.max(...cheat.map(([t]) => t.length));
for (const [t, v] of cheat) {
  const preview = v.length > 60 ? v.slice(0, 57) + "..." : v;
  console.log(`  ${t.padEnd(pad)}  ${preview}`);
}
if (skipped.length) console.log(`\nSkipped (incomplete): ${skipped.join(", ")}`);

// install hint
const matchDir = process.env.APPDATA ? join(process.env.APPDATA, "espanso", "match") : null;
console.log("\nInstall:");
if (matchDir && existsSync(matchDir)) {
  console.log(`  Espanso detected. Copy in:\n    cp "${outFile}" "${join(matchDir, "jobkit.yml")}"`);
} else {
  console.log("  1) Install Espanso (https://espanso.org)  2) run: espanso path  to find the match dir");
  console.log(`  3) copy dist/espanso/jobkit.yml into that match/ folder  4) espanso restart`);
}
