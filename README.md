# JobKit

A lightweight, **ToS-compliant** toolkit for running a job search faster: one canonical
resume that generates ATS-clean PDF/DOCX, a per-job tracker, a transparent job-ranking
engine, and a text-expander for repetitive application fields. **Multi-person** by design -
shared code, per-person data - so it can serve several job seekers from one codebase.

No auto-apply bots, no scraping. The leverage is in preparation (tailoring, ATS gap
analysis, canned answers, tracking); the kit stops at the "you click submit" line.

## Principles

- **Single source of truth.** Edit `resume.md`; everything downstream (`resume.html`, PDF,
  DOCX) is generated - no drift.
- **ATS-clean output.** Single column, no tables/columns/text boxes/images, and ASCII
  punctuation only (the build auto-sanitizes en/em-dashes, smart quotes, etc.).
- **Transparent ranking.** Jobs are scored on curated inputs with fixed formulas you can
  reproduce by hand - no NLP guessing.
- **Assist-only.** Nothing automates submitting applications.
- **Multi-person.** Data is per-person under `people/<slug>/`; code is shared in `scripts/`.

## Layout

```
people/
  <slug>/            per-person data (git-ignore your own; keep it private)
    resume.md          canonical resume (edit this)
    answers.md         vault of canned answers for application fields
    profile.json       ranking config (comp targets, weights, skills) + person facts
    applications.json  tracker (managed by jobkit.mjs)
    jobs/<id>-<slug>/  one folder per application (posting, ats-gap, score.json, notes)
    dist/              generated resume.pdf / resume.docx / jobs-dashboard.html
  _template/         skeleton - copy it to onboard a new person
scripts/             shared, zero-dependency Node ESM tools
```

By default the included `.gitignore` tracks only `people/_template` and ignores every real
person's folder, so personal data stays out of version control.

## Requirements

- **Node.js** (18+; zero npm dependencies).
- **PDF export:** headless Microsoft Edge or Chrome (auto-detected).
- **DOCX export:** headless LibreOffice (auto-detected).
- **Text expander (optional):** [Espanso](https://espanso.org).

## Every command needs a person

There is **no default person** - pass `--person <slug>` (or set `JOBKIT_PERSON`). A command
run without one errors out and lists available people.

```bash
# Onboard someone
cp -r people/_template people/<slug>      # then fill in resume.md, answers.md, profile.json

# Build the resume (md -> html -> PDF + DOCX)
node scripts/build.mjs --person <slug>
node scripts/build.mjs --person <slug> --html-only    # fast HTML-only pass

# Track applications
node scripts/jobkit.mjs --person <slug> add "Company" "Role" "LinkedIn" "<url>"
node scripts/jobkit.mjs --person <slug> scaffold <id>
node scripts/jobkit.mjs --person <slug> set <id> applied "submitted"
node scripts/jobkit.mjs --person <slug> list

# Rank jobs and render a dashboard
node scripts/rank.mjs --person <slug>                  # ranked table
node scripts/rank.mjs --person <slug> <id>             # one-job breakdown
node scripts/dashboard.mjs --person <slug>             # -> dist/jobs-dashboard.html

# Text-expander snippets from answers.md (Espanso is a single global config;
# whoever you sync LAST is the live person)
node scripts/sync-snippets.mjs --person <slug>

# Rebuild everything for a person at once
node scripts/refresh.mjs --person <slug>               # resume + snippets + dashboard
node scripts/refresh.mjs --person <slug> --no-espanso
```

## How ranking works

Each job gets a `score.json` (posted comp, curated required/preferred skills as lowercase
tokens, researched company rating). `rank.mjs` computes:

- **skill%** = matched required skills / required (professional = 1.0, familiar = 0.5)
- **comp%** = posted midpoint vs your target (N/A if unposted - never zeroed)
- **company%** = Glassdoor rating / 5
- **composite** = weighted average over the *available* dimensions (a missing dimension
  renormalizes rather than sinking the score)

Plus a confidence indicator (how many of the 3 dimensions backed the score) and a REACH
flag for roles where the real barrier is level/interview bar rather than skills.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/build.mjs` | `resume.md` -> `resume.html` -> PDF + DOCX. |
| `scripts/jobkit.mjs` | Application tracker over `applications.json`. |
| `scripts/rank.mjs` | Transparent job scoring; `--json` for machine output. |
| `scripts/dashboard.mjs` | Renders the visual score dashboard from `rank.mjs --json`. |
| `scripts/build-snippets.mjs` | `answers.md` -> Espanso text-expander config. |
| `scripts/sync-snippets.mjs` | Regenerate snippets + load into Espanso. |
| `scripts/refresh.mjs` | Rebuild all of a person's artifacts in one command. |
| `scripts/lib/paths.mjs` | Shared `--person` / `JOBKIT_PERSON` resolver. |

See `JOBKIT.md` for the full workflow and `CLAUDE.md` for the operating contract.

## License

[MIT](LICENSE).
