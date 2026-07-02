# CLAUDE.md - Resume & Job Application Kit

A multi-person resume + job-search toolkit (shared code, per-person data). Full workflow
and rationale live in **`JOBKIT.md`** (read it for anything non-obvious). This file is the
short operating contract.

## Multi-person (IMPORTANT - read first)

- **Data is per-person under `people/<slug>/`; code is shared in `scripts/`.** Each person
  has `people/<slug>/{resume.md, answers.md, applications.json, jobs/, dist/, profile.json}`.
- **Every script REQUIRES an explicit person.** Pass `--person <slug>` (or set
  `JOBKIT_PERSON`). **There is NO default** - a script run with no person errors out and
  lists available people. Always include `--person <slug>` in every command you run.
- **`profile.json` is that person's data file:** ranking config (comp targets, weights,
  `skillsProfessional` / `skillsFamiliar`) PLUS their facts (`person.titleMappings`,
  `person.targetRoles`, differentiators). When working a job for someone, READ their
  `people/<slug>/profile.json` for person-specific rules - this contract stays generic.
- **Espanso is a single global config; whoever you `sync-snippets --person <slug>` LAST is
  the live person** in the text-expander. Re-sync to switch.
- Onboard a new person by copying `people/_template` to `people/<slug>` and filling it in.
- To see who's currently onboarded, run any script with no `--person` (it lists them).

## Hard rules

1. **`people/<slug>/resume.md` is the SINGLE source of truth** for that person's resume.
   Edit only it for resume content. Never hand-edit the generated `resume.html` or `dist/*`.
2. **Rebuild after editing a resume:** `node scripts/build.mjs --person <slug>` (md -> html
   -> PDF + DOCX in the person's `dist/`). Use `--html-only` for a fast HTML-only pass.
   Per-job: `node scripts/build.mjs --person <slug> <input.md> <outDir>`.
3. **ASCII punctuation only.** No en/em-dashes, smart quotes, middots, arrows, ellipses -
   they break some ATS parsers. Use `-`, `'`, `"`, `|`, `->`. The build auto-sanitizes
   output, but keep `resume.md` and `answers.md` ASCII too (they get pasted into forms).
   Verify (from the person dir): `python -c "import io;print([hex(ord(c)) for c in set(io.open('resume.md',encoding='utf-8').read()) if ord(c)>127] or 'ASCII')"`
4. **Keep exports ATS-clean:** single column, no tables/columns/text boxes/images.
5. **Assist-only. No auto-apply / scraping** (LinkedIn ToS). The kit stops at "you click
   submit." Don't build or suggest automation that submits applications.
6. **Never invent resume facts** to pass ATS keywords. Tailor emphasis and wording only.

## Files

Per-person data lives under `people/<slug>/`; scripts are shared and take `--person <slug>`.

- `people/<slug>/resume.md` - canonical resume (edit this) -> `resume.html` -> `dist/resume.pdf` + `dist/resume.docx`
- `people/<slug>/answers.md` - vault of canned answers for repetitive application fields. In a
  value, text after ` // ` is a private note (stripped from text-expander output).
- `people/<slug>/profile.json` - ranking config (comp targets, weights, skill lists
  professional/familiar) AND person facts (`person.titleMappings`, `person.targetRoles`).
- `people/<slug>/applications.json` - tracker data (JSON array of records; managed by
  `jobkit.mjs`, never hand-edit IDs). `people/<slug>/jobs/<id>-<slug>/` -
  per-application folders (posting, ats-gap, tailored resume, notes, `score.json`).
- `people/_template/` - skeleton to copy when onboarding a new person.
- `scripts/lib/paths.mjs` - shared `resolvePerson()` (the `--person` / `JOBKIT_PERSON` resolver).
- `scripts/refresh.mjs` - one command to rebuild ALL of a person's artifacts (resume + snippets + dashboard). `--no-espanso` skips Espanso restart.
- `scripts/build.mjs` - resume generator (md -> html -> pdf/docx).
- `scripts/build-snippets.mjs` - `answers.md` -> Espanso text-expander config (`dist/espanso/jobkit.yml`).
- `scripts/sync-snippets.mjs` - regenerate snippets + copy into Espanso + restart (run after editing `answers.md`). Espanso config lives at `%APPDATA%/espanso`. Global: last `--person` synced wins.
- `scripts/jobkit.mjs` - application tracker.
- `scripts/rank.mjs` - rank jobs by skill%/comp%/company (transparent scoring; `--json` for machine output). Reads the person's `profile.json`.
- `scripts/dashboard.mjs` - render `dist/jobs-dashboard.html` visual dashboard from `rank.mjs --json`.
- `JOBKIT.md` - authoritative workflow guide.

## Per-job workflow (see JOBKIT.md for detail)

All commands below take `--person <slug>`. Substitute the person you're working with.

**Fit assessment ("should I pursue it?") — score it first, don't eyeball.** When the user
asks whether to pursue a posting, scaffold the job (`add` + `scaffold`), write its
`score.json`, and run `node scripts/rank.mjs --person <slug> <id>` so the computed
skill/comp/company score BACKS the pursue/skip recommendation. Present the score alongside
the qualitative verdict. If the decision is skip:
`node scripts/jobkit.mjs --person <slug> set <id> skipped` (keeps the record; skipped jobs
stay out of active follow-up). For an elite/over-level role where skills match but the LEVEL
or interview bar is the real filter (e.g. Principal at a top-tier co), set `"reach": true` +
`"reachNote"` in score.json so the composite is visibly flagged as overstating odds (don't
let a high score read as high odds).

**Target-role fit (skip filters) - READ THE PERSON'S `profile.json`.** A person's target
roles, skip conditions, and differentiators live in `people/<slug>/profile.json` under
`person.targetRoles`. Apply THAT person's values, not a hardcoded set: their wanted
stacks/levels, their SKIP conditions (e.g. "core stack is wrong," "primary role is
off-target," "a must-have can't be truthfully claimed," or "an elite-bar reach unless they
opt in"), and the differentiators to weight UP. `person.titleMappings` may also record
employer-specific title differences (e.g. a role titled one way on the resume/LinkedIn but
another on formal applications, to match HR records) - honor them when filling fields.

Full flow: `node scripts/jobkit.mjs --person <slug> add "Company" "Role" <src> <url>` ->
`scaffold <id>` -> paste the posting into `people/<slug>/jobs/<id>-*/posting.txt` -> ATS gap
analysis -> create `jobs/<id>-*/score.json` (comp, curated required/preferred skills as
lowercase tokens matching the person's `profile.json`, company rating) ->
`rank.mjs --person <slug> <id>` to score -> tailor the resume -> build it -> user submits.
Track status with `jobkit.mjs --person <slug> set`.

**Submission filename (do this for every job):** the tailored resume the user submits must
be professionally named `<Person Name> - Resume - <Role>.pdf` / `.docx` - NOT
`tailored-resume` (that name looks unprofessional and signals tailoring to the recruiter).
So: rename the scaffolded `tailored-resume.md` to `<Person Name> - Resume - <Role>.md`
inside the job folder, then build it with
`node scripts/build.mjs --person <slug> "jobs/<id>-*/<Person Name> - Resume - <Role>.md" "jobs/<id>-*"`,
and remove any leftover `tailored-resume.*` outputs. `<Role>` = the posting's role title,
`<Person Name>` = the person's full name from their `profile.json`.

## Conventions

- Provide a checklist of what you're doing (per user's global preference).
- Don't commit/push unless explicitly asked.
- After changing a person's `resume.md`, rebuild (`--person <slug>`) and confirm outputs are ASCII + ATS-clean.
- Always pass `--person <slug>` - scripts have no default person and will error without it.

## Delegation (specializes the global "use subagents" rule for this workflow)

Delegate self-contained units to subagents by DEFAULT; reserve the main thread for
orchestration, presenting results, and interactive judgment. Concretely:
- **Delegate:** per-job score-first **reviews** (scaffold + score.json + rank), company-rating
  **research** (WebSearch), resume/dashboard **builds + verification**, and repetitive
  **mechanical edits** (e.g. same note across files). Give the subagent the posting, the
  `--person <slug>`, and point it at CLAUDE.md/JOBKIT.md/the person's profile.json + resume.md
  and an existing job folder as a template.
- **Keep in main thread:** deciding pursue/skip, tailoring/framing/truthfulness judgment calls
  that depend on conversation context, and anything needing the user's input.
