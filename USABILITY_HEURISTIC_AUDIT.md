# FlowReset Nielsen Heuristic Audit

Evaluated July 26, 2026 against Jakob Nielsen's
[10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/).

Heuristics are evaluation principles rather than a binary certification. This
document records the FlowReset design evidence and the tests required to keep
each principle satisfied.

| # | Heuristic | FlowReset evidence | Verification |
|---|---|---|---|
| 1 | Visibility of system status | Local-AI health badge, preview warning, selected constraints summary, planning state, movement progress, camera readiness, local VLM status, save/delete/export feedback | Every consequential action produces immediate visible feedback |
| 2 | Match with the real world | Plain labels such as New reset, Seated only, Pause, Skip move, End, Better/Same/Worse; task order follows check-in → plan → activity → outcome | No internal model or detector terminology is required to complete a reset |
| 3 | User control and freedom | Back controls in onboarding; Change request before a session; cancellable planning; Pause, Skip move, End, and camera-off paths during a session | User can exit every multi-step flow without completing it |
| 4 | Consistency and standards | Shared button hierarchy, chips, cards, headings, status colors, expandable details, navigation and focus behavior | Primary/secondary/destructive actions retain the same styling and wording |
| 5 | Error prevention | Safe defaults, camera off until permission, approved-only exercise composer, deterministic safety gate, confirmation before history deletion, disabled navigation during an active session | High-cost errors are blocked before state changes |
| 6 | Recognition rather than recall | Visible body-area choices, selected-state checkmark, constraint summary, complete movement list, per-session readiness checklist, contextual Why this?, persistent navigation | Users do not need to remember onboarding selections or instructions |
| 7 | Flexibility and efficiency | Skip setup, cards or natural language, local voice input, duration and movement options, keyboard shortcut, camera or timer-only modes, saved preferences | Novice and repeat-user paths both reach a reset |
| 8 | Aesthetic and minimalist design | Three primary destinations—Reset, Progress, Workspace—plus secondary Settings; one primary action per stage; knowledge and help appear only in context | Primary flow avoids separate feature silos and hides governance detail until requested |
| 9 | Recognize, diagnose and recover from errors | Plain-language toast alerts, camera reframing instruction, local-AI timeout recovery, connection-loss notice, retry instructions, timer-only fallback | Errors state what happened and give a concrete next action |
| 10 | Help and documentation | A short readiness checklist before every session, contextual camera recovery, expandable Why this?, safety boundary, and privacy explanation | Guidance appears at the moment of need without adding a separate primary Help destination |

## Critical regression scenarios

1. Start onboarding, move forward, then use Back twice without losing the saved
   default selections.
2. Build a plan, cancel while it is composing, and verify that no plan or
   session opens when the delayed response arrives.
3. Disconnect the WebSocket and verify a plain-language connection message and
   local-AI status change.
4. Deny camera permission and complete a reset by timer.
5. Lose body framing during a full-body move and receive a specific reframing
   instruction.
6. End a session early and verify the outcome screen clearly labels it.
7. Attempt to delete history, cancel the confirmation, and verify no data is
   removed.
8. Expand **Why this reset?** and verify source, limitation, review state, and
   safety boundary are visible.
9. Complete first-run setup in two short steps, then verify that each generated
   plan repeats the space, camera, and comfort checks before the session starts.
10. Complete the entire flow with keyboard controls and visible focus.

## Remaining usability validation

- Run five moderated tests with desk workers unfamiliar with FlowReset.
- Test 200% browser zoom and screen-reader announcements.
- Validate contrast with an automated WCAG checker.
- Test slow GB10 inference and camera/model failure on the event hardware.
- Measure whether users understand that preview mode is synthetic.
