#!/usr/bin/env node
// jobkit.mjs — minimal, zero-dependency job-application tracker.
// applications.json (an array of records) is the source of truth; this is just a
// nicer terminal view + safe append/update so you don't hand-edit IDs.
// Record shape: { id, company, role, source, url, status, folder,
//                 dates: { added, updated }, notes }
//
// Usage:
//   node scripts/jobkit.mjs list                         show all applications (table)
//   node scripts/jobkit.mjs list <status>                filter by status
//   node scripts/jobkit.mjs add "Company" "Role" [source] [url]
//                                                add a row (status=lead, date=today)
//   node scripts/jobkit.mjs set <id> <status> [note]     update status (+ optional note)
//   node scripts/jobkit.mjs open <id>                     print the row's job-folder path
//
// Statuses (free-form, but these get colored): lead applied screen interview offer rejected withdrawn

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePerson } from "./lib/paths.mjs";

// Person root (requires --person <slug> or JOBKIT_PERSON). `cliArgs` is argv with
// the --person flag stripped, so subcommand parsing below is unchanged.
const { root: ROOT, rest: cliArgs } = resolvePerson();
const DATA = join(ROOT, "applications.json");

const today = () => new Date().toISOString().slice(0, 10);

function load() {
  if (!existsSync(DATA)) return [];
  try {
    const arr = JSON.parse(readFileSync(DATA, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(`Could not parse ${DATA}: ${e.message}`);
    process.exit(1);
  }
}
const save = recs => writeFileSync(DATA, JSON.stringify(recs, null, 2) + "\n");

const COLOR = {
  lead: "\x1b[90m", applied: "\x1b[36m", screen: "\x1b[35m", interview: "\x1b[33m",
  offer: "\x1b[32m", rejected: "\x1b[31m", withdrawn: "\x1b[90m",
};
const R = "\x1b[0m";

function list(filter) {
  let recs = load();
  if (filter) recs = recs.filter(r => r.status.toLowerCase() === filter.toLowerCase());
  if (!recs.length) { console.log("No applications" + (filter ? ` with status '${filter}'` : "") + ". Add one with: node scripts/jobkit.mjs add \"Company\" \"Role\""); return; }
  const w = { id: 3, company: 18, role: 26, status: 10, date: 10 };
  const head = `${"ID".padEnd(w.id)}  ${"COMPANY".padEnd(w.company)}  ${"ROLE".padEnd(w.role)}  ${"STATUS".padEnd(w.status)}  ${"UPDATED".padEnd(w.date)}`;
  console.log("\x1b[1m" + head + R);
  console.log("-".repeat(head.length));
  for (const r of recs) {
    const c = COLOR[r.status?.toLowerCase()] || "";
    const trunc = (s, n) => (s || "").length > n ? s.slice(0, n - 1) + "…" : (s || "");
    const updated = r.dates?.updated || r.dates?.added || "";
    console.log(
      `${String(r.id).padEnd(w.id)}  ${trunc(r.company, w.company).padEnd(w.company)}  ${trunc(r.role, w.role).padEnd(w.role)}  ${c}${(r.status || "").padEnd(w.status)}${R}  ${updated.padEnd(w.date)}`
    );
  }
  // status summary
  const counts = {};
  for (const r of recs) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log("-".repeat(head.length));
  console.log(Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join("  |  ") + `   (total ${recs.length})`);
}

function add(company, role, source = "", url = "") {
  if (!company || !role) { console.error('Usage: node scripts/jobkit.mjs add "Company" "Role" [source] [url]'); process.exit(1); }
  const recs = load();
  const id = recs.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
  const slug = `${company}-${role}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const folder = `jobs/${id}-${slug}`;
  recs.push({ id, company, role, source, url, status: "lead", folder, dates: { added: today(), updated: today() }, notes: "" });
  save(recs);
  console.log(`Added #${id}: ${company} - ${role}  [lead]`);
  console.log(`Job folder: ${folder}  (create with: node scripts/jobkit.mjs scaffold ${id})`);
}

function set(id, status, ...noteParts) {
  const recs = load();
  const rec = recs.find(r => String(r.id) === String(id));
  if (!rec) { console.error(`No application with id ${id}`); process.exit(1); }
  rec.status = status;
  rec.dates = rec.dates || {};
  rec.dates.updated = today();
  if (noteParts.length) rec.notes = noteParts.join(" ");
  save(recs);
  console.log(`#${id} ${rec.company} - ${rec.role}  ->  ${status}`);
}

function open(id) {
  const rec = load().find(r => String(r.id) === String(id));
  if (!rec) { console.error(`No application with id ${id}`); process.exit(1); }
  console.log(rec.folder || `jobs/${id}`);
}

function scaffold(id) {
  const rec = load().find(r => String(r.id) === String(id));
  if (!rec) { console.error(`No application with id ${id}. Add it first.`); process.exit(1); }
  const dir = join(ROOT, rec.folder || `jobs/${id}`);
  mkdirSync(dir, { recursive: true });
  const files = {
    "posting.txt": `# Paste the FULL job description below this line, then run an ATS gap analysis.\n# (In Claude Code: "do an ATS gap analysis for job #${id}")\n\n`,
    "ats-gap.md": `# ATS Gap Analysis — ${rec.company} / ${rec.role}\n\n_Claude fills this from posting.txt vs resume.md._\n\n## Must-have keywords found\n\n## Must-have keywords MISSING\n\n## Suggested edits (truthful only)\n\n## Approx match score\n`,
    "tailored-resume.md": `<!-- Tailored copy of resume.md for ${rec.company} / ${rec.role}. Claude edits this; export to PDF/DOCX for submission. -->\n`,
    "notes.md": `# ${rec.company} — ${rec.role}\n\n- URL: ${rec.url || "<add>"}\n- Source: ${rec.source || "<add>"}\n- Recruiter / contact:\n- Salary range posted:\n- Date applied:\n- Follow-up on:\n- Status log:\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    if (existsSync(p)) { console.log(`  skip (exists): ${name}`); continue; }
    writeFileSync(p, content);
    console.log(`  created: ${name}`);
  }
  console.log(`Job folder ready: ${rec.folder}`);
}

const [cmd, ...args] = cliArgs;
switch (cmd) {
  case "list": case "ls": case undefined: list(args[0]); break;
  case "add": add(...args); break;
  case "set": set(...args); break;
  case "open": open(args[0]); break;
  case "scaffold": scaffold(args[0]); break;
  default:
    console.log("jobkit — job application tracker\n");
    console.log("  node scripts/jobkit.mjs list [status]                 show applications");
    console.log('  node scripts/jobkit.mjs add "Company" "Role" [src] [url]   add a lead');
    console.log("  node scripts/jobkit.mjs scaffold <id>                 create the job's folder + files");
    console.log("  node scripts/jobkit.mjs set <id> <status> [note]      update status");
    console.log("  node scripts/jobkit.mjs open <id>                     print job folder path");
}
