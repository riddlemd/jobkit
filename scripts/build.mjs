#!/usr/bin/env node
// build.mjs - generate resume.html from resume.md, then (optionally) the PDF + DOCX.
//
// resume.md is the SINGLE source of truth. You edit only that. This script renders
// it into the styled, ATS-clean resume.html, then exports dist/resume.pdf (headless
// Edge/Chrome) and dist/resume.docx (headless LibreOffice).
//
// Usage (--person <slug> REQUIRED, or set JOBKIT_PERSON):
//   node scripts/build.mjs --person <slug>              # resume.md -> resume.html + dist/{pdf,docx}
//   node scripts/build.mjs --person <slug> --html-only  # just regenerate the html
//   node scripts/build.mjs --person <slug> <input.md> <outDir>  # build any md (e.g. a tailored resume)
//       e.g. node scripts/build.mjs --person <slug> "jobs/1-acme/tailored-resume.md" jobs/1-acme
//
// No npm dependencies. The HTML template/CSS below is kept byte-for-byte in sync with
// the hand-tuned design; edit it here if you want to restyle.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolvePerson } from "./lib/paths.mjs";

// Person root (requires --person <slug> or JOBKIT_PERSON). `argv` is the CLI args
// with the --person flag already stripped out, so positional parsing is unchanged.
const { root: ROOT, rest: argv } = resolvePerson();

// ---- ATS sanitization: non-ASCII punctuation breaks some resume parsers ----
// Applied to all VISIBLE text (not URLs). en/em-dashes -> hyphen, smart quotes ->
// straight, ellipsis -> ..., non-breaking spaces -> space.
const sanitize = s => String(s)
  .replace(/[‐‑‒–—―]/g, "-")   // hyphen/figure/en/em/horizontal dashes
  .replace(/[‘’‚‛]/g, "'")               // single curly quotes
  .replace(/[“”„‟]/g, '"')              // double curly quotes
  .replace(/…/g, "...")                                 // ellipsis
  .replace(/[   ]/g, " ")                     // non-breaking / figure / narrow spaces
  .replace(/[•·‧]/g, "-")                     // bullet / middot / hyphenation point
  .replace(/[→⇒]/g, "->").replace(/[←⇐]/g, "<-");       // arrows

// ---- HTML escaping + inline markdown (bold, links) ----
const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const esc = s => escHtml(sanitize(s));        // visible text: sanitize + escape
const escAttr = s => escHtml(s).replace(/"/g, "&quot;");   // URLs: escape only, no sanitize
function inline(s) {
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let out = "", last = 0, m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    if (m[1] !== undefined) out += `<a href="${escAttr(m[2])}">${esc(m[1])}</a>`;
    else out += `<strong>${esc(m[3])}</strong>`;
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}

// ---- parse resume.md into { name, subtitle, sections:[{title, lines}] } ----
function parse(md) {
  const lines = md.split(/\r?\n/);
  const doc = { name: "", subtitle: "", sections: [] };
  let section = null, sawTitle = false;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    if (h1) { doc.name = h1[1].trim(); sawTitle = true; section = null; continue; }
    if (h2) { section = { title: h2[1].trim(), lines: [] }; doc.sections.push(section); continue; }
    if (sawTitle && !doc.subtitle && !section) {
      const b = line.trim().match(/^\*\*(.+)\*\*$/);
      if (b) { doc.subtitle = b[1].trim(); continue; }
    }
    if (section) section.lines.push(line);
  }
  return doc;
}

const paragraphs = ls => ls.join("\n").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

function renderContact(ls) {
  const items = [];
  for (const l of ls) {
    const m = l.match(/^-\s+\*\*([^:]+):\*\*\s*(.+)$/);
    if (m) items.push(inline(m[2].trim()));
  }
  return `<div class="contactbar">${items.join(' <span class="sep">|</span> ')}</div>`;
}

function renderComp(ls) {
  const para = paragraphs(ls)[0] || "";
  const parts = para.split(/\s*[·|]\s*/).map(s => s.trim()).filter(Boolean).map(esc);
  return `<p class="comp">${parts.join(" | ")}</p>`;
}

function renderExperience(ls) {
  const blocks = ls.join("\n").split(/^###\s+/m).map(s => s.trim()).filter(Boolean);
  let html = "";
  for (const b of blocks) {
    const bl = b.split(/\r?\n/);
    const head = bl.shift().trim();
    // split "Role <dash> Company" on the first spaced dash (em/en/hyphen)
    const hm = head.match(/^(.*?) [—–-] (.+)$/);
    const role = hm ? hm[1].trim() : head;
    const company = hm ? hm[2].trim() : "";
    let date = "";
    const bullets = [];
    for (const l of bl) {
      const t = l.trim();
      if (!t) continue;
      const dm = t.match(/^\*(.+)\*$/);
      if (dm && !date) { date = dm[1].trim(); continue; }
      const bm = t.match(/^-\s+(.+)$/);
      if (bm) bullets.push(bm[1].trim());
    }
    const who = `<div class="who"><span class="role">${esc(role)}</span>` +
      (company ? `<span class="sep"> | </span><span class="at">${esc(company)}</span>` : "") + `</div>`;
    const dateHtml = date ? `<span class="date">${esc(date)}</span>` : "";
    const lis = bullets.map(x => `<li>${inline(x)}</li>`).join("\n");
    html += `<div class="entry">\n<div class="jobhead">${who}${dateHtml}</div>\n<ul>\n${lis}\n</ul>\n</div>\n`;
  }
  return html.trimEnd();
}

function renderSkills(ls) {
  let rows = "";
  for (const l of ls) {
    const m = l.trim().match(/^\*\*([^*]+)\*\*\s*(.*)$/);
    if (m) rows += `<div class="srow"><span class="slabel">${esc(m[1].trim())}</span> ${inline(m[2].trim())}</div>\n`;
  }
  return `<div class="skills">\n${rows}</div>`;
}

function renderList(ls) {
  const items = [];
  for (const l of ls) {
    const m = l.trim().match(/^-\s+(.+)$/);
    if (m) items.push(`<li>${inline(m[1].trim())}</li>`);
  }
  return `<ul>\n${items.join("\n")}\n</ul>`;
}

function renderDefault(ls) {
  if (ls.some(l => /^\s*-\s+/.test(l))) return renderList(ls);
  return paragraphs(ls).map(p => `<p>${inline(p)}</p>`).join("\n");
}

const STYLE = `<style>
:root{ --navy:#15365c; --navy-soft:#36608f; --ink:#2a3540; --muted:#737f8b; --line:#e3e8ee; }
*{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@page{ size:Letter; margin:0.5in 0 0.45in; }
@page :first{ margin-top:0; }
html,body{ margin:0; padding:0; }
body{ font-family:"Segoe UI","Calibri",Arial,sans-serif; font-size:10.5pt; line-height:1.5; color:var(--ink); }

/* header - calmer, less poster-like */
.header{ background:var(--navy); color:#fff; padding:32px 60px 26px; }
.header h1{ margin:0; font-size:25pt; font-weight:700; letter-spacing:.2px; }
.header .subtitle{ margin-top:7px; font-size:10.5pt; font-weight:400; letter-spacing:.4px; color:#b7c5d8; }

.contactbar{ background:#f3f6fa; color:var(--navy); padding:11px 60px; font-size:9.5pt; letter-spacing:.2px; border-bottom:1px solid var(--line); }
.contactbar a{ color:var(--navy); text-decoration:none; }
.contactbar .sep{ color:#aebccd; margin:0 7px; }

.content{ padding:8px 60px 48px; }

/* sections - more air above, lighter rule */
h2{ font-size:10.5pt; font-weight:700; color:var(--navy); text-transform:uppercase; letter-spacing:1.2px;
    margin:20px 0 8px; padding-bottom:5px; border-bottom:1px solid var(--line); }
h2:first-of-type{ margin-top:14px; }

/* job entries read as discrete blocks; never split across a page */
.entry{ break-inside:avoid; page-break-inside:avoid; margin-top:14px; }
.entry:first-of-type{ margin-top:4px; }
.jobhead{ display:flex; justify-content:space-between; align-items:baseline; margin:0 0 5px; gap:16px; }
.who .role{ font-weight:700; font-size:11pt; color:var(--ink); }
.who .at{ font-weight:400; color:var(--navy-soft); }
.who .sep{ color:#9fb0c4; margin:0 5px; font-weight:400; }
.jobhead .date{ font-size:9pt; color:var(--muted); white-space:nowrap; }

p{ margin:7px 0; }
p.comp{ font-size:10pt; color:var(--ink); line-height:1.7; }

/* skills - single-line "Label: values" rows (ATS-safe, no column gutter) with zebra striping */
.skills{ margin-top:8px; border-radius:4px; overflow:hidden; }
.srow{ padding:7px 12px; line-height:1.45; padding-left:1.1em; text-indent:-1.1em; }
.srow:nth-child(even){ background:#f4f7fb; }
.slabel{ font-weight:700; color:var(--navy); letter-spacing:.2px; }

ul{ margin:4px 0 2px; padding-left:18px; }
li{ margin:0 0 4px; padding-left:3px; line-height:1.5; }
ul.sub{ margin:2px 0 4px 16px; }
ul.sub li{ list-style:circle; color:var(--muted); margin-bottom:3px; }

strong{ color:var(--navy); font-weight:700; }
a{ color:var(--navy-soft); }
</style>`;

function render(doc) {
  let contactBar = "";
  const parts = [];
  for (const sec of doc.sections) {
    const t = sec.title;
    if (/^contact$/i.test(t)) { contactBar = renderContact(sec.lines); continue; }
    let body;
    if (/^summary$/i.test(t)) body = paragraphs(sec.lines).map(p => `<p>${inline(p)}</p>`).join("\n");
    else if (/^core competencies$/i.test(t)) body = renderComp(sec.lines);
    else if (/work experience|experience/i.test(t)) body = renderExperience(sec.lines);
    else if (/^skills$/i.test(t)) body = renderSkills(sec.lines);
    else body = renderDefault(sec.lines);
    parts.push(`<h2>${esc(t)}</h2>\n${body}`);
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(doc.name)} - Resume</title>
${STYLE}</head><body>
<div class="header"><h1>${esc(doc.name)}</h1><div class="subtitle">${esc(doc.subtitle)}</div></div>
${contactBar}
<div class="content">
${parts.join("\n")}
</div></body></html>
`;
}

// ---- exports (best-effort; warn but don't fail the build) ----
const firstExisting = paths => paths.find(p => existsSync(p));

function exportPdf(htmlPath, outPdf) {
  const edge = firstExisting([
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]);
  if (!edge) { console.warn("  [pdf] no Edge/Chrome found - skipped"); return false; }
  execFileSync(edge, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
    `--user-data-dir=${join(tmpdir(), "resume-edge-pdf")}`,
    `--print-to-pdf=${outPdf}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ], { stdio: "ignore" });
  return true;
}

function exportDocx(htmlPath, outDir) {
  const soffice = firstExisting([
    "C:/Program Files/LibreOffice/program/soffice.exe",
    "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
  ]);
  if (!soffice) { console.warn("  [docx] no LibreOffice found - skipped"); return false; }
  // LibreOffice names the output <htmlBasename>.docx inside outDir.
  execFileSync(soffice, [
    "--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", outDir, htmlPath,
  ], { stdio: "ignore" });
  return true;
}

const rel = p => p.replace(ROOT + "\\", "").replace(ROOT + "/", "").replace(/\\/g, "/");

// ---- main ----
const htmlOnly = argv.includes("--html-only");
const positional = argv.filter(a => !a.startsWith("--"));

// Default: master resume.md -> resume.html (root) + dist/. Optional: <input.md> <outDir>.
const inputMd = positional[0] ? resolve(ROOT, positional[0]) : join(ROOT, "resume.md");
const outDir = positional[1] ? resolve(ROOT, positional[1]) : null;
const base = basename(inputMd, extname(inputMd));          // "resume" or "tailored-resume"
const htmlPath = outDir ? join(outDir, base + ".html") : join(ROOT, base + ".html");
const exportDir = outDir || join(ROOT, "dist");

if (outDir) mkdirSync(outDir, { recursive: true });
writeFileSync(htmlPath, render(parse(readFileSync(inputMd, "utf8"))));
console.log(`✓ ${rel(htmlPath)}  (from ${rel(inputMd)})`);

if (htmlOnly) {
  console.log("(--html-only: skipped PDF/DOCX)");
} else {
  mkdirSync(exportDir, { recursive: true });
  try { if (exportPdf(htmlPath, join(exportDir, base + ".pdf"))) console.log(`✓ ${rel(join(exportDir, base + ".pdf"))}`); }
  catch (e) { console.warn("  [pdf] failed:", e.message); }
  try { if (exportDocx(htmlPath, exportDir)) console.log(`✓ ${rel(join(exportDir, base + ".docx"))}`); }
  catch (e) { console.warn("  [docx] failed:", e.message); }
}
