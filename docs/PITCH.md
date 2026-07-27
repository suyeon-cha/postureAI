# Pitch and demo video — T+85–105 deliverable

Owner: Person 3. Timed to the 30/30/30/10 rubric: local-first 30, business value 30,
demo + pitch 30, technical execution 10.

---

## Five-minute pitch

Four speakers. Rehearse to 4:45 so there's air. **Every claim below is one we can show.**

### [0:00–0:55] Person 1 — the problem and what FlowReset is

> "By four in the afternoon, most of us who work at a desk are stiff, sore, and not moving.
> And here's the thing — we all already know we should take breaks. Awareness was never the
> problem.
>
> The problem is the moment itself. A timer goes off and it doesn't know anything about you.
> A stretch library is twenty minutes of video for a ninety-second problem. And a posture
> camera watching you all day is something most people close within a week.
>
> FlowReset is a wellbeing agent that runs entirely on this Dell Pro Max with GB10. You tell
> it what feels uncomfortable and how long you have. It picks the smallest reset that fits,
> guides you through it, and learns what actually helped.
>
> And it never sends your body video anywhere — because it can't. There's no cloud in it."

### [0:55–2:15] Person 2 — live demo

Narrate what's on screen. Do not read this script aloud verbatim.

> "First time I open this, it asks before it collects anything." *(consent screen — don't
> rush past it; two seconds here earns the privacy claim later)*
>
> "I've been in meetings all morning and my legs are stiff. I'll just say that." *(voice
> intake — transcribed by Whisper on the box)*
>
> "Watch the trace on the right. The agent is reading my private history, checking the
> approved routine library, and composing a three-minute reset. Those are real tool calls
> against a local model — nothing is scripted.
>
> It tells me why *this* routine: my constraint, my time, my history.
>
> Now the camera. It asks separately, every session — accepting once doesn't accept forever.
> It was off until this click, and it goes off when I say so." *(enable camera)*
>
> "Pose inference is running on the GB10. It's counting my reps and watching my form." *(do
> one deliberately imperfect rep)* "There — one correction, spoken out loud. One at a time,
> never a stream of warnings.
>
> I finish, and I tell it: better." *(tap Better)* "That's saved locally, and my insights just
> updated. That one tap is what makes tomorrow's recommendation better than today's."

**If the camera misbehaves:** turn it off and say — *"Guidance is optional by design, so let
me show you the text path"* — and continue. Do not debug on stage.

### [2:15–3:25] Person 3 — architecture and why local is the product

> "Everything you just saw ran on this box. Let me be specific about what that means.
>
> We built the agent today on [NeMoClaw/OpenClaw]. It calls six tools: read context, read
> history, select an approved routine, analyze pose, generate a cue, record the result. Qwen
> is the reasoning and language layer. A separate pose model turns camera frames into joint
> angles.
>
> Two guardrails are worth your attention. First — the model can only *choose among* routines
> in our approved library. It cannot author an exercise. Second — it never writes a safety
> correction. Those are authored, keyed to the fault the geometry detected. The model decides
> whether and when to speak, never what the correction is.
>
> Qwen never sees a video frame. It gets structured metrics. Frames are analysed in memory and
> overwritten — our health endpoint reports frames stored, and it is always zero.
>
> Local isn't infrastructure trivia here, it's the product. This workflow handles body video,
> voice, and health-adjacent history. That's exactly the data that shouldn't leave a machine
> you control. It also means cues arrive while you're still moving, it works with no network,
> and a company can deploy it without routing employee video through a vendor.
>
> We can pull the network right now and run that again."

### [3:25–4:35] Person 4 — market and business

> "Today the options are a timer people ignore, a video library that needs effort, a posture
> monitor that feels like surveillance, or clinical MSK care. FlowReset takes the everyday
> moment none of them serve: a private reset in under three minutes.
>
> We start consumer-first with screen-heavy knowledge workers. Free gives you daily resets and
> local history; premium adds unlimited routines and deeper personalization.
>
> The expansion is workplace wellbeing, and privacy is what makes it sellable. Here's the part
> worth pointing at: the employee app has no team view at all. Not hidden — it doesn't exist.
> Employer reporting is a separate admin capability that gets participation counts above a
> ten-person floor, and it *cannot* return body areas or how someone said they felt, because
> those fields were removed from the query. That's the difference between a privacy policy and
> a privacy guarantee.
>
> We measure resets completed, the better/same/worse response, and seven-day repeat use. Our
> first real signal is forty percent of new users voluntarily completing three resets in their
> first week."

### [4:35–4:55] Person 1 — close

> "FlowReset isn't a timer, a chatbot, or a posture camera. It's a local agent that understands
> what you need, picks a safe action, and helps you get back to work feeling better.
>
> Fully local. Private by design. Powered by Dell and NVIDIA."

Leave the completion screen and the trace visible. Stop talking.

---

## Judge Q&A

**"What does always-on mean here?"** All inference runs locally and stays available with no
external AI service. Camera guidance is consent-based per session — we deliberately did not
build continuous monitoring.

**"Why do you need an LLM?"** It reasons across symptom, available time, physical constraint,
preference, and history to pick an approved action and explain it. Deterministic rules handle
everything safety-critical — the model never authors a correction.

**"How do we know there's no cloud call?"** Pull the network and watch it work. `verify-local.sh`
greps the tree for cloud hosts and SDKs. `agent/llm.py` refuses any non-loopback endpoint at
import — a cloud URL crashes the app rather than quietly working.

**"Is this medical?"** No. Movement breaks and broad form awareness. Red-flag symptoms —
numbness, weakness, chest pain, vision changes — skip the routine and point at a professional.

**"What if the pose model is wrong?"** Low confidence produces a framing message, not a form
judgment. Faults must persist before firing. And the words are authored, so a bad landmark
gives you the wrong cue from a safe set, never an invented one.

**"Why not just use the browser's speech API?"** It streams microphone audio to Google. That
would break the local-first rule and the privacy claim. We run Whisper on the box.

**"Can my manager see my data?"** No, and not because we chose not to show it — the employee
app has no team view, and the employer query cannot return body areas or Better/Same/Worse
responses. Those fields were removed. Employer reporting is admin-only, opt-in, and suppressed
below ten people. Individual wellness information must never enter a personnel record.

**"Is this HIPAA compliant?"** We don't claim that. `PRIVACY_AND_SAFETY.md` is explicit:
HIPAA applicability depends on the deployment, and processing locally doesn't create
compliance by itself. We've designed against the FDA general-wellness boundary, FTC health-app
guidance, Washington My Health My Data, and EEOC workplace-wellness principles, and we list
what a real employer pilot would still need.

**"What happens if I withdraw consent?"** Future collection is gated again and your existing
data stays until you separately choose to delete it. We don't silently delete your history as
a punishment for withdrawing, and we don't keep collecting after you've said stop.

---

## Backup video — 75 seconds

Record two takes with audible local voice. Screen recording plus system audio; no narration
over the top.

| Time | Beat | On screen |
|---|---|---|
| 0–6s | Desk worker stiff after meetings | Landing page |
| 6–12s | Consent before anything is collected | Consent gate, tick, accept |
| 12–20s | Speaks a three-minute lower-body concern | Mic active → transcript appears |
| 20–30s | Agent reads context, selects an approved plan | **Trace panel open** — tool calls landing live |
| 30–50s | Per-session camera consent, then one issue detected | Disclosure → overlay tracking, movement guide, cue banner, audible Piper cue |
| 50–60s | Completes, selects Better | Check-in → insights updating with the new row |
| 60–68s | Privacy proof | `/api/health`: runtime name, `frames_stored: 0`; then `curl /api/workspace` showing counts only |
| 68–75s | Local proof | Terminal with egress blocked, app still working |

**Non-negotiable in the recording:** the trace with real tool calls, one audible spoken cue,
the health endpoint, and the workspace payload. Those four are the whole differentiation —
the last one is what makes the B2B claim credible without a screen to show.

**Record it at T+160 even if the build is imperfect.** A working recording of a slightly rough
build beats a perfect build with no backup.
