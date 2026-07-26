# FlowReset Feature and Demo Status

Updated July 26, 2026. This is the truthful scope of the
current unified application branch.

## Golden user flow

1. An adult desk worker completes or skips a 30-second preference setup.
2. They choose one body area or describe what they need in plain language.
3. They confirm available time and seated/standing constraints.
4. The local agent applies safety rules, reads private history, retrieves
   approved wellness guidance, and composes a routine from the approved
   exercise library.
5. The plan shows its duration, movements, video-AI checks, limitations,
   provenance, and an expandable **Why this reset?**
6. The user starts with local video AI or continues with timer and voice only.
7. MediaPipe evaluates body-pose routines. Qwen2.5-VL performs bounded local
   visibility/control checks for wrist and screen-rest routines.
8. The user reports Better, Same, or Worse.
9. The result is saved locally and changes future recommendations.
10. The private dashboard updates. Employers see only opted-in aggregates for
    cohorts of 10 or more.

## Implemented

| Capability | Status | Implementation |
|---|---|---|
| English onboarding and settings | Working | Goal, common areas, duration, local voice concern; standing is per session, tone/privacy stay in Settings |
| Simplified desktop information architecture | Working | Three primary destinations: Reset, Progress, Workspace; Settings is secondary |
| Per-session readiness guidance | Working | Space, camera choice, and comfort checks appear before every guided reset |
| Plain-language and card check-in | Working | Deterministic parsing plus local agent |
| Safety escalation | Working | Red-flag gate before routine selection |
| Approved exercise composition | Working | `agent/exercises.yaml`; model cannot invent executed movements |
| Grounded wellness knowledge | Working | `agent/knowledge.yaml` + local retrieval tool |
| Source visibility | Working | Expandable **Why this reset?** and Wellness Library |
| Neck/shoulder video AI | Working on GB10 | MediaPipe landmarks, pace, range, authored cues |
| Back/hip video AI | Working on GB10 | Pose framing, movement signals, authored cues |
| Leg/glute video AI | Working on GB10 | Full-body framing, reps, selected alignment rules |
| Wrist/hand video AI | MVP | Local Qwen2.5-VL visibility and controlled-movement check |
| Screen-rest video AI | MVP | Local Qwen2.5-VL visibility/participation check |
| Local voice input/output | Working when models installed | faster-whisper + Piper |
| Personal progress dashboard | Working | Completion, outcomes, patterns, recent sessions |
| Employer dashboard | Working | Aggregate-only query with 10-person floor |
| Shareable preview | Working | `ui/preview.html`, clearly labelled as synthetic |
| No external AI APIs | Enforced | Local endpoint assertion and verification script |

## Still missing or incomplete

1. **NeMo Retriever + LanceDB adapter.** The app now has a real approved local
   corpus and retrieval tool, but the MVP retriever is structured lookup. The
   next implementation step is indexing the same records in LanceDB and routing
   retrieval through NeMo Retriever without changing the UI contract.
2. **Dedicated hand-landmark model.** Wrist checks currently use the local VLM.
   MediaPipe Hands would provide more reliable wrist/hand landmarks and angles.
3. **Dedicated face/gaze model.** Screen-rest checks use a bounded local VLM
   check. The system does not measure viewing distance, visual acuity, myopia,
   or eye disease.
4. **Professional content approval.** Content is labelled
   `hackathon_general_wellness`. Qualified professional review is required
   before production.
5. **Original exercise videos.** Recording scripts are defined, but the four
   team-recorded demonstrations still need to be filmed, compressed, licensed,
   and added to an asset manifest.
6. **Automated evaluation suite.** Manual and structural checks exist; the
   planned 25-case safety/retrieval/camera regression set is not fully encoded.
7. **Production identity and access.** The hackathon build is single-user local.
   Employer SSO, tenant administration, audit controls, and deployment policy
   are future work.
8. **Formal 90-day deletion job.** The product policy and UI are defined, but a
   scheduled retention worker still needs to enforce automatic rolling deletion.
9. **Accessibility validation.** Semantic controls and keyboard focus are
   present; screen-reader, contrast, zoom, and reduced-motion QA still need a
   formal pass.
10. **Clinical/business outcome evidence.** Do not claim reduced injuries,
    absenteeism, healthcare spend, or myopia without an appropriate pilot.

## Demo dependencies

- Python 3.10+ event environment
- MediaPipe pose model in `models/pose_landmarker_heavy.task`
- local reasoning and vision models
- OpenClaw or NeMoClaw runtime
- Piper and faster-whisper assets if voice is shown
- MacBook camera connected through the SSH tunnel
- seeded demo data
- backup `ui/preview.html`
- passing `scripts/verify-local.sh` with the network disconnected
