# FlowReset Knowledge Base and Content Governance

FlowReset is a local-first workplace-wellness agent for desk workers aged 18 and
older. It turns a short check-in, recent reset history, and optional webcam
signals into a private, guided microbreak. All AI inference, retrieval, and
camera analysis run locally on the Dell Pro Max with GB10. No video, landmarks,
prompts, or health-adjacent employee data are sent to a cloud AI service.

This document defines the approved knowledge-base scope for the hackathon MVP
and the controls required before an employer deployment.

> **Product boundary:** FlowReset provides general workplace-wellness guidance.
> It does not diagnose, prevent, treat, or cure an injury, vision condition, or
> disease. Content requires review by a qualified occupational-health,
> ergonomics, physical-therapy, or optometry professional before production use.

## 1. Knowledge architecture

The system separates four types of information. They must not be combined into
one unrestricted vector index.

### 1.1 Deterministic safety policy

Safety rules run before retrieval or generation. The LLM may explain a rule but
may not override it.

- Stop a session for sharp or worsening pain, dizziness, numbness, weakness,
  chest pain, breathing difficulty, or loss of balance.
- If a user reports that a reset made them feel worse, stop related movements
  and show non-diagnostic escalation guidance.
- Never diagnose a condition or promise medical, vision, productivity, injury,
  or cost outcomes.
- Do not recommend movement for pregnancy, disability accommodations, recent
  injury or surgery, or a diagnosed condition in the MVP. These are Phase 2
  workflows requiring professionally reviewed adaptations.
- When camera confidence is below the evaluator threshold, do not score or
  correct form. Offer reframing, a guided timer, or camera-off mode.
- When the request is outside low-risk workplace wellness, provide a brief
  boundary statement and direct the user to an appropriate qualified
  professional.

### 1.2 Approved intervention library

Each movement is a structured, versioned record. Required fields:

```yaml
id: shoulder_rolls
title: Shoulder rolls
body_area: neck_shoulders
goal: interrupt_static_posture
duration_seconds: 20
position: seated
equipment: none
camera_mode: pose
detection: tempo
difficulty: gentle
instructions: []
camera_checks: []
stop_conditions: []
exclusions: []
source_ids: []
content_owner: flowreset
review_status: hackathon_general_wellness
version: 1
reviewed_at: 2026-07-26
review_due_at: 2026-10-26
```

The local agent must filter by approval status, body area, available time,
seated/standing preference, camera mode, and safety constraints before semantic
retrieval.

### 1.3 Reference and FAQ library

The locally indexed reference library should contain:

- workstation setup and neutral-position guidance;
- prolonged sitting and static-posture education;
- screen-rest habits and environmental adjustments;
- microbreak explanations;
- employee onboarding and privacy FAQs;
- camera troubleshooting;
- employer implementation and aggregate-analytics FAQs;
- product limitations and escalation language; and
- source summaries with provenance and review dates.

Preferred sources are authoritative public-health, occupational-safety,
ergonomics, and professional-association publications. Initial references:

- [OSHA Computer Workstations Checklist](https://www.osha.gov/etools/computer-workstations/checklists)
- [OSHA Computer Workstations: Hazards and Solutions](https://www.osha.gov/computer-workstations/hazards-solutions)
- [American Optometric Association: Computer Vision Syndrome](https://www.aoa.org/healthy-eyes/eye-and-vision-conditions/computer-vision-syndrome?sso=y)
- [FTC Mobile Health App Developers: Best Practices](https://www.ftc.gov/business-guidance/resources/mobile-health-app-developers-ftc-best-practices)

Search results, blogs, stock-video descriptions, and model-generated text are
not authoritative sources.

### 1.4 Private user memory and employer analytics

Employee history is stored separately from the shared content index.

- Employees control their camera, reminder, and history preferences.
- Raw frames are processed in memory and discarded immediately.
- Pose, hand, and face landmarks are discarded at the end of the session.
- Detailed personal reset history uses a rolling 90-day default.
- Employees may select no history, 30 days, 90 days, or one year.
- Employer dashboards never expose video, landmarks, discomfort answers,
  individual history, or individual trends.
- Employer analytics appear only for cohorts of at least 10 opted-in employees.
- Aggregate employer metrics have a default 12-month retention period.
- Operational and security logs have a default 30-day retention period.
- Account deletion removes active data promptly and backup copies within 30
  days.

These are product defaults based on data minimization, not universal legal
requirements. Production deployments require jurisdiction- and
contract-specific review.

## 2. Camera evaluation

Camera coaching is optional and available for all four FlowReset categories,
with category-specific capabilities and limitations.

| Category | Local signal | Permitted feedback | Limitation |
|---|---|---|---|
| Neck and shoulders | Pose landmarks, symmetry, range, tempo | visibility, pace, excessive trunk movement, completion | no diagnosis or structural-posture judgment |
| Back and hips | Trunk/hip angles, range, reps, framing | controlled pace, visible range, excessive lean | side or full-body framing may be required |
| Wrists and hands | Hand landmarks, wrist angle, hold time | visibility, neutral-range cue, side switch | hands must be close and unobstructed |
| Tired eyes | Face orientation and timer | confirm looking away and completing the interval | cannot diagnose eye strain or myopia, or reliably measure viewing distance |

Every evaluator returns:

```json
{
  "confidence": 0.92,
  "status": "ok",
  "observations": ["shoulders_visible", "tempo_controlled"],
  "permitted_cue": "Keep the movement slow and comfortable."
}
```

When confidence is low, the UI says:

> I cannot see the movement clearly. Reposition the camera, continue with the
> guided timer, or turn camera coaching off.

Avoid global "posture scores." The employee dashboard may instead show
completion, consistency, comfortable-difficulty feedback, and self-reported
response.

## 3. Agent workflow

The product must demonstrate an observe–reason–act–adapt–remember loop:

1. **Observe:** read the check-in, goals, time seated, history, preferences, and
   optional local camera signals.
2. **Safety gate:** apply deterministic exclusions and escalation rules.
3. **Filter:** select only approved interventions that match the constraints.
4. **Retrieve:** use NeMo Retriever with local LanceDB over approved English
   content.
5. **Reason:** use the local NeMo/OpenClaw agent to select and explain a reset.
6. **Act:** launch the routine and provide local camera or timer coaching.
7. **Adapt:** change duration, difficulty, modality, or movement in response to
   confidence and user feedback.
8. **Remember:** save the minimum allowed session result locally.

For the hackathon trace, show at least three tool calls:

```text
get_user_context
get_reset_history
apply_safety_policy
select_approved_routine
analyze_pose
record_session_result
```

Hard safety decisions are never delegated to retrieval. Retrieval results should
be reranked locally, restricted to approved records, and accompanied by source
metadata.

## 4. “Why this?” disclosure

The primary coaching screen stays concise. An expandable **Why this?** section
shows:

- the check-in, goal, history, or preference that influenced the choice;
- why the activity fits the user's available time and environment;
- what the camera is and is not evaluating;
- the source organization and link;
- the content version and last review date; and
- a short safety note.

Example:

> Recommended because you selected shoulder tightness, have been sitting for 72
> minutes, and requested a seated break under one minute. The camera checks
> movement pace and shoulder visibility; it does not diagnose an injury.

## 5. MVP content package

The six-hour MVP should include:

- 8 approved interventions across all four categories;
- 4 original demonstration clips, one per category;
- 4 camera participation modes;
- 10 ergonomics and screen-rest reference cards;
- 20 employee FAQs;
- 8 employer, privacy, and deployment FAQs;
- deterministic safety and escalation rules;
- 25 retrieval, safety, and camera evaluation scenarios; and
- a source and media-license manifest.

Recommended hero routines:

1. seated shoulder rolls;
2. seated thoracic rotation;
3. gentle wrist reset; and
4. distance-looking screen break.

The neck-and-shoulders path is the polished live demo. Other categories must
show working camera participation, but do not need the same detection depth.

## 6. Original demo-video guide

Record landscape video at 1080p/30 fps with even lighting and an uncluttered
background. Keep the evaluated joints visible. Record one clean and one
intentionally imperfect take for each physical movement.

Files:

```text
flowreset-shoulder-roll-v1.mp4
flowreset-thoracic-rotation-v1.mp4
flowreset-wrist-reset-v1.mp4
flowreset-screen-rest-v1.mp4
```

Include this notice in the interface or recording:

> This activity provides general workplace-wellness guidance for adults. Use a
> comfortable range and stop if you experience pain, dizziness, numbness,
> weakness, or difficulty breathing.

For externally sourced media, record the original URL, creator, retrieval date,
license URL and snapshot, permitted modifications, associated intervention,
checksum, and approval status. [Pexels](https://www.pexels.com/license/) allows
free use and modification subject to its license restrictions, but stock footage
must be treated as a visual asset—not evidence that an exercise is safe or
correct. Do not download or reuse videos without verified permission.

## 7. Product feedback loop

After a reset, ask:

- **How do you feel?** Better / Same / Worse
- **Was this manageable?** Too easy / About right / Too difficult

Adapt conservatively:

- better: keep the intervention eligible;
- same: vary the intervention next time;
- worse: stop related interventions and show the safety boundary;
- too difficult: shorten the duration or reduce the range; and
- low camera confidence: fall back to timer-only guidance.

## 8. Dashboard requirements

### Employee dashboard

- resets completed today and this week;
- weekly consistency;
- completion rate;
- category distribution;
- percentage of sessions reported as “better”;
- average break duration;
- preferred intervention; and
- private 90-day trend.

### Employer dashboard

Only aggregate opted-in cohorts of at least 10 employees:

- weekly activation and participation;
- completed resets;
- average active days;
- category-level usage; and
- aggregate self-reported response.

No employee ranking, individual adherence, health scoring, discomfort details,
or productivity surveillance.

## 9. Evaluation set

The test suite must cover:

- normal shoulder, back/hip, wrist, and screen-rest requests;
- camera denied, no person, multiple people, poor lighting, and poor framing;
- user requests a shorter, easier, seated, standing, or camera-off alternative;
- numbness, sharp pain, dizziness, weakness, or worsening symptoms;
- a request to diagnose or treat a medical condition;
- an exercise that made the user feel worse;
- a broad health question outside the approved scope;
- retrieval with a missing, outdated, or unapproved source; and
- verification that no runtime request reaches an external AI API.

Score each scenario for:

- safety-policy compliance;
- approved-content selection;
- relevance and source grounding;
- correct camera mode and confidence behavior;
- absence of unsupported medical claims;
- concise, usable coaching; and
- fully local inference.

## 10. Content governance

Every item has an owner, source, version, audience, risk level, approval status,
review date, review-due date, camera compatibility, limitations, and replacement
history.

Lifecycle:

```text
Draft → Safety review → Approved → Indexed locally → Evaluated → Published
      → Periodic review → Retired
```

For the hackathon, use `hackathon_general_wellness` as the visible approval
state. A production state must not be granted until an appropriately qualified
reviewer has approved the intervention and wording.

## 11. Success metrics

Employee product metrics:

- onboarding completion;
- camera opt-in;
- reset completion;
- repeat weekly use;
- percentage reporting “better”;
- comfortable-difficulty rate; and
- four-week retention.

Employer pilot metrics:

- eligible-to-activated conversion;
- weekly aggregate participation;
- privacy trust and satisfaction;
- voluntary retention; and
- aggregate self-reported comfort.

Do not claim reduced injuries, healthcare costs, absenteeism, or clinical
outcomes without appropriate evidence.

## 12. Demo proof

The live demonstration should show:

1. an adult desk worker reports shoulder discomfort;
2. the local agent reads context and history;
3. safety rules and approved-content filtering run;
4. the agent selects a sub-minute seated reset;
5. **Why this?** displays rationale, limitations, and source;
6. the user intentionally moves too quickly;
7. local camera analysis produces a corrective cue;
8. the user submits outcome feedback;
9. the private employee dashboard updates; and
10. the system shows the GB10 runtime and zero external AI calls.

The employer view should use a seeded fictional cohort of at least 10 people and
display only aggregate data.
