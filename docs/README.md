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

## Two things the engineers should read first

Re-audited against `b9643e6`. Both are still open and both are one-line fixes in
`agent/exercises.yaml`.

**1 · The demo picks the wrong movement.** The plan says chair sit-to-stand because it is
easier to frame; the composer returns `['figure_four', 'lunge', 'box_breath']` and never
selects `chair_squat`. Adding `sitting` to `chair_squat.targets` fixes it — verified locally.
→ [DEFECT-1](DEFECT_LOG.md)

**2 · One knee-safety cue is detected but not delivered.** `hip_hinge` emits `knee_valgus`
with no authored cue, so the user hears generic encouragement instead of the correction.
→ [DEFECT-3](DEFECT_LOG.md)

**Resolved:** the orphaned Workspace view. The team chose to remove B2B from the employee app
entirely, and narrowed the employer query so it can no longer return body areas or
Better/Same/Worse. That is a better answer than the nav entry I recommended, and the docs now
reflect it. → [DEFECT-2](DEFECT_LOG.md)

---

## Kept current with

- `2450d0a` wellness privacy consent and safety controls
- `b9643e6` camera controls and exercise-specific motion guides
- `ac4a7cd` guided frame with a per-move target and position gate — one `frame_check()` drives
  the outline, the indicator, and the cue, so evaluation cases C4–C6 now also test that those
  three agree
- `PRIVACY_AND_SAFETY.md` — now the authority on the employer boundary and the regulatory
  posture; the docs here defer to it rather than restating it

The consent architecture changed the golden path (a new beat 0, and camera consent is now
per-session) and added four evaluation cases, C15–C18. The employer boundary moved case C13
from the UI to `curl`, and added C14 — the check that the employer payload carries no
sensitive fields. C14 and C15 are blocking.

---

## Scope note

Documentation only — no application source touched, per the parallel-window rule that Person 3
doesn't edit code. Every defect names the owner, the file, and the smallest fix instead.

Findings come from static audit of `agent/`, `perception/`, `server/`, and `ui/`, plus composer
and intake runs on this laptop. **Nothing camera-, model-, or audio-dependent is verified** —
those are the U1–U6 rows in the defect log and need the GB10.
