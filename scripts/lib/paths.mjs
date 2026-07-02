// paths.mjs - shared person-root resolution for the multi-person JobKit.
//
// There is NO default person. Every script REQUIRES an explicit person, given as
// either a `--person <slug>` flag or the JOBKIT_PERSON env var (flag wins). If
// neither is present the calling script exits with a clear error.
//
// Layout:  <repo>/people/<slug>/{resume.md, answers.md, applications.json, jobs/, dist/, profile.json}
// Shared code lives in <repo>/scripts/ (this file is <repo>/scripts/lib/paths.mjs).

import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/lib
export const SCRIPTS = join(HERE, "..");              // scripts
export const REPO = join(SCRIPTS, "..");              // repo root
export const PEOPLE = join(REPO, "people");

// Pull `--person <slug>` (or `--person=<slug>`) out of an argv array.
// Returns { slug, rest } where rest is argv with the flag (and its value) removed,
// so callers can keep parsing their own positionals/flags unchanged.
export function stripPersonFlag(argv) {
  const rest = [];
  let slug = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--person") { slug = argv[i + 1] ?? null; i++; continue; }
    const m = a.match(/^--person=(.*)$/);
    if (m) { slug = m[1]; continue; }
    rest.push(a);
  }
  return { slug, rest };
}

function availablePeople() {
  try {
    if (!existsSync(PEOPLE)) return [];
    return readdirSync(PEOPLE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  const names = availablePeople();
  if (names.length) console.error(`Available people: ${names.join(", ")}`);
  console.error("Pass --person <slug> (or set JOBKIT_PERSON). Onboard a new person by");
  console.error("copying people/_template to people/<slug>.");
  process.exit(2);
}

// Resolve the person root. Precedence: --person flag > JOBKIT_PERSON env. No default.
// Exits (code 2) if no person is given, the slug is malformed, or the dir is missing.
// Returns { slug, root, rest, repo }.
export function resolvePerson(argv = process.argv.slice(2)) {
  const { slug: flagSlug, rest } = stripPersonFlag(argv);
  const slug = flagSlug || process.env.JOBKIT_PERSON || null;
  if (!slug) fail("no person specified.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid person slug '${slug}' (use lowercase letters, digits, hyphens).`);
  const root = join(PEOPLE, slug);
  if (!existsSync(root)) fail(`person '${slug}' not found at people/${slug}.`);
  return { slug, root, rest, repo: REPO };
}

// Child-process env that carries the resolved person to spawned scripts, so
// refresh/sync/dashboard don't have to re-splice the flag into argv.
export function childEnv(slug) {
  return { ...process.env, JOBKIT_PERSON: slug };
}
