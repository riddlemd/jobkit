# Job Application Kit

A lightweight, **ToS-compliant** system for applying to jobs faster. No auto-apply
bots, no scraping, nothing that risks your LinkedIn account. The leverage comes from
(1) a single canonical resume, (2) a few conventions, and (3) Claude doing the language
work — tailoring and ATS analysis. The only code is a tiny tracker and a build generator.

> **MULTI-PERSON (read first).** The kit now supports multiple people. **Data is
> per-person under `people/<slug>/`** (`resume.md`, `answers.md`, `applications.json`,
> `jobs/`, `dist/`, `profile.json`); **code is shared in `scripts/`**. **Every script
> requires an explicit `--person <slug>`** (or the `JOBKIT_PERSON` env var) - there is NO
> default person, and a script run without one errors out and lists who's available. So
> every command example below is really `node scripts/<x>.mjs --person <slug> ...`;
> mentally prepend the flag. Ranking config + person facts live in
> `people/<slug>/profile.json` (formerly `scripts/rank-profile.json`). Onboard someone by
> copying `people/_template` to `people/<slug>`.

## What's here

**Source — edit only these:**

| File / folder | Purpose |
|---|---|
| `resume.md` | **The single source of truth.** Edit this for all resume content. |
| `answers.md` | **Answers vault** — copy-paste for repetitive form fields. Fill the `<FILL IN>`s once. |

**Generated — never hand-edit; run the build (see [Building](#building-the-resume)):**

| File / folder | Purpose |
|---|---|
| `resume.html` | Styled, ATS-clean HTML. Generated from `resume.md`. |
| `dist/resume.pdf` | Submission-ready PDF. Generated from `resume.html`. |
| `dist/resume.docx` | Submission-ready Word doc, ATS-clean. Generated from `resume.html`. |

**Tooling:**

| File / folder | Purpose |
|---|---|
| `scripts/refresh.mjs` | **Refresh everything** — runs build + snippets(+Espanso) + dashboard in one go. `--no-espanso` skips the Espanso restart. |
| `scripts/build.mjs` | Generator: `resume.md` → `resume.html` → PDF + DOCX. Zero deps. |
| `scripts/build-snippets.mjs` | Generator: `answers.md` → Espanso text-expander config. Zero deps. |
| `scripts/sync-snippets.mjs` | Regenerate + copy into Espanso + restart (run after editing `answers.md`). |
| `scripts/jobkit.mjs` | Tracker CLI (Node, zero deps). |
| `scripts/rank.mjs` | Ranks jobs by skill% / comp% / company rating (transparent scoring over curated inputs). `--json` feeds the dashboard. |
| `scripts/dashboard.mjs` | Renders `dist/jobs-dashboard.html` — a styled visual dashboard from `rank.mjs --json`. |
| `people/<slug>/profile.json` | Comp targets, dimension weights, skill lists (professional / familiar), and person facts (target roles, title mappings). |
| `applications.json` | **Tracker** data — every lead/application (JSON array; `jobkit.mjs` manages it, don't hand-edit IDs). |
| `jobs/<id>-<slug>/` | One folder per application: posting, ATS gap, tailored resume, notes, `score.json`. |
| `jobs/<id>-<slug>/score.json` | Per-job scoring inputs (comp, required/preferred skills, company rating). Single home for the numbers. |

## Building the resume

`resume.md` is the **single source of truth** — edit only it. Everything downstream is
generated, so there's no drift:

```
resume.md  →  resume.html  →  dist/resume.pdf + dist/resume.docx
 (you edit)     (generated)        (generated)
```

```bash
node scripts/build.mjs              # regenerate html + pdf + docx
node scripts/build.mjs --html-only  # just the html (fast; skips PDF/DOCX)
```

**Or refresh everything at once** (resume + snippets + dashboard):

```bash
node scripts/refresh.mjs              # rebuild all global artifacts
node scripts/refresh.mjs --no-espanso # ...but skip the Espanso copy/restart
```

PDF uses headless Edge/Chrome; DOCX uses headless LibreOffice (both auto-detected, no
pandoc needed). Or just say *"rebuild the resume"* in Claude Code. After a build, the
DOCX is checked to stay ATS-clean (no tables/columns/text boxes).

## The workflow (per job)

1. **Log it**
   ```
   node scripts/jobkit.mjs add "Company" "Role" "LinkedIn" "<job url>"
   node scripts/jobkit.mjs scaffold <id>
   ```
   Creates `jobs/<id>-.../` with `posting.txt`, `ats-gap.md`, `tailored-resume.md`, `notes.md`.

2. **Drop the posting** — paste the full job description into `jobs/<id>-.../posting.txt`.

3. **ATS gap analysis** — in Claude Code, say:
   > "Do an ATS gap analysis for job #<id>."

   Claude compares the posting to `resume.md` and fills `ats-gap.md`: keywords matched,
   keywords missing, and **truthful** edits to close the gap (no inventing skills you
   don't have — ATS keyword stuffing with lies gets caught in interviews).

4. **Tailor** — say:
   > "Tailor my resume for job #<id>."

   Claude writes `tailored-resume.md` — reorders/emphasizes the bullets that match this
   posting, adjusts the Summary and Core Competencies line, surfaces relevant keywords.

5. **Export for submission** — say:
   > "Export job #<id>'s tailored resume to PDF and DOCX."

   Claude renders `tailored-resume.md` through the same styled, ATS-clean template and
   drops the PDF/DOCX in the job folder. (To rebuild your *base* resume instead, run
   `node scripts/build.mjs` — see [Building the resume](#building-the-resume).)

6. **Apply** — you submit on LinkedIn / the company site yourself. Use `answers.md` to
   fill the repetitive fields fast.

7. **Track status** — as things move:
   ```
   node scripts/jobkit.mjs set <id> applied "Easy Apply submitted"
   node scripts/jobkit.mjs set <id> screen "Recruiter call Thu 2pm"
   node scripts/jobkit.mjs set <id> interview
   node scripts/jobkit.mjs list                 # whole pipeline
   node scripts/jobkit.mjs list interview       # just one stage
   ```

## Tracker commands

```
node scripts/jobkit.mjs list [status]                     show pipeline (colored)
node scripts/jobkit.mjs add "Company" "Role" [src] [url]  add a lead
node scripts/jobkit.mjs scaffold <id>                      create the job folder
node scripts/jobkit.mjs set <id> <status> [note]          update status
node scripts/jobkit.mjs open <id>                          print the job folder path
```

**Statuses:** `lead → applied → screen → interview → offer` (plus `rejected`, `withdrawn`).
Free-form, but those get color in `list`.

## Regenerating exports

Just run the build — it does everything:

```bash
node scripts/build.mjs
```

The underlying tools (used automatically by the build; here for reference) are headless
**Edge** for PDF and headless **LibreOffice** for DOCX — no pandoc required. To verify a
DOCX stayed ATS-clean (zero is good):

```bash
unzip -oq dist/resume.docx -d /tmp/_d && grep -c '<w:tbl>\|<w:cols ' /tmp/_d/word/document.xml
```

## Autofilling web forms (text expander)

Repetitive *text* fields are filled with [Espanso](https://espanso.org) — a local,
private text expander. Type a trigger like `;email` in any field and it expands to your
value. The config is generated from `answers.md`, so the vault stays the single source.

**After editing `answers.md`, one command re-syncs everything** (regenerate, copy into
Espanso, restart):

```bash
node scripts/sync-snippets.mjs
```

(One-time setup: install Espanso, then run `sync-snippets` to place `jobkit.yml` in its
`match/` folder. `scripts/build-snippets.mjs` alone just regenerates the YAML without
touching Espanso.)

Triggers (prefix `;`): `;name ;email ;phone ;location ;linkedin ;github ;years ;auth
;sponsor ;relocate ;remote ;salary ;start ;comp ;gender ;race ;veteran ;disability ;edu
;pitch ;strength`.

- In `answers.md`, text after ` // ` is a private note and is stripped from expansions.
- **Dropdowns / radio buttons** (EEO, work-auth Yes/No, education level) can't be
  text-expanded — fill those by hand using the "what to pick" notes in `answers.md`.
- Avoid third-party "auto-apply" extensions: they upload your data and risk ToS/account.

## Ranking jobs

Score and compare jobs on skill fit, compensation, and company rating:

```bash
node scripts/rank.mjs         # ranked table (all jobs, composite DESC)
node scripts/rank.mjs <id>    # detailed breakdown for one job
node scripts/rank.mjs --json  # machine-readable scores (feeds the dashboard)
node scripts/dashboard.mjs    # -> dist/jobs-dashboard.html (styled visual, open in browser)
```

Transparent, reproducible scoring over **curated** inputs (no NLP guessing):
- `people/<slug>/profile.json` — comp targets, dimension weights, and skill lists
  (**professional** = full credit, **familiar** = half credit).
- `jobs/<id>/score.json` — per job: posted comp, required/preferred skills (lowercase
  tokens matching the profile vocab), and researched company rating. **Single home for a
  job's scoring numbers — don't duplicate them into `notes.md`.**

Formulas: skill% = matched required skills ÷ required (prof 1.0, familiar 0.5); comp% =
posted midpoint vs your target (**N/A if unposted — never zeroed**); company% = glassdoor ÷ 5;
composite = weighted avg over *available* dimensions (missing dims renormalize, never sink a job).
Caveats: comp% is **base-only**; staffing-agency ratings are **low-signal**; ratings are
**unverified** (web-search sourced). The computed skill% supersedes the holistic estimate in `ats-gap.md`.
**CONF (N/3 dims)** shows how many dimensions backed the composite — a 3/3 score is more
trustworthy than a thin 1/3 (which floats up only because nothing pulls it down).
**⚠ REACH** (`"reach": true` + `"reachNote"` in `score.json`) flags roles where the score
can't see the real barrier — e.g. Principal at a top-tier company: skills/comp/company may
match, but the level/interview bar is the true filter. Flagged red in the table + dashboard
so a high composite doesn't masquerade as high odds.

When adding a job, create its `score.json` alongside the ATS gap analysis so it can be ranked.

## ATS ground rules (so the resume actually parses)

- **Single column, no tables, no text boxes, no images, no headers/footers** for content.
  Your current exports already follow this — don't regress it with a fancy template.
- **Match the posting's vocabulary** when it's truthfully yours (e.g. if they say
  "RESTful APIs" and you wrote "REST API", use theirs).
- **Standard section headings** — Summary, Skills, Experience, Education, Certifications.
- **Spell out then abbreviate** the first time: "Continuous Integration/Continuous
  Delivery (CI/CD)" — ATS matches both forms.
- **ASCII punctuation only.** No en-dashes (`–`), em-dashes (`—`), smart quotes, or
  middots (`·`) — some ATS parsers garble them. Use `-`, `'`, `"`, `|`. The build
  (`scripts/build.mjs`) auto-converts these in all generated output, so you can't
  regress it even if you paste fancy punctuation into `resume.md`.
- **Never lie to beat keywords.** Tailor emphasis and wording, not facts.

## Why no auto-apply

LinkedIn's Terms of Service prohibit automated applying/scraping; they ban accounts that
do it. This kit deliberately stops at the "you click submit" line. All the time-savings
are in prep (tailoring, ATS, canned answers, tracking) — which is where the hours
actually go anyway.
