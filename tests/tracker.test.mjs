// Run: node --test tests/
// Each test gets its own throwaway people dir via JOBKIT_PEOPLE_DIR, so real data is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const SLUG = "tester";

function person(t, { apps = [], profile } = {}) {
  const people = mkdtempSync(join(tmpdir(), "jobkit-test-"));
  t.after(() => rmSync(people, { recursive: true, force: true }));
  const root = join(people, SLUG);
  mkdirSync(join(root, "jobs"), { recursive: true });
  writeFileSync(join(root, "applications.json"), JSON.stringify(apps));
  writeFileSync(join(root, "profile.json"), JSON.stringify(profile ?? {
    comp: { annualTarget: 100000, annualFloor: 90000, hourlyTarget: 50, hourlyFloor: 45 },
    weights: { skill: 0.5, comp: 0.3, company: 0.2 },
    skillsProfessional: ["c#"], skillsFamiliar: [],
  }));
  const run = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), "--person", SLUG, ...args],
    { encoding: "utf8", env: { ...process.env, JOBKIT_PEOPLE_DIR: people } });
  const apps_ = () => JSON.parse(readFileSync(join(root, "applications.json"), "utf8"));
  return { root, run, apps: apps_ };
}

const rec = (id, company, role, url = "", extra = {}) => ({
  id, company, role, source: "", url, status: "lead", folder: `jobs/${id}-x`,
  dates: { added: "2026-01-01", updated: "2026-01-01" }, notes: "", ...extra,
});

// ---- add: duplicates ----

test("Given a tracked posting, When the same URL is added with different tracking params, Then it is refused", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer", "https://www.linkedin.com/jobs/view/123/?trk=a&refId=x")] });
  // When
  const r = p.run("jobkit.mjs", "add", "Acme Corp", "Software Engineer", "LinkedIn", "https://linkedin.com/jobs/view/123?trk=b");
  // Then
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Already tracked as #1/);
  assert.equal(p.apps().length, 1);
});

test("Given a tracked company and role, When the same company and role are added with no URL, Then it is refused", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Senior .NET Engineer")] });
  // When
  const r = p.run("jobkit.mjs", "add", "ACME", "senior .net engineer");
  // Then
  assert.equal(r.status, 1);
  assert.equal(p.apps().length, 1);
});

test("Given a tracked Indeed posting, When a different job id on the same path is added, Then it is accepted", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer", "https://www.indeed.com/viewjob?jk=aaa")] });
  // When
  const r = p.run("jobkit.mjs", "add", "Other Co", "Engineer", "Indeed", "https://www.indeed.com/viewjob?jk=bbb");
  // Then
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.apps().length, 2);
});

test("Given a tracked company and role, When it is added again with --force, Then a second record is created", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer")] });
  // When
  const r = p.run("jobkit.mjs", "add", "Acme", "Engineer", "--force");
  // Then
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(p.apps().map((a) => a.id), [1, 2]);
});

// ---- set: history and stage dates ----

test("Given an application with a note, When its status is set with a new note, Then both notes stay in history", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer")] });
  p.run("jobkit.mjs", "set", "1", "applied", "Easy Apply submitted");
  // When
  const r = p.run("jobkit.mjs", "set", "1", "screen", "Recruiter call Thu");
  // Then
  assert.equal(r.status, 0, r.stderr);
  const a = p.apps()[0];
  assert.equal(a.status, "screen");
  assert.equal(a.notes, "Recruiter call Thu");
  assert.deepEqual(a.history.map((h) => [h.status, h.note]), [["applied", "Easy Apply submitted"], ["screen", "Recruiter call Thu"]]);
});

test("Given an application already applied on an earlier date, When applied is set again, Then the first applied date is kept", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer", "", { status: "applied", dates: { added: "2026-01-01", updated: "2026-01-02", applied: "2026-01-02" } })] });
  // When
  p.run("jobkit.mjs", "set", "1", "applied", "resubmitted");
  // Then
  const a = p.apps()[0];
  assert.equal(a.dates.applied, "2026-01-02");
  assert.notEqual(a.dates.updated, "2026-01-02");
});

test("Given a lead, When it is first set to applied, Then the applied date is recorded", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Acme", "Engineer")] });
  // When
  p.run("jobkit.mjs", "set", "1", "applied");
  // Then
  assert.match(p.apps()[0].dates.applied ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

// ---- rank: id comes from the folder ----

test("Given a score.json whose jobId disagrees with its folder, When ranked, Then the folder id is used and a warning is printed", (t) => {
  // Given
  const p = person(t);
  mkdirSync(join(p.root, "jobs", "1-acme"));
  writeFileSync(join(p.root, "jobs", "1-acme", "score.json"), JSON.stringify({ jobId: 2, company: "Acme", requiredSkills: ["c#"] }));
  // When
  const r = p.run("rank.mjs", "--json");
  // Then
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).jobs[0].jobId, 1);
  assert.match(r.stderr, /says jobId 2; using folder id 1/);
});

test("Given a score.json with no jobId, When ranked, Then the folder id is used without a warning", (t) => {
  // Given
  const p = person(t);
  mkdirSync(join(p.root, "jobs", "7-acme"));
  writeFileSync(join(p.root, "jobs", "7-acme", "score.json"), JSON.stringify({ company: "Acme", requiredSkills: ["c#"] }));
  // When
  const r = p.run("rank.mjs", "--json");
  // Then
  assert.equal(JSON.parse(r.stdout).jobs[0].jobId, 7);
  assert.equal(r.stderr, "");
});

// ---- people dir override ----

test("Given JOBKIT_PEOPLE_DIR points outside the repo, When a person there is listed, Then their tracker is read", (t) => {
  // Given
  const p = person(t, { apps: [rec(1, "Outside Co", "Engineer")] });
  // When
  const r = p.run("jobkit.mjs", "list");
  // Then
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Outside Co/);
});
