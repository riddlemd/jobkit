#!/usr/bin/env node
// dashboard.mjs - render an HTML score dashboard for the job pipeline.
// Scores come straight from `rank.mjs --json` (single source of truth - no
// duplicated scoring math here). Output: dist/jobs-dashboard.html.
//
// Usage: node scripts/dashboard.mjs --person <slug>   (then open the person's dist/jobs-dashboard.html)

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePerson, childEnv, SCRIPTS } from "./lib/paths.mjs";

// Person root (requires --person <slug> or JOBKIT_PERSON): dashboard writes into the
// person's dist/. rank.mjs is spawned with the same person carried via env.
const { root: ROOT, slug } = resolvePerson();

// pull live scores from rank.mjs
const data = JSON.parse(
  execFileSync(process.execPath, [join(SCRIPTS, "rank.mjs"), "--json"], { encoding: "utf8", env: childEnv(slug) })
);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tier = (v) => (v == null ? "na" : v >= 80 ? "hi" : v >= 60 ? "mid" : "lo");
const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`);
const money = (n, unit) => (typeof n === "number" ? "$" + n.toLocaleString("en-US") + unit : "n/a");

function bar(label, pct, cls, valueText) {
  const na = pct == null;
  const fill = na ? "" : `<div class="fill ${cls}" style="width:${pct}%"></div>`;
  const track = na ? `<div class="track na"><span>N/A</span></div>` : `<div class="track">${fill}</div>`;
  const val = valueText != null ? valueText : na ? "N/A" : pct + "%";
  return `<div class="row"><div class="lbl">${label}</div>${track}<div class="val">${esc(val)}</div></div>`;
}

function card(j) {
  const comp = j.comp, rating = j.rating;
  const unit = comp.type === "hourly" ? "/hr" : "/yr";
  const compNote = comp.pct == null
    ? "not posted"
    : `${money(comp.min, unit)}–${money(comp.max, unit)} · ${comp.meetsTarget ? "meets target" : "below target"}`;
  let ratingHtml;
  if (rating.pct == null) {
    ratingHtml = "no rating";
  } else {
    const gd = `Glassdoor ${esc(rating.glassdoor)}/5`;
    const link = rating.url
      ? `<a href="${escAttr(rating.url)}" target="_blank" rel="noopener">${gd}</a>`
      : gd;
    const suffix = `${rating.lowSignal ? " - staffing (low signal)" : ""}${rating.verified ? "" : " - unverified"}`;
    ratingHtml = link + esc(suffix);
  }
  const staffBadge = j.isStaffingAgency ? `<span class="badge staff">staffing agency</span>` : "";
  const reachBadge = j.reach ? `<span class="badge reach" title="${esc(j.reachNote || "")}">&#9888; reach</span>` : "";
  const contractBadge = j.contract ? `<span class="badge contract">contract</span>` : "";
  const sc = (j.status || "").toLowerCase().replace(/[^a-z]/g, "");
  const statusPill = j.status ? `<span class="status ${sc}">${esc(j.status)}</span>` : "";
  return `
  <div class="card ${tier(j.composite)}${j.closed ? " closed" : ""}">
    <div class="rank">${j.closed ? "" : medal(j.displayRank)}</div>
    <div class="body">
      <div class="head">
        <div>
          <div class="co">${esc(j.company)} <span class="jid">#${esc(j.jobId)}</span> ${staffBadge} ${reachBadge} ${contractBadge}</div>
          <div class="role">${esc(j.role)}</div>
        </div>
        <div class="scorebox">
          ${statusPill}
          <div class="composite ${tier(j.composite)}">
            <div class="num">${j.composite == null ? "N/A" : j.composite}</div>
            <div class="cap">composite</div>
          </div>
          <div class="conf ${j.confidence.measured < 3 ? "low" : ""}" title="${j.confidence.measured} of 3 dimensions (skill/comp/company) backed this score">${j.confidence.measured}/3 dims</div>
        </div>
      </div>
      <div class="bars">
        ${bar("Skill", j.skill, "skill", null)}
        ${bar("Comp", comp.pct, "comp", comp.pct == null ? "N/A" : comp.pct + "%")}
        ${bar("Company", rating.pct, "company", rating.pct == null ? "N/A" : (j.isStaffingAgency ? rating.pct + "%*" : rating.pct + "%"))}
      </div>
      <div class="meta"><span>${esc(compNote)}</span><span>${ratingHtml}</span></div>
      ${j.reach ? `<div class="reachwarn">&#9888; <b>REACH</b> — score overstates real odds: ${esc(j.reachNote || "")}</div>` : ""}
    </div>
  </div>`;
}

const w = data.weights;

// Join application status from applications.json (keyed by jobId), then sink jobs
// in a CLOSED (terminal) state to the bottom of the page.
const statusById = {};
try {
  const apps = JSON.parse(readFileSync(join(ROOT, "applications.json"), "utf8"));
  if (Array.isArray(apps)) for (const a of apps) statusById[String(a.id)] = String(a.status || "");
} catch { /* tracker may not exist yet */ }

const CLOSED = new Set(["rejected", "withdrawn", "declined", "skipped", "closed"]);
const jobs = data.jobs.map((j) => {
  const status = statusById[String(j.jobId)] || "";
  return { ...j, status, closed: CLOSED.has(status.toLowerCase()) };
});
const active = jobs.filter((j) => !j.closed);
const closedJobs = jobs.filter((j) => j.closed);
active.forEach((j, i) => { j.displayRank = i + 1; }); // re-medal active pipeline 1..N

const cards =
  `<div class="section">Active pipeline (${active.length})</div>\n` +
  (active.length ? active.map(card).join("\n") : `<div class="empty">No active applications.</div>`) +
  (closedJobs.length
    ? `\n<div class="section closed-h">Closed (${closedJobs.length}) &middot; rejected / withdrawn / skipped</div>\n` +
      closedJobs.map(card).join("\n")
    : "");

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Job Pipeline - Score Dashboard</title>
<style>
:root{ --navy:#15365c; --navy2:#36608f; --ink:#2a3540; --muted:#737f8b; --line:#e3e8ee;
  --hi:#2f8f6b; --mid:#c98a2b; --lo:#c0492b; --bg:#f4f7fb; }
*{ box-sizing:border-box; }
body{ margin:0; background:var(--bg); color:var(--ink);
  font-family:"Segoe UI","Calibri",Arial,sans-serif; font-size:14px; line-height:1.45; }
.wrap{ max-width:840px; margin:0 auto; padding:28px 22px 40px; }
h1{ margin:0; color:var(--navy); font-size:22px; letter-spacing:.2px; }
.sub{ color:var(--muted); font-size:12.5px; margin:4px 0 20px; }
.card{ display:flex; gap:14px; background:#fff; border:1px solid var(--line);
  border-left:6px solid var(--muted); border-radius:10px; padding:14px 16px; margin:12px 0;
  box-shadow:0 1px 3px rgba(20,40,70,.05); }
.card.hi{ border-left-color:var(--hi); } .card.mid{ border-left-color:var(--mid); }
.card.lo{ border-left-color:var(--lo); } .card.na{ border-left-color:var(--muted); }
.rank{ font-size:26px; width:40px; text-align:center; flex:0 0 40px; }
.body{ flex:1 1 auto; min-width:0; }
.head{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.co{ font-weight:700; color:var(--navy); font-size:15.5px; }
.jid{ color:var(--muted); font-weight:400; font-size:12px; }
.role{ color:var(--muted); font-size:12.5px; margin-top:1px; }
.composite{ text-align:center; flex:0 0 auto; padding:2px 12px; border-radius:8px; color:#fff; min-width:64px; }
.composite.hi{ background:var(--hi);} .composite.mid{ background:var(--mid);} .composite.lo{ background:var(--lo);} .composite.na{ background:var(--muted);}
.composite .num{ font-size:22px; font-weight:800; line-height:1.1; }
.composite .cap{ font-size:9.5px; text-transform:uppercase; letter-spacing:.6px; opacity:.9; }
.scorebox{ display:flex; flex-direction:column; align-items:center; gap:4px; flex:0 0 auto; }
.conf{ font-size:10px; color:var(--muted); letter-spacing:.3px; }
.conf.low{ color:#9a6412; background:#fff3e0; border:1px solid #f0d9b5; border-radius:9px; padding:0 7px; }
.bars{ margin:12px 0 8px; }
.row{ display:flex; align-items:center; gap:10px; margin:5px 0; }
.lbl{ width:64px; flex:0 0 64px; color:var(--muted); font-size:12px; text-align:right; }
.track{ flex:1 1 auto; height:14px; background:#eef2f7; border-radius:7px; overflow:hidden; position:relative; }
.track.na{ background:repeating-linear-gradient(45deg,#eef2f7,#eef2f7 6px,#e3e8ee 6px,#e3e8ee 12px); }
.track.na span{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:9.5px; letter-spacing:1px; color:var(--muted); }
.fill{ height:100%; border-radius:7px; }
.fill.skill{ background:var(--navy); } .fill.comp{ background:var(--hi); } .fill.company{ background:var(--mid); }
.val{ width:52px; flex:0 0 52px; font-weight:700; font-size:12.5px; color:var(--ink); }
.meta{ display:flex; justify-content:space-between; gap:12px; color:var(--muted); font-size:11.5px;
  border-top:1px dashed var(--line); padding-top:7px; margin-top:6px; flex-wrap:wrap; }
.meta a{ color:var(--navy2); }
.badge{ font-size:10px; padding:1px 7px; border-radius:10px; vertical-align:middle; }
.badge.staff{ background:#fff3e0; color:#9a6412; border:1px solid #f0d9b5; }
.badge.reach{ background:#fdecea; color:#b02a1a; border:1px solid #f3c2bb; }
.badge.contract{ background:#e7f0fb; color:#2c5a8c; border:1px solid #c3d8f0; }
.status{ font-size:10px; padding:1px 8px; border-radius:10px; text-transform:capitalize; letter-spacing:.2px;
  background:#eef2f7; color:#5b6875; border:1px solid #dbe2ea; }
.status.applied{ background:#e7f0fb; color:#2c5a8c; border-color:#c3d8f0; }
.status.screen{ background:#f3e9fb; color:#6b3a8c; border-color:#e0cdf0; }
.status.interview{ background:#fff3e0; color:#9a6412; border-color:#f0d9b5; }
.status.offer{ background:#e6f4ec; color:#1f7a4d; border-color:#c2e2d0; }
.status.rejected{ background:#fdecea; color:#b02a1a; border-color:#f3c2bb; }
.card.closed{ opacity:.6; }
.card.closed .composite{ filter:grayscale(.4); }
.section{ margin:24px 0 4px; color:var(--navy); font-size:12px; font-weight:700; text-transform:uppercase;
  letter-spacing:1px; border-bottom:1px solid var(--line); padding-bottom:6px; }
.section.closed-h{ color:var(--muted); margin-top:30px; }
.empty{ color:var(--muted); font-size:12.5px; padding:10px 2px; }
.reachwarn{ margin-top:8px; background:#fdecea; color:#8a2317; border:1px solid #f3c2bb; border-radius:6px; padding:6px 10px; font-size:11.5px; }
.reachwarn b{ color:#b02a1a; }
.foot{ color:var(--muted); font-size:11px; margin-top:18px; border-top:1px solid var(--line); padding-top:12px; }
.foot b{ color:var(--ink); }
</style></head><body>
<div class="wrap">
  <h1>Job Pipeline &mdash; Score Dashboard</h1>
  <div class="sub">Ranked by composite &nbsp;&middot;&nbsp; weights: skill ${w.skill} &middot; comp ${w.comp} &middot; company ${w.company} (renormalized over available dimensions) &nbsp;&middot;&nbsp; closed applications sink to the bottom</div>
  ${cards}
  <div class="foot">
    <b>How to read it:</b> Skill = matched required skills (professional 1.0, familiar 0.5).
    Comp = posted midpoint vs your target. Company = Glassdoor &divide; 5.<br>
    <b>Confidence (N/3 dims):</b> how many of the 3 dimensions backed the composite. A 3/3
    score is more trustworthy than a thin 1/3 (a 1/3 floats up only because nothing pulls it down).<br>
    <b>&#9888; REACH:</b> the score can't see level or interview bar. A reach role may score
    high on skill/comp/company yet have low real odds — treat its composite as inflated.<br>
    <b>Caveats:</b> comp% is base pay only; <b>*</b> staffing-agency ratings are low-signal
    (agency &ne; end-client workplace) but still count; company ratings are web-sourced &amp; unverified.<br>
    Generated from <code>rank.mjs --json</code>. Rebuild: <code>node scripts/dashboard.mjs</code>.
  </div>
</div>
</body></html>
`;

const outDir = join(ROOT, "dist");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "jobs-dashboard.html");
writeFileSync(outFile, html);
console.log(`Wrote ${jobs.length} jobs (${active.length} active, ${closedJobs.length} closed) -> dist/jobs-dashboard.html`);
