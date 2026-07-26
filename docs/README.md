# Person 3 — product, evaluation, and submission docs

Data consultant / PM deliverables for the two-hour build, per
[TASK_SPLIT_2_HOURS.md](../TASK_SPLIT_2_HOURS.md).

| Doc | Window | What it settles |
|---|---|---|
| [GOLDEN_PATH.md](GOLDEN_PATH.md) | T+0–20 | Persona, buyer, the ten demo beats, success criteria, language guardrails |
| [CUE_SHEET.md](CUE_SHEET.md) | T+20–45 | Approved copy for the two demo movements + a coverage audit of the whole library |
| [EVALUATION_MATRIX.md](EVALUATION_MATRIX.md) | T+45–65 | 13 pass/fail cases with a run log and a blocking rule |
| [DEFECT_LOG.md](DEFECT_LOG.md) | T+65–85 | Prioritized defects with owners and exact fixes; sit-to-stand vs lunge decision |
| [PITCH.md](PITCH.md) | T+85–105 | Five-minute script, judge Q&A, 75-second video shot list |
| [SUBMISSION.md](SUBMISSION.md) | T+105–120 | BuilderBase copy, architecture visual, screenshot list, final checklist |

---

## Three things the engineers should read first

**1 · The demo currently picks the wrong movement.** The plan says chair sit-to-stand; the
composer returns `lunge` for the lower-body request. One-word fix in `exercises.yaml`.
→ [DEFECT-1](DEFECT_LOG.md)

**2 · The Workspace view is unreachable.** The backend and its k-anonymity floor are intact,
but no nav links to the screen. The judging path and the go/no-go checklist both still require
it. Restore it or cut it — a checklist claiming a view nobody can open is worse than either.
→ [DEFECT-2](DEFECT_LOG.md)

**3 · One knee-safety cue is detected but not delivered.** `hip_hinge` emits `knee_valgus`
with no authored cue, so the user hears generic encouragement instead of the correction.
→ [DEFECT-3](DEFECT_LOG.md)

---

## Scope note

These are documentation only — no application source was touched, per the parallel-window
rule that Person 3 doesn't edit code. Every defect names the owner and the smallest fix
instead.

Findings come from static audit of `agent/`, `perception/`, `server/`, and `ui/` at the freeze,
plus composer and intake runs on this laptop. **Nothing camera-, model-, or audio-dependent is
verified** — those are the U1–U6 rows in the defect log and need the GB10.
