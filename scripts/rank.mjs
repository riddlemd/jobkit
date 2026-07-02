#!/usr/bin/env node
// rank.mjs — transparent, reproducible ranking of job applications.
// Zero dependencies. All inputs are PRE-CURATED JSON — this script does NO NLP
// and NO free-text parsing. It only reads structured tokens and numbers and
// applies the fixed formulas below, so any score can be reproduced by hand.
//
// INPUTS (read-only; owned by the orchestrator, never written here):
//   people/<slug>/profile.json       — comp targets, dimension weights, skill sets
//   people/<slug>/jobs/<id>/score.json — one curated scorecard per job
//
// SCORING (all token matching is lowercase + trim, exact membership only):
//
//   SKILL   For each token t in requiredSkills:
//             credit = 1.0 if t ∈ skillsProfessional
//                      0.5 if t ∈ skillsFamiliar
//                      0.0 otherwise
//           skillPct = round(100 * Σcredit / requiredSkills.length)
//           preferredPct = same formula over preferredSkills (DISPLAY ONLY,
//           not part of the composite). requiredSkills empty -> skill = null.
//
//   COMP    target = hourlyTarget if comp.type==="hourly" else annualTarget.
//           If comp.min AND comp.max are both null -> comp = null (N/A).
//           midpoint = average of whichever of {min,max} are non-null.
//           compPct  = min(100, round(100 * midpoint / target))
//           meetsTarget = midpoint >= target
//           CAVEAT: comp% is BASE PAY ONLY. An annual FTE figure may bundle
//           equity/benefits that an hourly contract rate does not.
//
//   COMPANY If companyRating.glassdoor is a number ->
//             companyPct = round(glassdoor / 5 * 100)
//           else null. If isStaffingAgency is true the value is still computed
//           but flagged LOW SIGNAL (an agency's rating != the end client's
//           workplace); the table shows "n/a*" while the number still counts.
//
//   COMPOSITE  Weighted average over ONLY the non-null dimensions, with the
//           weights renormalized so a missing dimension does not count as zero:
//             composite = round( Σ(w_d * pct_d) / Σ(w_d) )   over available d
//           If every dimension is null -> composite = null.
//
// Usage (--person <slug> REQUIRED, or set JOBKIT_PERSON):
//   node scripts/rank.mjs --person <slug>          ranked table of all jobs (composite DESC)
//   node scripts/rank.mjs --person <slug> <id>     detailed, reproducible breakdown for one job
//
// Testing hook: set RANK_DIR to bypass person resolution and point profile + jobs elsewhere:
//   RANK_DIR/profile.json and RANK_DIR/jobs/<id>/score.json

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePerson } from "./lib/paths.mjs";

// Person is REQUIRED (--person <slug> or JOBKIT_PERSON). RANK_DIR is a test-only
// override that bypasses person resolution and points profile + jobs elsewhere:
//   RANK_DIR/profile.json and RANK_DIR/jobs/<id>/score.json
const RANK_DIR = process.env.RANK_DIR || null;
let PROFILE_PATH, JOBS_DIR, cliArgs;
if (RANK_DIR) {
  PROFILE_PATH = join(RANK_DIR, "profile.json");
  JOBS_DIR = join(RANK_DIR, "jobs");
  cliArgs = process.argv.slice(2);
} else {
  const person = resolvePerson();
  PROFILE_PATH = join(person.root, "profile.json");
  JOBS_DIR = join(person.root, "jobs");
  cliArgs = person.rest;
}

// ── ANSI helpers (same palette style as jobkit.mjs) ─────────────────────────
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

const norm = (t) => String(t ?? "").toLowerCase().trim();
const isNum = (x) => typeof x === "number" && !Number.isNaN(x);
const trunc = (s, n) => ((s || "").length > n ? s.slice(0, n - 1) + "…" : s || "");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function compositeColor(v) {
  if (v === null) return DIM;
  if (v >= 80) return GREEN;
  if (v >= 60) return YELLOW;
  return RED;
}

// ── Loading ─────────────────────────────────────────────────────────────────
function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    console.error(`${RED}Error:${R} profile.json not found at ${PROFILE_PATH}`);
    console.error("This file is required (comp targets, weights, skill sets). It lives in the person's dir.");
    process.exit(1);
  }
  let p;
  try {
    p = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
  } catch (e) {
    console.error(`${RED}Error:${R} could not parse ${PROFILE_PATH}: ${e.message}`);
    process.exit(1);
  }
  // Pre-normalize skill sets into Sets for O(1) exact lookup.
  p._professional = new Set((p.skillsProfessional || []).map(norm));
  p._familiar = new Set((p.skillsFamiliar || []).map(norm));
  return p;
}

function loadScores() {
  if (!existsSync(JOBS_DIR)) return [];
  const out = [];
  for (const ent of readdirSync(JOBS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const f = join(JOBS_DIR, ent.name, "score.json");
    if (!existsSync(f)) continue;
    try {
      const s = JSON.parse(readFileSync(f, "utf8"));
      s._folder = ent.name;
      out.push(s);
    } catch (e) {
      console.error(`${YELLOW}Warning:${R} skipping ${f}: ${e.message}`);
    }
  }
  return out;
}

// ── Scoring ─────────────────────────────────────────────────────────────────
function skillCredit(profile, token) {
  const t = norm(token);
  if (profile._professional.has(t)) return 1.0;
  if (profile._familiar.has(t)) return 0.5;
  return 0.0;
}

function skillBreakdown(profile, tokens) {
  // Returns { pct, matched:[{token,credit,tag}], missing:[token] } or pct=null if empty.
  const list = Array.isArray(tokens) ? tokens : [];
  if (list.length === 0) return { pct: null, matched: [], missing: [] };
  const matched = [];
  const missing = [];
  let sum = 0;
  for (const raw of list) {
    const credit = skillCredit(profile, raw);
    sum += credit;
    const tag = credit === 1.0 ? "prof" : credit === 0.5 ? "familiar" : "miss";
    if (credit > 0) matched.push({ token: norm(raw), credit, tag });
    else missing.push(norm(raw));
  }
  return { pct: Math.round((100 * sum) / list.length), matched, missing };
}

function compScore(profile, comp) {
  const c = comp || {};
  const type = norm(c.type) === "hourly" ? "hourly" : "annual";
  const target = type === "hourly" ? profile.comp.hourlyTarget : profile.comp.annualTarget;
  const floor = type === "hourly" ? profile.comp.hourlyFloor : profile.comp.annualFloor;
  const parts = [c.min, c.max].filter(isNum);
  if (parts.length === 0) return { pct: null, type, target, floor, midpoint: null, meetsTarget: null };
  const midpoint = parts.reduce((a, b) => a + b, 0) / parts.length;
  const pct = Math.min(100, Math.round((100 * midpoint) / target));
  return { pct, type, target, floor, midpoint, meetsTarget: midpoint >= target };
}

function companyScore(score) {
  const g = score.companyRating ? score.companyRating.glassdoor : null;
  const lowSignal = score.isStaffingAgency === true;
  if (!isNum(g)) return { pct: null, lowSignal, glassdoor: null };
  return { pct: Math.round((g / 5) * 100), lowSignal, glassdoor: g };
}

function composite(profile, dims) {
  // dims: { skill:{pct}, comp:{pct}, company:{pct} }. Renormalize over non-null.
  const w = profile.weights;
  const avail = [
    ["skill", dims.skill.pct, w.skill],
    ["comp", dims.comp.pct, w.comp],
    ["company", dims.company.pct, w.company],
  ].filter(([, pct]) => pct !== null);
  const wsum = avail.reduce((a, [, , weight]) => a + weight, 0);
  if (wsum === 0) return { value: null, terms: [], wsum: 0 };
  const num = avail.reduce((a, [, pct, weight]) => a + weight * pct, 0);
  return {
    value: Math.round(num / wsum),
    terms: avail.map(([name, pct, weight]) => ({ name, pct, weight })),
    wsum,
  };
}

function scoreJob(profile, s) {
  const skill = skillBreakdown(profile, s.requiredSkills);
  const preferred = skillBreakdown(profile, s.preferredSkills);
  const comp = compScore(profile, s.comp);
  const company = companyScore(s);
  const comp0 = composite(profile, { skill, comp, company });
  return { s, skill, preferred, comp, company, composite: comp0 };
}

// ── Footer ──────────────────────────────────────────────────────────────────
function footer(profile) {
  const w = profile.weights;
  console.log(DIM + "─".repeat(64) + R);
  console.log(
    `${DIM}Weights:${R} skill ${w.skill}  ·  comp ${w.comp}  ·  company ${w.company}` +
      `  ${DIM}(renormalized over available dimensions)${R}`
  );
  console.log(`${DIM}Caveats:${R}`);
  console.log(`  ${DIM}• comp% is BASE PAY ONLY — an annual FTE may include equity/benefits an hourly contract lacks.${R}`);
  console.log(`  ${DIM}• n/a* = staffing-agency rating is LOW SIGNAL (agency != end-client workplace); it still counts in the composite.${R}`);
  console.log(`  ${DIM}• company ratings are unverified and sourced from web search — sanity-check before relying on them.${R}`);
  console.log(`  ${DIM}• CONF = how many of the 3 dimensions (skill/comp/company) backed the composite. A 3/3 score is more trustworthy than a thin 1/3 — a 1/3 job floats up only because there's nothing to pull it down.${R}`);
  console.log(`  ${RED}⚠ REACH${R}${DIM} = the score can't see level/interview-bar. A REACH role (e.g. Principal at a top-tier co) may score high on skill/comp/company yet have low real odds. Treat its composite as inflated.${R}`);
}

// ── Commands ────────────────────────────────────────────────────────────────
function fmtPct(pct) {
  return pct === null ? "N/A" : String(pct) + "%";
}

function table(profile, jobs) {
  if (jobs.length === 0) {
    console.log(`No score.json files found under ${JOBS_DIR}.`);
    console.log('Create one per job at jobs/<id>-<slug>/score.json, then re-run.');
    footer(profile);
    return;
  }
  const ranked = rankedList(profile, jobs);

  const w = { rank: 4, id: 3, company: 16, skill: 6, comp: 6, co: 6, comp0: 9, dims: 6 };
  const head =
    `${pad("RANK", w.rank)} ${pad("ID", w.id)} ${pad("COMPANY", w.company)} ` +
    `${padL("SKILL%", w.skill)} ${padL("COMP%", w.comp)} ${padL("CO%", w.co)} ${padL("COMPOSITE", w.comp0)} ${padL("CONF", w.dims)}`;
  console.log(BOLD + head + R);
  console.log("─".repeat(head.length));

  ranked.forEach((r, i) => {
    const coCell = r.company.pct === null ? "N/A" : r.company.lowSignal ? "n/a*" : r.company.pct + "%";
    const cv = r.composite.value;
    const cColor = compositeColor(cv);
    console.log(
      `${pad("#" + (i + 1), w.rank)} ` +
        `${pad(r.s.jobId ?? "?", w.id)} ` +
        `${pad(trunc(r.s.company, w.company), w.company)} ` +
        `${padL(fmtPct(r.skill.pct), w.skill)} ` +
        `${padL(fmtPct(r.comp.pct), w.comp)} ` +
        `${padL(coCell, w.co)} ` +
        `${cColor}${padL(cv === null ? "N/A" : cv, w.comp0)}${R} ` +
        `${r.composite.terms.length < 3 ? YELLOW : DIM}${padL(r.composite.terms.length + "/3", w.dims)}${R}` +
        `${r.s.reach === true ? `  ${RED}⚠ REACH${R}` : ""}`
    );
  });
  footer(profile);
}

function detail(profile, jobs, id) {
  const job = jobs.find((j) => String(j.jobId) === String(id));
  if (!job) {
    console.error(`${RED}No job with id ${id}.${R} Known ids: ${jobs.map((j) => j.jobId).join(", ") || "(none)"}`);
    process.exit(1);
  }
  const r = scoreJob(profile, job);
  const s = r.s;

  console.log(`${BOLD}#${s.jobId} — ${s.company}${R}`);
  console.log(`${DIM}${s.role || ""}${s.isStaffingAgency ? "   [staffing agency]" : ""}${R}`);
  if (s.reach === true) {
    console.log(`${RED}⚠ REACH — the score OVERSTATES real odds here.${R}`);
    if (s.reachNote) console.log(`  ${YELLOW}${s.reachNote}${R}`);
  }
  console.log("");

  // SKILL
  console.log(`${BOLD}SKILL${R}  ${fmtPct(r.skill.pct)}   ${DIM}(weight ${profile.weights.skill})${R}`);
  if (r.skill.pct === null) {
    console.log(`  ${DIM}no requiredSkills listed — dimension N/A${R}`);
  } else {
    const tagColor = (t) => (t === "prof" ? GREEN : t === "familiar" ? YELLOW : RED);
    for (const m of r.skill.matched) {
      console.log(`  ${tagColor(m.tag)}✓${R} ${m.token}  ${DIM}[${m.tag} = ${m.credit.toFixed(1)}]${R}`);
    }
    for (const miss of r.skill.missing) {
      console.log(`  ${RED}✗${R} ${miss}  ${DIM}[miss = 0.0]${R}`);
    }
    console.log(`  ${DIM}preferredPct (display only): ${fmtPct(r.preferred.pct)}${R}`);
  }
  console.log("");

  // COMP
  console.log(`${BOLD}COMP${R}   ${fmtPct(r.comp.pct)}   ${DIM}(weight ${profile.weights.comp})${R}`);
  const unit = r.comp.type === "hourly" ? "/hr" : "/yr";
  const money = (n) => (isNum(n) ? "$" + n.toLocaleString("en-US") + unit : "not posted");
  console.log(`  ${DIM}type:${R} ${r.comp.type}   ${DIM}target:${R} ${money(r.comp.target)}   ${DIM}floor:${R} ${money(r.comp.floor)}`);
  console.log(`  ${DIM}posted range:${R} ${money(s.comp?.min)} — ${money(s.comp?.max)}`);
  if (r.comp.pct === null) {
    console.log(`  ${DIM}compensation not posted — dimension N/A${R}`);
  } else {
    console.log(`  ${DIM}midpoint:${R} $${Math.round(r.comp.midpoint).toLocaleString("en-US")}${unit}` +
      `   ${DIM}meetsTarget:${R} ${r.comp.meetsTarget ? GREEN + "yes" + R : RED + "no" + R}`);
  }
  console.log("");

  // COMPANY
  console.log(`${BOLD}COMPANY${R} ${fmtPct(r.company.pct)}   ${DIM}(weight ${profile.weights.company})${R}`);
  const cr = s.companyRating || {};
  if (r.company.pct === null) {
    console.log(`  ${DIM}no glassdoor rating — dimension N/A${R}`);
  } else {
    console.log(`  ${DIM}glassdoor:${R} ${cr.glassdoor}/5   ${DIM}source:${R} ${cr.source || "?"}   ${DIM}verified:${R} ${cr.verified ? GREEN + "yes" + R : YELLOW + "no" + R}`);
    if (cr.note) console.log(`  ${DIM}note:${R} ${cr.note}`);
    if (r.company.lowSignal) console.log(`  ${YELLOW}LOW SIGNAL:${R} staffing-agency rating reflects the agency, not the end-client workplace.`);
  }
  console.log("");

  // COMPOSITE
  const c = r.composite;
  const cColor = compositeColor(c.value);
  console.log(`${BOLD}COMPOSITE${R}  ${cColor}${c.value === null ? "N/A" : c.value}${R}`);
  if (c.value === null) {
    console.log(`  ${DIM}all dimensions N/A — no composite.${R}`);
  } else {
    const terms = c.terms.map((t) => `${t.weight}·${t.pct}`).join(" + ");
    const wsum = c.terms.map((t) => t.weight).join(" + ");
    console.log(`  ${DIM}= (${terms}) / (${wsum}) = ${c.value}${R}`);
    console.log(`  ${DIM}(weights renormalized over ${c.terms.length} available dimension${c.terms.length === 1 ? "" : "s"})${R}`);
    const confColor = c.terms.length < 3 ? YELLOW : GREEN;
    const measured = c.terms.map((t) => t.name).join(", ");
    console.log(`  ${confColor}confidence ${c.terms.length}/3${R} ${DIM}dimensions measured (${measured})` +
      `${c.terms.length < 3 ? " — comp/company gaps mean this composite is less certain than a 3/3 score" : ""}${R}`);
  }
  console.log("");
  footer(profile);
}

// ── Ranked list (shared by table + JSON) ────────────────────────────────────
function rankedList(profile, jobs) {
  return jobs
    .map((j) => scoreJob(profile, j))
    .sort((a, b) => {
      const av = a.composite.value, bv = b.composite.value;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
}

// ── JSON output (consumed by scripts/dashboard.mjs — one source of truth) ────
function emitJson(profile, jobs) {
  const out = rankedList(profile, jobs).map((r, i) => ({
    rank: i + 1,
    jobId: r.s.jobId ?? null,
    company: r.s.company ?? "",
    role: r.s.role ?? "",
    folder: r.s._folder ?? null,
    isStaffingAgency: r.s.isStaffingAgency === true,
    contract: r.s.contract === true,
    skill: r.skill.pct,
    preferred: r.preferred.pct,
    comp: {
      pct: r.comp.pct, type: r.comp.type, target: r.comp.target,
      min: r.s.comp?.min ?? null, max: r.s.comp?.max ?? null,
      midpoint: r.comp.midpoint, meetsTarget: r.comp.meetsTarget,
    },
    rating: {
      pct: r.company.pct, glassdoor: r.company.glassdoor, lowSignal: r.company.lowSignal,
      verified: !!(r.s.companyRating && r.s.companyRating.verified),
      source: r.s.companyRating?.source ?? null, note: r.s.companyRating?.note ?? null,
      url: r.s.companyRating?.url ?? null,
    },
    composite: r.composite.value,
    confidence: { measured: r.composite.terms.length, of: 3, dims: r.composite.terms.map((t) => t.name) },
    reach: r.s.reach === true,
    reachNote: r.s.reach === true ? r.s.reachNote ?? null : null,
    skillDetail: { matched: r.skill.matched, missing: r.skill.missing },
  }));
  process.stdout.write(JSON.stringify({ weights: profile.weights, jobs: out }, null, 2) + "\n");
}

// ── Entry ───────────────────────────────────────────────────────────────────
const [arg] = cliArgs;
const profile = loadProfile();
const jobs = loadScores();

if (arg === undefined) {
  table(profile, jobs);
} else if (arg === "--json") {
  emitJson(profile, jobs);
} else if (/^\d+$/.test(arg) || jobs.some((j) => String(j.jobId) === String(arg))) {
  detail(profile, jobs, arg);
} else {
  console.log("rank — transparent, reproducible job ranking\n");
  console.log("  node scripts/rank.mjs            ranked table of all jobs");
  console.log("  node scripts/rank.mjs <id>       detailed breakdown for one job");
}
