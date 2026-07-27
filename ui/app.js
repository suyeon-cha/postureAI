/* FlowReset UI.
 *
 * Renders `state` + `coach` messages from ws://<box>:8000/ws. Holds no product
 * logic of its own: which moves exist, which routine fits, and what to say all
 * come from the agent on the box. The browser captures, displays, and counts
 * down — it runs no inference.
 */

import { MockBackend } from "./mock.js";
import { SKELETON_EDGES, drawSkeleton, drawFrameGuide } from "./overlay.js";
import * as charts from "./charts.js";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SYMPTOM_CARDS = [
  { key: "neck_shoulders", glyph: "🫱", label: "Neck & shoulders", hint: "Tight traps, stiff neck" },
  { key: "back_hips", glyph: "🪑", label: "Back & hips", hint: "Been sitting too long" },
  { key: "legs_glutes", glyph: "🦵", label: "Legs & glutes", hint: "Sleepy from sitting, crossed legs" },
  { key: "wrists_hands", glyph: "⌨️", label: "Wrists & hands", hint: "Typing fatigue" },
  { key: "tired_eyes", glyph: "👁️", label: "Tired eyes", hint: "Screen strain, headache" },
];

const GOALS = [
  { key: "reduce_stiffness", label: "Reduce desk stiffness", hint: "Loosen up through the day" },
  { key: "break_consistency", label: "Build break consistency", hint: "Actually take the breaks" },
  { key: "screen_fatigue", label: "Reduce screen fatigue", hint: "Eyes and headaches" },
  { key: "daily_movement", label: "Move more each day", hint: "More total movement" },
];

const STYLES = [
  { key: "supportive", label: "Supportive", hint: "Warm, unhurried" },
  { key: "concise", label: "Concise", hint: "Just the plan" },
  { key: "energetic", label: "Energetic", hint: "Brisk and upbeat" },
];

/* The movement guide is deliberately deterministic, not generated advice.
   Each approved routine maps to an animation that shows the relevant direction
   of travel. The authored setup/during cues still come from /api/routines. */
const MOVE_MOTIONS = {
  neck_side_stretch: "neck-tilt",
  shoulder_rolls: "shoulder-roll",
  trap_stretch: "trap-stretch",
  chest_opener: "chest-open",
  y_raise: "y-raise",
  chin_tuck: "chin-tuck",
  seated_twist: "seated-twist",
  cat_cow: "cat-cow",
  thoracic_extension: "cat-cow",
  hip_flexor_reset: "lunge",
  standing_forward_fold: "forward-fold",
  hip_circles: "hip-circles",
  squat: "squat",
  calf_raise: "calf-raise",
  wrist_stretch: "wrist-stretch",
  wrist_prayer: "prayer",
  finger_fan: "finger-fan",
  eye_horizon: "distance-gaze",
  eye_palming: "palming",
  eye_figure_eight: "eye-eight",
  box_breath: "breathing",
  glute_squeeze: "glute-squeeze",
  figure_four: "figure-four",
  chair_squat: "squat",
  hip_hinge: "hip-hinge",
  lunge: "lunge",
};

function movementGuideMarkup(move) {
  const motion = MOVE_MOTIONS[move] || "breathing";
  const body = `
    <g class="guide-body">
      <circle class="guide-head" cx="140" cy="38" r="21"/>
      <g class="guide-upper">
        <path class="guide-torso" d="M140 60 L140 130"/>
        <path class="guide-shoulders" d="M103 76 L140 66 L177 76"/>
        <path class="guide-arm guide-arm-left" d="M103 76 L91 113 L84 149"/>
        <path class="guide-arm guide-arm-right" d="M177 76 L189 113 L196 149"/>
      </g>
      <g class="guide-lower">
        <path class="guide-hips" d="M116 130 L164 130"/>
        <path class="guide-leg guide-leg-left" d="M121 130 L112 169 L104 207"/>
        <path class="guide-leg guide-leg-right" d="M159 130 L168 169 L176 207"/>
      </g>
      <ellipse class="guide-breath" cx="140" cy="96" rx="24" ry="30"/>
      <circle class="guide-joint guide-shoulder-left" cx="103" cy="76" r="5"/>
      <circle class="guide-joint guide-shoulder-right" cx="177" cy="76" r="5"/>
      <circle class="guide-joint guide-hip-left" cx="121" cy="130" r="5"/>
      <circle class="guide-joint guide-hip-right" cx="159" cy="130" r="5"/>
    </g>`;

  const eyes = motion === "eye-eight" || motion === "distance-gaze"
    ? `<g class="guide-eye-demo">
        <path class="guide-eye-line" d="M48 104 Q140 34 232 104 Q140 174 48 104Z"/>
        <circle class="guide-pupil" cx="105" cy="104" r="10"/>
        ${motion === "eye-eight" ? `<path class="guide-eight" d="M84 104 C84 68 132 68 140 104 C148 140 196 140 196 104 C196 68 148 68 140 104 C132 140 84 140 84 104"/>` : ""}
      </g>`
    : "";

  const hands = motion === "palming"
    ? `<g class="guide-palms"><path d="M91 91 Q112 68 132 78 L132 136 Q108 143 91 119Z"/>
        <path d="M189 91 Q168 68 148 78 L148 136 Q172 143 189 119Z"/></g>`
    : "";

  const chair = ["seated-twist", "cat-cow", "glute-squeeze", "figure-four"].includes(motion)
    ? `<path class="guide-chair" d="M88 128 H192 M94 128 V206 M186 128 V206"/>`
    : "";

  return `<div class="movement-figure motion-${motion}" data-motion="${motion}">
    <svg viewBox="0 0 280 224" aria-hidden="true">
      ${eyes || `${chair}${body}${hands}`}
      <path class="guide-floor" d="M54 210 H226"/>
      <path class="guide-direction" d="M118 22 Q140 9 162 22"/>
    </svg>
  </div>`;
}

/* Preview mode can be requested deliberately — `?preview` in the URL, or the
   flag set by scripts/build-preview.py in the single-file bundle — instead of
   being inferred from a failed socket. Useful for sharing screens and for
   working on the UI with the box switched off. */
const FORCE_PREVIEW =
  new URLSearchParams(location.search).has("preview") || window.__FLOWRESET_PREVIEW === true;

const NAV = [
  { key: "home", label: "Reset" },
  { key: "dashboard", label: "My insights" },
  { key: "knowledge", label: "Learn" },
];
const CONSENT_VERSION = "2026-07-26-v1";

// ─────────────────────────────── state ───────────────────────────────

const S = {
  screen: "welcome",
  connected: false,
  preview: false,
  health: null,
  // Deep links from My insights into Learn, consumed once on arrival so the
  // user lands on the area or movement they clicked rather than the top of a
  // 26-item catalog.
  learnArea: null,
  learnMove: null,
  prefs: {
    goal: "reduce_stiffness",
    common_areas: ["neck_shoulders"],
    can_stand: true,
    preferred_duration_min: 3,
    coach_style: "supportive",
    // Quiet visual coaching is the standard experience. Users explicitly opt
    // into the conversational coach for local Piper playback and Whisper Q&A.
    voice: false,
    watch_mode: false,
  },
  // `touched` records which constraints the user actually set. Untouched chips
  // are defaults, not instructions, so they must not override what the user
  // typed — "I need to stay seated" has to beat a stale "Yes" on the chip.
  intake: { symptom: null, duration_min: 3, can_stand: true, intensity: "moderate", touched: {} },
  plan: null,
  why: [],
  coachText: "",
  cue: "",
  live: null, // latest `state.session`
  keypoints: [],
  framing: "no_person",
  frame: null,
  frameConfirmed: false,
  cameraOn: false,
  cameraError: null,
  planning: false,
  dashboard: null,
  knowledge: null,
  routines: null,
  trace: [],
  completed: false,
  response: null,
  insight: null,
  videoStatus: null,
  conversation: [],
  voiceState: "off",
  onboarded: localStorage.getItem("flowreset.onboarded") === "1",
  healthConsent:
    localStorage.getItem("flowreset.healthDataConsent") === "1" &&
    localStorage.getItem("flowreset.healthDataConsentVersion") === CONSENT_VERSION,
  healthConsentAt: localStorage.getItem("flowreset.healthDataConsentAt"),
  consentNext: "home",
  returnTo: null,
};

let socket = null;
let mock = null;
let videoStream = null;
let frameTimer = null;
let planningTimer = null;
let toastTimer = null;
let currentAudio = null;

// ─────────────────────────── transport ───────────────────────────

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  else if (mock) mock.send(msg);
}

async function boot() {
  renderNav();
  bindTrace();

  let opened = false;

  if (!FORCE_PREVIEW) {
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    try {
      socket = new WebSocket(wsUrl);
      await new Promise((resolve) => {
        const done = () => resolve();
        socket.addEventListener("open", () => { opened = true; done(); }, { once: true });
        socket.addEventListener("error", done, { once: true });
        socket.addEventListener("close", done, { once: true });
        setTimeout(done, 1200);
      });
    } catch {
      opened = false;
    }
  }

  if (opened) {
    S.connected = true;
    socket.addEventListener("message", (e) => handle(JSON.parse(e.data)));
    socket.addEventListener("close", () => {
      S.connected = false;
      renderBadge();
      showToast("Connection to the local AI was lost. Your camera is no longer sending frames.", "error");
    });
    const [health, prefs, dash, knowledge, routines] = await Promise.all([
      fetch("/api/health").then((r) => r.json()).catch(() => null),
      fetch("/api/prefs").then((r) => r.json()).catch(() => null),
      fetch("/api/dashboard").then((r) => r.json()).catch(() => null),
      fetch("/api/knowledge").then((r) => r.json()).catch(() => null),
      fetch("/api/routines").then((r) => r.json()).catch(() => null),
    ]);
    if (health) S.health = health;
    if (prefs) S.prefs = { ...S.prefs, ...prefs };
    if (dash) S.dashboard = dash;
    if (knowledge) S.knowledge = knowledge;
    if (routines) S.routines = routines;
  } else {
    socket = null;
    S.preview = true;
    mock = new MockBackend(handle);
    S.health = mock.health();
    S.dashboard = mock.dashboard();
    S.knowledge = mock.knowledge();
    S.routines = mock.routines();
  }

  S.intake.duration_min = S.prefs.preferred_duration_min;
  S.intake.can_stand = S.prefs.can_stand;
  S.screen = S.onboarded ? (S.healthConsent ? "home" : "consent") : "welcome";
  renderBadge();
  if (S.preview) showPreviewNotice();
  render();
}

function handle(msg) {
  switch (msg.type) {
    case "hello":
      S.health = msg.health;
      renderBadge();
      break;

    case "state":
      // Each move can need a different amount of you in frame, so the
      // position gate reopens whenever the routine advances.
      if (msg.session && msg.session.move_index !== S.live?.move_index) {
        S.frameConfirmed = false;
      }
      S.live = msg.session;
      S.keypoints = msg.keypoints || [];
      S.framing = msg.framing;
      S.frame = msg.frame || null;
      if (S.screen === "session") paintSession();
      break;

    case "coach":
      if (msg.plan) {
        if (!S.planning) break;
        clearPlanningTimer();
        S.plan = msg.plan;
        S.why = msg.why || [];
        S.coachText = msg.text;
        S.planning = false;
        S.screen = "plan";
        render();
      } else if (msg.insight !== undefined || msg.summary) {
        S.insight = msg.insight;
        S.coachText = msg.text;
        if (S.screen === "complete") render();
      } else if (msg.escalate) {
        clearPlanningTimer();
        S.planning = false;
        S.coachText = msg.text;
        S.screen = "escalate";
        render();
      } else {
        S.cue = msg.text;
        if (S.screen === "session") {
          if (msg.reply_to === "question" || S.voiceState === "thinking") {
            S.conversation.push({ role: "coach", text: msg.text });
            S.voiceState = S.prefs.voice ? "ready" : "off";
          }
          paintCue();
          paintVoiceCoach();
        }
      }
      break;

    case "error":
      clearPlanningTimer();
      S.planning = false;
      showToast(humanizeError(msg), "error");
      if (S.screen === "home") restorePlanControls();
      break;

    case "session_started":
      S.plan = msg.plan;
      S.cameraOn = msg.camera_on;
      S.screen = "session";
      render();
      break;

    case "routine_complete":
      finishSession(true);
      break;

    case "dashboard":
      S.dashboard = msg.data;
      break;

    case "camera":
      S.cameraOn = msg.on;
      break;

    case "trace":
      S.trace.push(msg.entry);
      appendTrace(msg.entry);
      break;

    case "audio":
      if (S.prefs.voice) {
        if (currentAudio) currentAudio.pause();
        currentAudio = new Audio(`data:audio/wav;base64,${msg.wav_b64}`);
        S.voiceState = "speaking";
        paintVoiceCoach();
        currentAudio.addEventListener("ended", () => {
          S.voiceState = S.prefs.voice ? "ready" : "off";
          paintVoiceCoach();
        }, { once: true });
        currentAudio.play().catch(() => {
          S.voiceState = "ready";
          paintVoiceCoach();
        });
      }
      break;

    case "video_ai":
      S.videoStatus = msg;
      if (S.screen === "session") {
        S.cue = msg.text;
        paintCue();
        paintVideoStatus();
        paintVoiceCoach();
      }
      break;
  }
}

function humanizeError(msg) {
  if (msg.where === "state_loop") {
    return "Video guidance paused because the local camera analyzer stopped responding. Continue by timer or restart the app.";
  }
  if (msg.where === "agent_loop") {
    return "The local coach could not complete that step. Try the reset again or continue without camera guidance.";
  }
  return "FlowReset could not complete that action. Please try again.";
}

function showToast(message, kind = "status") {
  const region = $("#toastRegion");
  if (!region) return;
  clearTimeout(toastTimer);
  region.innerHTML = "";
  const toast = el(`<div class="toast" data-kind="${esc(kind)}" role="${kind === "error" ? "alert" : "status"}">
    <span class="toast-icon" aria-hidden="true">${kind === "error" ? "!" : "✓"}</span>
    <span>${esc(message)}</span>
    <button class="ghost" type="button" aria-label="Dismiss message">✕</button>
  </div>`);
  $("button", toast).addEventListener("click", () => { region.innerHTML = ""; });
  region.append(toast);
  toastTimer = setTimeout(() => { region.innerHTML = ""; }, kind === "error" ? 9000 : 4500);
}

// ─────────────────────────── chrome ───────────────────────────

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  NAV.forEach((item) => {
    const b = el(`<button type="button">${item.label}</button>`);
    b.addEventListener("click", () => go(item.key));
    nav.append(b);
  });
  $("#brandHome").addEventListener("click", (e) => {
    e.preventDefault();
    if (S.screen === "session") return;
    go(S.onboarded ? (S.healthConsent ? "home" : "consent") : "welcome");
  });
  $("#settingsShortcut").addEventListener("click", () => {
    if (S.screen !== "session" && S.onboarded && S.healthConsent) go("settings");
  });
  $("#privacyShortcut").addEventListener("click", () => {
    S.returnTo = S.screen;
    go("privacy");
  });
  $("#safetyShortcut").addEventListener("click", () => {
    S.returnTo = S.screen;
    go("safety");
  });
  $("#termsShortcut").addEventListener("click", () => {
    S.returnTo = S.screen;
    go("terms");
  });
  markNav();
}

function markNav() {
  const open = S.onboarded && S.healthConsent ? NAV.map((n) => n.key) : [];
  const active = ["plan", "session", "complete", "escalate"].includes(S.screen) ? "home" : S.screen;
  [...$("#nav").children].forEach((b, i) => {
    const key = NAV[i].key;
    b.hidden = !open.includes(key);
    b.disabled = S.screen === "session";
    if (key === active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const settings = $("#settingsShortcut");
  settings.hidden = !S.onboarded || !S.healthConsent;
  settings.disabled = S.screen === "session";
  if (S.screen === "settings") settings.setAttribute("aria-current", "page");
  else settings.removeAttribute("aria-current");
}

function renderBadge() {
  const badge = $("#localBadge");
  const dot = $(".dot", badge);
  const text = $(".status-text", badge);
  const h = S.health;

  if (S.preview) {
    dot.dataset.state = "warn";
    text.textContent = "Preview — no box attached";
    badge.title =
      "The UI is running against a local stand-in so screens can be built and reviewed " +
      "without the GB10. No inference is happening. This mode is not part of the judging path.";
    return;
  }
  const llmOk = h?.llm?.reachable;
  const poseOk = h?.pose?.available;
  dot.dataset.state = llmOk && poseOk ? "ok" : llmOk || poseOk ? "warn" : "bad";
  text.textContent = llmOk && poseOk ? "All AI local on GB10 · No external AI API" : "Local AI partially up";
  badge.title = [
    `Language: ${h?.llm?.reason_model} @ ${h?.llm?.endpoint} — ${llmOk ? "up" : "down"}`,
    `Vision: ${h?.pose?.model} — ${poseOk ? "up" : h?.pose?.error || "down"}`,
    `Runtime: ${h?.runtime?.runtime}`,
    `Frames stored: ${h?.pose?.frames_stored ?? 0}`,
  ].join("\n");
}

/* Anyone can be handed a link to this. Say plainly that no model is running,
   so a preview is never mistaken for the local-inference claim we make on the
   box. The status badge alone is too easy to miss. */
function showPreviewNotice() {
  const strip = el(`<div class="preview-strip" role="status">
    <strong>Interactive preview.</strong> Sample data is active; camera, voice, and AI
    inference connect when this interface runs on the GB10.
  </div>`);
  document.querySelector(".topbar").after(strip);
}

function bindTrace() {
  const panel = $("#trace");
  const toggle = $("#traceToggle");
  const set = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => set(panel.hidden));
  $("#traceClose").addEventListener("click", () => set(false));
}

function appendTrace(entry) {
  const list = $("#traceList");
  const kind = entry.kind || "model";
  let body = "";
  if (kind === "tool") {
    body = `<code>${esc(entry.name)}(${esc(JSON.stringify(entry.arguments || {}).slice(1, -1))})</code>
            <code class="muted">→ ${esc(JSON.stringify(entry.result || {}).slice(0, 160))}</code>`;
  } else if (kind === "model") {
    const calls = (entry.tool_calls || []).filter(Boolean);
    body = `<code>${calls.length ? `wants: ${esc(calls.join(", "))}` : esc((entry.content || "").slice(0, 180))}</code>
            ${entry.latency_ms ? `<code class="muted">${entry.latency_ms}ms · ${esc(entry.model || "")}</code>` : ""}`;
  } else if (kind === "intake") {
    body = `<code>${esc(JSON.stringify(entry.parsed))}</code>`;
  } else {
    body = `<code>${esc(JSON.stringify(entry).slice(0, 200))}</code>`;
  }
  const item = el(`<li class="trace-item" data-kind="${esc(kind)}">
      <div class="hd"><span class="kind">${esc(kind)}</span><span class="ts">${esc(entry.at || "")}</span></div>
      <div class="stack-sm">${body}</div>
    </li>`);
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

function go(screen) {
  if (screen === "dashboard" && !S.dashboard) loadDashboard();
  if (screen === "knowledge" && !S.knowledge) loadKnowledge();
  S.screen = screen;
  render();
}

async function loadDashboard() {
  if (mock) { S.dashboard = mock.dashboard(); return; }
  S.dashboard = await fetch("/api/dashboard").then((r) => r.json()).catch(() => null);
}

async function loadKnowledge() {
  if (mock) {
    S.knowledge = mock.knowledge();
    if (!S.dashboard) S.dashboard = mock.dashboard();
    render();
    return;
  }
  // The library shows practice history per movement, which lives on the
  // dashboard payload — fetch it too if the user came straight here.
  const [kb] = await Promise.all([
    fetch("/api/knowledge").then((r) => r.json()).catch(() => null),
    S.dashboard ? Promise.resolve() : loadDashboard(),
  ]);
  S.knowledge = kb;
  render();
}

// ─────────────────────────── screens ───────────────────────────

function render() {
  const app = $("#app");
  app.innerHTML = "";
  // The landing page manages its own vertical rhythm with full-bleed bands.
  app.classList.toggle("bleed", S.screen === "welcome");
  markNav();
  const view = {
    welcome: viewWelcome,
    consent: viewConsent,
    goals: viewGoals,
    prefs: viewPrefs,
    home: viewHome,
    plan: viewPlan,
    session: viewSession,
    complete: viewComplete,
    escalate: viewEscalate,
    dashboard: viewDashboard,
    knowledge: viewKnowledge,
    settings: viewSettings,
    privacy: viewPrivacy,
    safety: viewSafety,
    terms: viewTerms,
    help: viewHelp,
  }[S.screen];
  app.append(view());
  // render() wipes #app, so every re-render destroys the <video> the camera
  // stream was bound to and builds an empty one. Several paths re-render mid
  // session (session_started echoing back from the box, screen changes), and
  // each one would otherwise leave a live stream orphaned behind a black
  // panel. Re-attaching here covers all of them; attachStream() no-ops when
  // there is no stream or no element.
  if (S.screen === "session") {
    attachStream();
    paintSession();
    paintCue();
    paintVoiceCoach();
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  app.focus({ preventScroll: true });
}

/* Fast first-run orientation. Deeper product detail stays contextual in the
   reset flow instead of turning the application into a marketing site. */
function viewWelcome() {
  const wrap = el(`<div>
    <section class="hero">
      <div class="stack">
        <span class="eyebrow">Private desk-wellness coach · local on GB10</span>
        <h1>Your next useful break starts here.</h1>
        <p class="lede">Tell FlowReset what needs attention and how much time you have.
          Get a short guided reset, optional camera feedback, and progress you can see.</p>
        <div class="row">
          <button class="btn" id="start">Set up in 30 seconds</button>
          <button class="btn secondary" id="skipOnboard">Start a reset now</button>
        </div>
        <p class="tiny muted">No account · Camera optional · Video never stored</p>
      </div>

      <div class="hero-art" aria-hidden="true">
        <div class="mock">
          <div class="mock-row"><span class="tag">Guided reset</span></div>
          <div class="mock-row">
            <span class="mock-ring"><i>0:45</i></span>
            <div class="stack-sm" style="flex:1">
              <div class="skel w70"></div><div class="skel w45"></div>
            </div>
          </div>
          <div class="skel w88"></div>
          <div class="skel w70"></div>
          <div class="mock-row"><span class="pill good">tempo: good</span>
            <span class="pill">reps: 4/8</span></div>
        </div>
      </div>
    </section>

    <section class="band sunk" style="border-radius:20px" hidden>
      <div class="section stack">
        <div class="stack-sm measure">
          <h2>The problem isn't awareness.</h2>
          <p class="muted">You already know you should take breaks. What you don't know, in the
            moment, is what the smallest useful thing to do is — and whether you're doing it right.</p>
        </div>
        <div class="grid cols-3">
          <div class="feature"><span class="ic">⏰</span><strong>Break timers don't know anything</strong>
            <p class="small muted">They fire on a schedule and get dismissed. They can't tell the
              difference between tight shoulders and tired eyes.</p></div>
          <div class="feature"><span class="ic">📺</span><strong>Stretch libraries need effort</strong>
            <p class="small muted">Twenty minutes of video for a ninety-second problem, and you
              still have to pick the right one yourself.</p></div>
          <div class="feature"><span class="ic">👁️</span><strong>Posture cameras feel like surveillance</strong>
            <p class="small muted">Continuous monitoring and a posture grade is exactly what makes
              people close the app. FlowReset is user-triggered.</p></div>
        </div>
      </div>
    </section>

    <section class="section stack">
      <div class="stack-sm measure">
        <h2>One clear workflow</h2>
        <p class="muted">Check in, follow one instruction at a time, then see what helps.</p>
      </div>
      <div class="grid cols-3 steps-flow">
        <div class="step"><strong>Quick check-in</strong>
          <p class="small muted">Choose an area, available time, and seated or standing.</p></div>
        <div class="step"><strong>Guided reset</strong>
          <p class="small muted">Review a safe setup, then follow the timer and one coaching cue.</p></div>
        <div class="step"><strong>Personal insights</strong>
          <p class="small muted">See your routine, what helps, and the area to focus on next.</p></div>
      </div>
      <div class="welcome-trust">
        <span>✓ All AI runs locally on the GB10</span>
        <span>✓ Camera is optional for every session</span>
        <span>✓ General wellness—not medical care</span>
      </div>
    </section>

    <section class="section" hidden>
      <div class="card cta-band">
        <div class="stack-sm">
          <h2>Ready when you are.</h2>
          <p class="muted">Takes about thirty seconds to set up.</p>
        </div>
        <div class="row">
          <button class="btn" id="start2">Start my first reset</button>
          <button class="btn subtle" id="skip2">Try without setup</button>
        </div>
      </div>
    </section>
  </div>`);

  $("#start", wrap).addEventListener("click", () => beginConsent("goals"));
  $("#start2", wrap).addEventListener("click", () => beginConsent("goals"));
  $("#skipOnboard", wrap).addEventListener("click", () => beginConsent("home"));
  $("#skip2", wrap).addEventListener("click", () => beginConsent("home"));
  return wrap;
}

function beginConsent(next) {
  if (S.healthConsent) {
    if (next === "home") finishOnboarding();
    else go(next);
    return;
  }
  S.consentNext = next;
  go("consent");
}

function viewConsent() {
  const wrap = el(`<div class="trust-page stack">
    <div class="stack-sm measure">
      <span class="eyebrow">Required before first use</span>
      <h1>Your wellness data stays under your control</h1>
      <p class="hero-lede">FlowReset needs a small amount of health-adjacent information
        to build a reset and remember what helped. Review the purpose before agreeing.</p>
    </div>

    <section class="card stack">
      <h2>What this prototype collects</h2>
      <div class="consent-grid">
        <div><strong>Your input</strong><span>Selected body area, optional concerns,
          goals, movement preferences, and session feedback.</span></div>
        <div><strong>Session activity</strong><span>Routine, duration, completion,
          and your Better / Same / Worse response.</span></div>
        <div><strong>Optional camera</strong><span>Frames are processed in memory on
          the GB10 only after separate per-session consent; video is not stored.</span></div>
        <div><strong>Purpose</strong><span>Build general-wellness resets,
          personalize future suggestions, and show your private insights.</span></div>
      </div>
      <div class="notice small"><strong>No sale, advertising, or individual employer access.</strong>
        No external AI API receives this data, and this employee app has no employer
        dashboard or workplace-sharing control.</div>
      <label class="consent-check">
        <input type="checkbox" id="healthConsent">
        <span><strong>I am 18 or older and agree to this local collection and use.</strong>
          <small>I can export or delete my data and withdraw future consent at any time.</small></span>
      </label>
      <div class="row">
        <button class="btn" id="acceptConsent" disabled>Agree and continue</button>
        <button class="btn secondary" id="declineConsent">Not now</button>
        <button class="btn subtle" id="readPrivacy">Read the full privacy notice</button>
      </div>
    </section>

    <p class="tiny muted">FlowReset is a hackathon general-wellness prototype, not medical
      care or a medical device. This notice describes current behavior; it is not a claim
      of HIPAA certification or production legal compliance.</p>
  </div>`);
  const check = $("#healthConsent", wrap);
  const accept = $("#acceptConsent", wrap);
  check.addEventListener("change", () => { accept.disabled = !check.checked; });
  accept.addEventListener("click", () => {
    S.healthConsent = true;
    S.healthConsentAt = new Date().toISOString();
    localStorage.setItem("flowreset.healthDataConsent", "1");
    localStorage.setItem("flowreset.healthDataConsentVersion", CONSENT_VERSION);
    localStorage.setItem("flowreset.healthDataConsentAt", S.healthConsentAt);
    if (S.consentNext === "goals") go("goals");
    else finishOnboarding();
  });
  $("#declineConsent", wrap).addEventListener("click", () => {
    S.healthConsent = false;
    S.healthConsentAt = null;
    localStorage.removeItem("flowreset.healthDataConsent");
    localStorage.removeItem("flowreset.healthDataConsentVersion");
    localStorage.removeItem("flowreset.healthDataConsentAt");
    S.onboarded = false;
    localStorage.removeItem("flowreset.onboarded");
    go("welcome");
  });
  $("#readPrivacy", wrap).addEventListener("click", () => {
    S.returnTo = "consent";
    go("privacy");
  });
  return wrap;
}

function viewGoals() {
  const wrap = el(`<div class="stack">
    <div class="stack-sm"><span class="eyebrow">Step 1 of 2</span>
      <h1>What would you like out of this?</h1>
      <p class="muted">This shapes what FlowReset offers first. You can change it later.</p></div>
    <div class="grid option-grid" id="goals"></div>
    <div class="row">
      <button class="btn secondary" id="back">Back</button>
      <button class="btn" id="next">Continue</button>
    </div>
  </div>`);
  GOALS.forEach((g) => {
    const b = el(`<button class="option" type="button" aria-pressed="${S.prefs.goal === g.key}">
      <strong>${esc(g.label)}</strong><span class="small muted">${esc(g.hint)}</span></button>`);
    b.addEventListener("click", () => {
      S.prefs.goal = g.key;
      [...$("#goals", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
    });
    $("#goals", wrap).append(b);
  });
  $("#back", wrap).addEventListener("click", () => go("welcome"));
  $("#next", wrap).addEventListener("click", () => go("prefs"));
  return wrap;
}

function viewPrefs() {
  const wrap = el(`<div class="stack">
    <div class="stack-sm"><span class="eyebrow">Step 2 of 2</span>
      <h1>A few preferences</h1>
      <p class="muted">All of this stays on this machine.</p></div>

    <div class="card stack">
      <div class="stack-sm"><h3>Where do you usually feel it?</h3>
        <div class="row" id="areas"></div></div>
      <div class="stack-sm"><h3>Preferred session length</h3>
        <div class="row" id="dur"></div>
        <p class="tiny muted">One minute between meetings, ten at the end of the day —
          the agent scales the routine to whatever you pick.</p></div>

      <div class="stack-sm">
        <h3>Anything else you'd like FlowReset to know?</h3>
        <p class="small muted">Old injuries, a knee that doesn't like lunges, what your day
          usually looks like. Optional — and it stays on this machine.</p>
        <textarea id="concerns" rows="3" placeholder="I sit cross-legged most of the day and my glutes feel dead by 3pm. Left knee is a bit cranky."></textarea>
        <div class="row">
          <button class="btn secondary" id="mic" type="button" aria-pressed="false">🎤 Speak instead</button>
          <span class="small muted" id="micStatus"></span>
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn secondary" id="back">Back</button>
      <button class="btn" id="done">Start using FlowReset</button>
    </div>
  </div>`);

  SYMPTOM_CARDS.forEach((s) => {
    const on = S.prefs.common_areas.includes(s.key);
    const b = el(`<button class="chip" type="button" aria-pressed="${on}">${esc(s.label)}</button>`);
    b.addEventListener("click", () => {
      const i = S.prefs.common_areas.indexOf(s.key);
      if (i >= 0) S.prefs.common_areas.splice(i, 1);
      else S.prefs.common_areas.push(s.key);
      b.setAttribute("aria-pressed", String(S.prefs.common_areas.includes(s.key)));
    });
    $("#areas", wrap).append(b);
  });

  [1, 2, 3, 5, 10].forEach((m) => {
    const b = el(`<button class="chip" type="button" aria-pressed="${S.prefs.preferred_duration_min === m}">${m} min</button>`);
    b.addEventListener("click", () => {
      S.prefs.preferred_duration_min = m;
      [...$("#dur", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
    });
    $("#dur", wrap).append(b);
  });

  bindMic($("#mic", wrap), $("#concerns", wrap), $("#micStatus", wrap));

  $("#back", wrap).addEventListener("click", () => go("goals"));
  $("#done", wrap).addEventListener("click", () => {
    S.prefs.concerns = $("#concerns", wrap).value.trim();
    finishOnboarding();
  });
  return wrap;
}

function finishOnboarding() {
  S.onboarded = true;
  localStorage.setItem("flowreset.onboarded", "1");
  S.intake.duration_min = S.prefs.preferred_duration_min;
  S.intake.can_stand = S.prefs.can_stand;
  savePrefs();
  go("home");
}

function savePrefs() {
  if (mock) {
    Object.assign(mock.prefs, S.prefs);
    return Promise.resolve(S.prefs);
  }
  return fetch("/api/prefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(S.prefs),
  }).then((r) => r.json()).catch(() => null);
}

function viewHome() {
  const first = S.dashboard?.summary?.top_symptom;
  const wrap = el(`<div class="stack">
    <div class="flow-heading">
      <div class="stack-sm">
        <span class="eyebrow">Reset · about ${S.intake.duration_min} minutes</span>
        <h1>What needs attention right now?</h1>
        <p class="muted">Two quick choices, then FlowReset builds the session.</p>
      </div>
      <div class="privacy-chip"><span>●</span> AI and camera processing stay local</div>
    </div>

    <div class="reset-builder">
      <div class="card stack">
        <div class="flow-step">
          <span class="step-number">1</span>
          <div><h2>Check in</h2><p class="small muted">Choose an area or describe what you feel.</p></div>
        </div>
        <div class="grid symptom-grid" id="cards"></div>
        <div class="or"><span>or describe it</span></div>
        <textarea id="req" rows="2" aria-label="Describe what you need"
          placeholder="Example: My shoulders feel tight and I need to stay seated."></textarea>
        <div class="row">
          <button class="btn secondary" id="mic" type="button" aria-pressed="false">🎤 Use voice</button>
          <span class="small muted">Optional</span>
        </div>
        <p class="tiny muted" id="micStatus"></p>
      </div>

      <aside class="card reset-options stack">
        <div class="flow-step">
          <span class="step-number">2</span>
          <div><h2>Fit it to your day</h2><p class="small muted">Confirm time and movement options.</p></div>
        </div>
        <div class="stack-sm">
          <span class="eyebrow">Available time</span>
          <div class="row" id="dur"></div>
        </div>
        <div class="stack-sm">
          <span class="eyebrow">Movement option</span>
          <div class="row" id="stand"></div>
        </div>
        <div class="selection-summary" id="selectionSummary" aria-live="polite"></div>
        <button class="btn wide" id="ask">Build my reset</button>
        <button class="btn subtle wide" id="cancelPlan" hidden>Cancel</button>
        <p class="tiny muted" id="hint">The local agent uses your preferences and approved exercises.</p>
      </aside>
    </div>

    ${first ? `<div class="notice small">Your recent pattern: <strong>${esc(S.dashboard.symptom_labels?.[first] || first)}</strong>
      came up most this week. It is suggested first, but you stay in control.</div>` : ""}
  </div>`);

  const updateSummary = () => {
    const selected = SYMPTOM_CARDS.find((s) => s.key === S.intake.symptom);
    const summary = $("#selectionSummary", wrap);
    if (!summary) return;
    summary.innerHTML = `<span class="eyebrow">Your request</span>
      <strong>${esc(selected?.label || "General desk reset")}</strong>
      <span class="small muted">${S.intake.duration_min} min · ${S.intake.can_stand ? "Seated or standing" : "Seated only"}</span>`;
  };

  SYMPTOM_CARDS.forEach((s) => {
    const b = el(`<button class="symptom" type="button" aria-pressed="${S.intake.symptom === s.key}">
      <span class="glyph">${s.glyph}</span><strong>${esc(s.label)}</strong>
      <span class="small muted">${esc(s.hint)}</span>
      <span class="selected-check" aria-hidden="true">✓</span></button>`);
    b.addEventListener("click", () => {
      S.intake.symptom = s.key;
      S.intake.touched.symptom = true;
      [...$("#cards", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      updateSummary();
    });
    $("#cards", wrap).append(b);
  });

  [1, 2, 3, 5, 10].forEach((m) => {
    const b = el(`<button class="chip" type="button" aria-pressed="${S.intake.duration_min === m}">${m} min</button>`);
    b.addEventListener("click", () => {
      S.intake.duration_min = m;
      S.intake.touched.duration = true;
      [...$("#dur", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      updateSummary();
    });
    $("#dur", wrap).append(b);
  });

  [["Seated or standing", true], ["Seated only", false]].forEach(([label, val]) => {
    const b = el(`<button class="chip" type="button" aria-pressed="${S.intake.can_stand === val}">${label}</button>`);
    b.addEventListener("click", () => {
      S.intake.can_stand = val;
      S.intake.touched.stand = true;
      [...$("#stand", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      updateSummary();
    });
    $("#stand", wrap).append(b);
  });

  const ask = () => {
    const text = $("#req", wrap).value.trim();
    const selected = SYMPTOM_CARDS.find((s) => s.key === S.intake.symptom);
    const fallback = selected
      ? `My ${selected.label.toLowerCase()} need a reset. I have ${S.intake.duration_min} minutes and ${S.intake.can_stand ? "can stand" : "need to stay seated"}.`
      : `I need a ${S.intake.duration_min} minute desk reset.`;
    requestPlan(text || fallback);
  };
  $("#ask", wrap).addEventListener("click", ask);
  $("#cancelPlan", wrap).addEventListener("click", () => {
    S.planning = false;
    clearPlanningTimer();
    restorePlanControls();
    showToast("Plan request cancelled. Nothing was started.", "status");
  });
  $("#req", wrap).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
  });
  bindMic($("#mic", wrap), $("#req", wrap), $("#micStatus", wrap));
  updateSummary();
  return wrap;
}

function requestPlan(text) {
  if (S.planning) return;
  S.planning = true;
  S.trace = [];
  $("#traceList").innerHTML = "";
  const hint = $("#hint");
  if (hint) hint.textContent = "Thinking on the box…";
  const btn = $("#ask");
  if (btn) { btn.disabled = true; btn.textContent = "Building your reset…"; }
  const cancel = $("#cancelPlan");
  if (cancel) cancel.hidden = false;
  const override = {};
  if (S.intake.touched.symptom && S.intake.symptom) override.symptom = S.intake.symptom;
  if (S.intake.touched.duration) override.duration_min = S.intake.duration_min;
  if (S.intake.touched.stand) override.can_stand = S.intake.can_stand;

  send({ type: "intake", text, override: Object.keys(override).length ? override : undefined });
  clearPlanningTimer();
  planningTimer = setTimeout(() => {
    if (!S.planning || S.screen !== "home") return;
    S.planning = false;
    restorePlanControls();
    showToast("The local AI is taking longer than expected. Check that the model is running, then try again.", "error");
  }, 20000);
}

function clearPlanningTimer() {
  if (planningTimer) clearTimeout(planningTimer);
  planningTimer = null;
}

function restorePlanControls() {
  const btn = $("#ask");
  if (btn) { btn.disabled = false; btn.textContent = "Build my reset"; }
  const cancel = $("#cancelPlan");
  if (cancel) cancel.hidden = true;
  const hint = $("#hint");
  if (hint) hint.textContent = "The local agent uses your preferences and approved exercises.";
}

function viewPlan() {
  const p = S.plan;
  const kb = p.knowledge || S.knowledge?.topics?.find((t) => t.area === p.symptom);
  const lib = S.routines?.moves || null;
  const name = (k) => lib?.[k]?.name || k.replace(/_/g, " ");
  const secs = (k) => lib?.[k]?.seconds || null;

  const wrap = el(`<div class="stack">
    <div class="row"><span class="pill info">Your reset</span>
      <span class="pill">${p.duration_min} min</span>
      <span class="pill">${p.moves.length} moves</span></div>

    <div class="card stack">
      <h1>${esc(p.symptom_label)} reset</h1>
      <p class="hero-lede">Your plan is ready. Review the sequence, choose how your coach
        communicates, then decide whether to add private camera feedback.</p>

      <ol class="plan-moves">
        ${p.moves.map((k, i) => {
          // A repeated move is a set, not a duplicate line — say so, or the
          // list reads as a bug.
          const s = p.sets?.[i];
          const setLabel = s && s.of > 1 ? `<span class="set-tag">set ${s.set} of ${s.of}</span>` : "";
          return `<li><span>${esc(p.move_names?.[i] || name(k))}${setLabel}</span>
          ${secs(k) ? `<span class="dur">${secs(k)}s</span>` : ""}</li>`;
        }).join("")}
      </ol>

      ${S.why.length ? `<details class="why">
        <summary><strong class="small">Why this reset?</strong>
          <span class="tiny">Personalization, camera checks, and privacy</span></summary>
        <ul>${S.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        ${kb?.rationale ? `<p class="small why-rationale">${esc(kb.rationale)}</p>` : ""}
        ${kb?.sources?.length ? `<div class="source-list">${kb.sources.map((source) =>
          `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">
            <span>${esc(source.organization)}</span><strong>${esc(source.title)}</strong></a>`).join("")}</div>` : ""}
        <p class="tiny why-boundary">FlowReset provides general workplace-wellness guidance,
          not diagnosis or treatment. Content status: ${esc(kb?.review_status || "hackathon_general_wellness")}.</p></details>` : ""}

      <section class="session-guide">
        <div class="stack-sm">
          <span class="eyebrow">Quick session setup</span>
          <h2>Before you begin</h2>
        </div>
        <ol class="ready-list">
          <li><strong>Make space.</strong><span>Keep a stable chair nearby and clear the floor.</span></li>
          <li><strong>Choose your coach.</strong><span>Keep it quiet and visual, or add a two-way local voice conversation.</span></li>
          <li><strong>Stay comfortable.</strong><span>Use a comfortable range and stop if movement causes or worsens pain.</span></li>
        </ol>
        <fieldset class="coach-mode-picker">
          <legend>
            <span class="eyebrow">Coaching mode</span>
            <strong>How should FlowReset guide this session?</strong>
          </legend>
          <div class="coach-mode-options">
            <button class="coach-mode" type="button" data-coach-mode="visual"
              aria-pressed="${!S.prefs.voice}">
              <span class="mode-heading"><strong>Visual Coach</strong><span class="plan-tag">Standard</span></span>
              <span>Camera feedback, movement guide, and text tips. Quiet by default.</span>
            </button>
            <button class="coach-mode" type="button" data-coach-mode="voice"
              aria-pressed="${S.prefs.voice}">
              <span class="mode-heading"><strong>Conversational Coach</strong><span class="plan-tag premium">Premium</span></span>
              <span>Everything in Visual Coach, plus spoken tips and voice or typed questions.</span>
              <small>Whisper + Piper run locally on the GB10.</small>
            </button>
          </div>
        </fieldset>
        <details class="camera-details">
          <summary>What the camera checks</summary>
          <p class="small muted">${esc(kb?.camera?.checks?.join(" · ") || "Visibility, pace, and broad movement signals.")}</p>
          <p class="tiny muted">${esc(kb?.camera?.limitation || "This is broad form awareness, not clinical assessment.")}</p>
        </details>
        <div class="camera-consent small">
          <strong>Camera consent applies to this session only.</strong>
          Frames travel over the private local connection to the GB10 for in-memory
          analysis, are not stored, and stop when the session ends. Choosing
          <em>Start with camera coaching</em> confirms your consent; timer-only guidance
          remains available without it.
        </div>
        <div class="row">
          <button class="btn" id="startCam">Start with camera coaching</button>
          <button class="btn secondary" id="startNoCam">Start without camera</button>
          <button class="btn subtle" id="back">Change request</button>
        </div>
      </section>
    </div>
  </div>`);

  $("#startCam", wrap).addEventListener("click", () => beginSession(true));
  $("#startNoCam", wrap).addEventListener("click", () => beginSession(false));
  wrap.querySelectorAll("[data-coach-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      S.prefs.voice = button.dataset.coachMode === "voice";
      S.voiceState = S.prefs.voice ? "ready" : "off";
      wrap.querySelectorAll("[data-coach-mode]").forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)));
      savePrefs();
    });
  });
  $("#back", wrap).addEventListener("click", () => { S.plan = null; go("home"); });
  return wrap;
}

async function beginSession(withCamera) {
  // Persist the selected mode before the start event so the very first setup
  // cue is spoken only when Conversational Coach is actually selected.
  await savePrefs();
  let camera = false;
  if (withCamera) camera = await startCamera();
  S.cameraOn = camera;
  S.videoStatus = null;
  S.conversation = [];
  S.voiceState = S.prefs.voice ? "ready" : "off";
  send({ type: "start_reset", camera, symptom: S.plan.symptom, duration_min: S.plan.duration_min, can_stand: S.intake.can_stand });
  S.screen = "session";
  render();
  // Only now does <video id="cam"> exist. Without this the stream is live but
  // orphaned, and the user sees a black panel with the camera light on.
  if (camera) attachStream();
}

function viewSession() {
  const p = S.plan;
  const wrap = el(`<div class="stack">
    <div class="steps" id="steps">${p.moves.map(() => "<span></span>").join("")}</div>

    <div class="session">
      <div class="card timer-card">
        <div class="ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="8"></circle>
            <circle class="fill" id="ringFill" cx="60" cy="60" r="52" fill="none" stroke-width="8"
              stroke-dasharray="326.7" stroke-dashoffset="0"></circle>
          </svg>
          <div class="label" id="clock">0:00</div>
        </div>
        <div class="stack-sm">
          <div class="move-name" id="moveName">Getting ready…</div>
          <p class="move-cue" id="moveCue"></p>
          <p class="move-muscles" id="moveMuscles" hidden></p>
        </div>
        <div class="row">
          <button class="btn secondary" id="pause">Pause</button>
          <button class="btn subtle" id="skip">Skip move</button>
          <button class="btn subtle" id="stop">End</button>
        </div>
      </div>

      <div class="stack">
        <div class="camera-toolbar">
          <div>
            <strong>Your camera</strong>
            <span id="cameraState">${S.cameraOn ? "On for this session" : "Off — movement guide stays available"}</span>
          </div>
          <button class="btn secondary" id="camToggle" aria-pressed="${S.cameraOn}">
            ${S.cameraOn ? "Turn camera off" : "Turn on my camera"}
          </button>
        </div>

        <div class="video-status" id="videoStatus" data-state="${S.cameraOn ? "scanning" : "off"}">
          <span class="video-status-dot"></span>
          <div><strong>${S.cameraOn ? "Video AI is finding your position" : "Video AI is off"}</strong>
            <span>${S.cameraOn ? "Keep the relevant body area in frame." : `${S.prefs.voice ? "Conversational" : "Visual"} guidance remains available.`}</span></div>
        </div>
        <div class="cue-banner" id="cueBanner"></div>
        <div class="cam-wrap" id="camWrap">
          <video id="cam" autoplay muted playsinline></video>
          <canvas id="overlay"></canvas>
          <!-- The movement guide lives *inside* the camera frame: a ghost
               figure the user lines themselves up against and mirrors. Side by
               side it was a diagram to glance at; on top it is a target. -->
          <div id="movementGuide" class="guide-ghost" data-mode="overlay" aria-hidden="true">
            ${movementGuideMarkup(null)}
          </div>
          <div class="guide-caption" id="guideCaption">
            <span class="guide-caption-move" id="guideMove">Getting ready…</span>
            <p id="guideSetup">Get into a comfortable starting position.</p>
            <p id="guideDuring" class="guide-caption-during"></p>
          </div>
          <button class="guide-toggle" id="guideToggle" aria-pressed="true"
            title="Show or hide the movement guide">Guide</button>
          <div class="cam-off" id="camOff" ${S.cameraOn ? "hidden" : ""}>
            <strong>Camera is off</strong>
            <p class="small muted">Use the animated movement guide and text tips, or turn
              the camera on when you want form feedback.</p>
          </div>
          <div class="cam-flag" id="camFlag" ${S.cameraOn ? "" : "hidden"}>
            ${S.preview ? "Live camera preview · AI check simulated" : "Pose on GB10 · not recorded"}
          </div>
        </div>
        <p class="camera-help tiny ${S.cameraError ? "camera-help-error" : "muted"}"
          id="cameraHelp" ${S.preview || S.cameraError ? "" : "hidden"}>
          ${S.cameraError
            ? esc(S.cameraError)
            : "Camera permission is controlled by your browser. If a downloaded file blocks access, open the preview from localhost or use the GB10-served app."}
        </p>
        <button class="btn frame-go" id="frameGo" disabled hidden>
          Get into position
        </button>
        <div class="row small muted" id="metrics"></div>
        <section class="voice-coach" id="voicePanel" data-enabled="${S.prefs.voice}"
          aria-labelledby="voiceCoachTitle">
          <div class="voice-coach-head">
            <div>
              <span class="eyebrow">Optional upgrade · Premium</span>
              <h2 id="voiceCoachTitle">Conversational Coach</h2>
              <p class="small muted">Adds spoken tips and questions to this same guided session.</p>
            </div>
            <button class="toggle" id="voiceModeToggle" type="button"
              aria-pressed="${S.prefs.voice}" aria-label="Conversational Coach"></button>
          </div>
          <div class="voice-off-note" id="voiceOffNote" ${S.prefs.voice ? "hidden" : ""}>
            <strong>Visual Coach is active.</strong>
            <span class="small muted">Your camera checks, movement animation, and text cues continue quietly.</span>
          </div>
          <div class="voice-conversation" id="voiceConversation" ${S.prefs.voice ? "" : "hidden"}>
            <div class="voice-presence" role="status">
              <span class="voice-orb" aria-hidden="true"></span>
              <div><strong id="voiceStateLabel">Coach ready</strong>
                <span class="tiny muted" id="coachVoiceStatus">${S.preview
                  ? "Conversation is simulated here; Whisper and Piper connect on the GB10."
                  : "Speech and transcription stay on the GB10."}</span></div>
            </div>
            <div class="conversation-log" id="conversationLog" aria-live="polite"></div>
            <div class="voice-suggestions" aria-label="Suggested questions">
              <button class="chip-btn" type="button" data-ask="Where should I feel this?">Where should I feel this?</button>
              <button class="chip-btn" type="button" data-ask="What muscles am I working?">What muscles?</button>
              <button class="chip-btn" type="button" data-ask="Am I doing it right?">Am I doing it right?</button>
            </div>
            <form class="coach-question" id="coachQuestionForm">
              <label class="sr-only" for="coachQuestion">Ask your coach</label>
              <input id="coachQuestion" type="text" autocomplete="off" placeholder="Ask about this movement…" />
              <button class="btn secondary" id="coachMic" type="button" aria-pressed="false">Ask by voice</button>
              <button class="btn" type="submit">Send</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  </div>`);

  $("#voiceModeToggle", wrap).addEventListener("click", () => setVoiceMode(!S.prefs.voice));
  wrap.querySelectorAll("[data-ask]").forEach((button) =>
    button.addEventListener("click", () => askCoach(button.dataset.ask)));
  $("#coachQuestionForm", wrap).addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#coachQuestion", wrap);
    askCoach(input.value);
    input.value = "";
  });
  bindMic(
    $("#coachMic", wrap),
    $("#coachQuestion", wrap),
    $("#coachVoiceStatus", wrap),
    (text) => askCoach(text),
    { keepVisible: true, idleLabel: "Ask by voice" },
  );

  $("#pause", wrap).addEventListener("click", (e) => {
    const on = e.target.textContent === "Pause";
    e.target.textContent = on ? "Resume" : "Pause";
    send({ type: "pause", on });
  });
  $("#skip", wrap).addEventListener("click", () => send({ type: "skip" }));
  $("#stop", wrap).addEventListener("click", () => finishSession(false));
  $("#camToggle", wrap).addEventListener("click", toggleCamera);
  // Some people want to see themselves unobstructed once they know the move.
  $("#guideToggle", wrap).addEventListener("click", (e) => {
    S.guideHidden = !S.guideHidden;
    e.currentTarget.setAttribute("aria-pressed", String(!S.guideHidden));
    $("#camWrap", wrap).dataset.guide = S.guideHidden ? "off" : "on";
  });
  // Confirming position restarts the move's tracker, so reps are counted from
  // where the user actually began — not from the seconds they spent walking
  // into frame, which otherwise show up as a phantom rep and a "too fast" cue.
  $("#frameGo", wrap).addEventListener("click", (e) => {
    send({ type: "restart_move" });
    S.frameConfirmed = true;
    e.currentTarget.hidden = true;
  });
  paintVideoStatus();
  paintVoiceCoach();
  return wrap;
}

async function setVoiceMode(on) {
  S.prefs.voice = !!on;
  S.voiceState = on ? "ready" : "off";
  if (!on && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (on && !S.conversation.length) {
    S.conversation.push({
      role: "coach",
      text: S.preview
        ? "Conversational Coach is on. Ask a question to preview the flow; speech connects on the GB10."
        : "Conversational Coach is on. I’ll read new tips aloud, and you can ask me about this movement.",
    });
  }
  await savePrefs();
  render();
}

async function askCoach(question) {
  const text = String(question || "").trim();
  if (!text || !S.prefs.voice) return;
  S.conversation.push({ role: "you", text });
  S.voiceState = "thinking";
  paintVoiceCoach();

  if (mock) {
    send({ type: "ask", text, move: S.live?.move });
    return;
  }

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, move: S.live?.move }),
    });
    if (!response.ok) throw new Error("question failed");
  } catch {
    S.voiceState = "ready";
    S.conversation.push({
      role: "coach",
      text: "I couldn’t answer that just now. Keep moving comfortably or try again.",
    });
    paintVoiceCoach();
  }
}

function paintVoiceCoach() {
  const panel = $("#voicePanel");
  if (!panel) return;
  panel.dataset.enabled = String(S.prefs.voice);
  const toggle = $("#voiceModeToggle");
  if (toggle) toggle.setAttribute("aria-pressed", String(S.prefs.voice));
  const off = $("#voiceOffNote");
  const conversation = $("#voiceConversation");
  if (off) off.hidden = S.prefs.voice;
  if (conversation) conversation.hidden = !S.prefs.voice;
  if (!S.prefs.voice) return;

  const labels = {
    ready: "Coach ready",
    listening: "Listening…",
    thinking: "Thinking locally…",
    speaking: "Speaking…",
  };
  const state = $("#voiceStateLabel");
  if (state) state.textContent = labels[S.voiceState] || "Coach ready";
  const log = $("#conversationLog");
  if (log) {
    const messages = S.conversation.slice(-4);
    log.innerHTML = messages.length
      ? messages.map((message) => `<div class="conversation-message" data-role="${esc(message.role)}">
          <span>${message.role === "you" ? "You" : "Coach"}</span>
          <p>${esc(message.text)}</p>
        </div>`).join("")
      : `<p class="small muted">Ask a question or keep moving. New form tips will be read aloud.</p>`;
    log.scrollTop = log.scrollHeight;
  }
}

function paintSession() {
  const live = S.live;
  const p = S.plan;
  if (!live || !p) return;

  const lib = S.routines?.moves || null;
  const total = lib?.[live.move]?.seconds || 45;
  const elapsed = live.hold_seconds || 0;
  const remain = Math.max(0, Math.ceil(total - elapsed));

  const clock = $("#clock");
  if (clock) clock.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}`;

  const ring = $("#ringFill");
  if (ring) {
    const C = 2 * Math.PI * 52;
    ring.style.strokeDashoffset = String(C * Math.min(1, elapsed / total));
  }

  const nameEl = $("#moveName");
  const moveName =
    lib?.[live.move]?.name ||
    p.move_names?.[live.move_index] ||
    String(live.move || "").replace(/_/g, " ");
  if (nameEl) nameEl.textContent = moveName;
  const cueEl = $("#moveCue");
  if (cueEl) cueEl.textContent = lib?.[live.move]?.cues?.during || "";

  const guide = $("#movementGuide");
  if (guide && guide.dataset.move !== live.move) {
    guide.dataset.move = live.move;
    guide.innerHTML = movementGuideMarkup(live.move);
  }
  const guideMove = $("#guideMove");
  if (guideMove) guideMove.textContent = moveName;
  const guideSetup = $("#guideSetup");
  if (guideSetup) {
    guideSetup.textContent =
      lib?.[live.move]?.cues?.setup || `Get ready for ${moveName.toLowerCase()}.`;
  }
  const guideDuring = $("#guideDuring");
  if (guideDuring) {
    guideDuring.textContent =
      lib?.[live.move]?.cues?.during || S.cue || "Move slowly and stay within a comfortable range.";
  }

  // Naming the muscle while it works is the mind-muscle mechanism, so this
  // stays on screen for the whole move rather than flashing with the cue.
  const muscleEl = $("#moveMuscles");
  if (muscleEl) {
    const m = live.target_muscles || [];
    muscleEl.textContent = m.length ? `Targeting: ${m.join(" · ")}` : "";
    muscleEl.hidden = !m.length;
  }

  const steps = $("#steps");
  if (steps) {
    [...steps.children].forEach((s, i) => {
      s.dataset.done = String(i < live.move_index);
      s.dataset.active = String(i === live.move_index);
    });
  }

  const metrics = $("#metrics");
  if (metrics) {
    const framingReady = S.framing !== "no_person" &&
      (!p.needs_full_body || S.framing === "full_body");
    metrics.innerHTML = S.cameraOn
      ? `<span class="pill ${framingReady ? "good" : "warn"}">${framingReady ? "In frame" : "Reposition camera"}</span>
         <span class="pill ${live.tempo === "good" ? "good" : "warn"}">${live.tempo === "good" ? "Controlled pace" : "Slow down"}</span>
         ${live.target_reps ? `<span class="pill">${live.rep}/${live.target_reps} completed</span>` : ""}
         <span class="pill ${live.form === "ok" ? "good" : "warn"}">${live.form === "ok" ? "Movement visible" : "Check the coaching cue"}</span>`
      : `<span class="pill">Guidance: ${S.prefs.voice ? "visual + conversation" : "visual"}</span>`;
  }

  paintFrameGo();
  drawOverlay();
  paintVideoStatus();
}

/** The position gate: disabled until the server says framing has held. */
function paintFrameGo() {
  const btn = $("#frameGo");
  if (!btn) return;
  const f = S.frame;
  if (!S.cameraOn || S.frameConfirmed || !f) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.disabled = !f.ready;
  btn.dataset.ready = String(!!f.ready);
  btn.textContent = f.ready
    ? "I'm in position — start counting"
    : f.ok
      ? "Hold it there…"
      : f.target === "full_body"
        ? "Step back so your feet are in frame"
        : "Get your head and shoulders in frame";
}

function paintVideoStatus() {
  const box = $("#videoStatus");
  if (!box) return;
  if (!S.cameraOn) {
    box.dataset.state = "off";
    box.innerHTML = `<span class="video-status-dot"></span><div><strong>Video AI is off</strong>
      <span>${S.prefs.voice ? "Conversational" : "Visual"} guidance remains available.</span></div>`;
    return;
  }
  if (S.preview && videoStream) {
    box.dataset.state = "ready";
    box.innerHTML = `<span class="video-status-dot"></span><div><strong>Camera preview is on</strong>
      <span>Your live feed is visible. Form evaluation is simulated until the GB10 is attached.</span></div>`;
    return;
  }
  if (S.videoStatus) {
    box.dataset.state = S.videoStatus.status;
    box.innerHTML = `<span class="video-status-dot"></span><div><strong>Local video AI check</strong>
      <span>${esc(S.videoStatus.text)}</span></div>`;
    return;
  }
  // Server-computed and per-move, not per-plan: a routine can mix a seated
  // twist with a standing squat, and each needs a different amount of you in
  // frame. Same object drives the on-canvas guide, so they cannot disagree.
  const f = S.frame;
  if (!f) {
    box.dataset.state = "scanning";
    box.innerHTML = `<span class="video-status-dot"></span><div>
      <strong>Video AI is finding your position</strong>
      <span>Keep the relevant body area in frame.</span></div>`;
    return;
  }
  const want = f.target === "full_body" ? "Full body in frame" : "Head and shoulders in frame";
  box.dataset.state = f.ready ? "ready" : f.ok ? "holding" : "scanning";
  const heading = f.ready
    ? "You're in position"
    : f.ok
      ? "Hold it there…"
      : want;
  const detail = f.ready
    ? "Movement stays on the GB10 and frames are discarded."
    : esc(f.reason || "Keep the relevant body area in frame.");
  box.innerHTML = `<span class="video-status-dot"></span><div>
    <strong>${heading}</strong><span>${detail}</span></div>`;
}

function paintCue() {
  const banner = $("#cueBanner");
  if (banner) banner.textContent = S.cue || "";
}

function drawOverlay() {
  const canvas = $("#overlay");
  if (!canvas || !S.cameraOn) return;
  const wrap = $("#camWrap");
  if (canvas.width !== wrap.clientWidth || canvas.height !== wrap.clientHeight) {
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  }
  // In the standalone preview, never imply that synthetic landmarks came from
  // the person's real camera. The animated guide is shown in its own panel.
  if (S.preview && videoStream) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawSkeleton(canvas, S.keypoints, getComputedStyle(document.body).getPropertyValue("--accent").trim());
  // Guide last so the target outline stays readable over the skeleton.
  drawFrameGuide(canvas, S.frame);
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable in this browser context.");
    }
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
  } catch {
    S.cameraError =
      "Camera could not start. Allow camera permission in the browser, then try again. " +
      "If you opened a downloaded file, use localhost or the GB10-served app.";
    return false;
  }
  S.cameraError = null;
  attachStream();
  return true;
}

async function toggleCamera() {
  if (S.cameraOn) {
    stopCamera();
    send({ type: "camera", on: false });
    render();
    showToast("Camera turned off. The movement guide and voice coaching continue.");
    return;
  }

  const ok = await startCamera();
  S.cameraOn = ok;
  send({ type: "camera", on: ok });
  if (ok) {
    render();
    attachStream();
    showToast(S.preview
      ? "Camera preview is on. AI form evaluation remains simulated without the GB10."
      : "Camera guidance is on. Frames are processed locally and are not stored.");
    return;
  }

  render();
  showToast(
    "Camera access was not available. Allow camera permission, or open this preview from localhost. The movement guide still works.",
    "error"
  );
}

/** Bind the live stream to whatever <video id="cam"> currently exists.
 *
 * Separate from startCamera() because the consent click happens on the plan
 * screen, one render *before* the session DOM exists — so the element the
 * stream needs isn't there yet. Permission would be granted, the camera light
 * would come on, and the panel would stay black. Call this after any render
 * that (re)creates the video element. */
function attachStream() {
  const video = $("#cam");
  if (!video || !videoStream) return;
  if (video.srcObject !== videoStream) video.srcObject = videoStream;
  video.play().catch(() => {});
  startFrameLoop();
}

/* The only place camera data moves. Frames go to the box over the LAN and
   nowhere else — there is no other fetch/send of image data in this file. */
function startFrameLoop() {
  stopFrameLoop();
  if (S.preview) return; // nothing to send frames to
  const scratch = document.createElement("canvas");
  scratch.width = 320;
  scratch.height = 240;
  const ctx = scratch.getContext("2d");
  frameTimer = setInterval(() => {
    // Looked up per tick, not captured: render() replaces the video element,
    // and a stale reference silently stops the pose feed.
    const video = $("#cam");
    if (!video || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, scratch.width, scratch.height);
    const data = scratch.toDataURL("image/jpeg", 0.6).split(",")[1];
    send({ type: "frame", data });
  }, 1000 / 10);
}

function stopFrameLoop() {
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
}

function stopCamera() {
  stopFrameLoop();
  if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
  videoStream = null;
  S.cameraOn = false;
  S.cameraError = null;
}

function finishSession(completed) {
  stopCamera();
  S.completed = completed;
  S.response = null;
  S.insight = null;
  S.screen = "complete";
  render();
}

function viewComplete() {
  const wrap = el(`<div class="stack">
    <div class="card stack">
      <span class="eyebrow">${S.completed ? "Reset complete" : "Ended early"}</span>
      <h1>How do you feel?</h1>
      <p class="muted">One tap. This is the only thing FlowReset asks of you, and it's
        what makes the next recommendation better.</p>
      <div class="row" id="fb">
        <button class="btn" data-r="better">Better</button>
        <button class="btn secondary" data-r="same">About the same</button>
        <button class="btn secondary" data-r="worse">Worse</button>
      </div>
      <p class="small muted">Camera off. Nothing from this session was recorded.</p>
    </div>
    <div id="after"></div>
  </div>`);

  $("#fb", wrap).addEventListener("click", (e) => {
    const r = e.target.dataset?.r;
    if (!r) return;
    S.response = r;
    send({ type: "end_session", completed: S.completed, response: r });
    setTimeout(() => {
      loadDashboard().then(() => {
        const after = $("#after");
        if (!after) return;
        after.innerHTML = "";
        after.append(el(`<div class="card stack">
          <h2>Saved locally</h2>
          <p>${esc(S.coachText || "Recorded.")}</p>
          ${S.insight ? `<div class="why"><strong class="small">One pattern</strong>
            <p class="small" style="color:var(--accent-ink);margin-top:6px">${esc(S.insight)}</p></div>` : ""}
          <div class="row">
            <button class="btn" id="toDash">See my insights</button>
            <button class="btn subtle" id="again">Start another reset</button>
          </div>
        </div>`));
        $("#toDash").addEventListener("click", () => go("dashboard"));
        $("#again").addEventListener("click", () => { S.plan = null; go("home"); });
      });
    }, 400);
    [...$("#fb", wrap).children].forEach((b) => (b.disabled = true));
  });
  return wrap;
}

function viewEscalate() {
  const wrap = el(`<div class="card stack">
    <span class="eyebrow">Let's pause here</span>
    <h1>This one's worth a professional's eyes</h1>
    <p class="hero-lede">${esc(S.coachText)}</p>
    <div class="row"><button class="btn secondary" id="back">Back to home</button></div>
  </div>`);
  $("#back", wrap).addEventListener("click", () => go("home"));
  return wrap;
}

function viewDashboard() {
  const d = S.dashboard;
  if (!d) return el(`<div class="notice">Loading your history…</div>`);
  const s = d.summary;
  const labels = d.symptom_labels || {};
  const topSymptom = s.top_symptom ||
    Object.entries(s.by_symptom || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "neck_shoulders";
  const topLabel = labels[topSymptom] || topSymptom.replace(/_/g, " ");
  const totalRated = Object.values(s.responses || {}).reduce((sum, n) => sum + n, 0);
  const recommendedMinutes = topSymptom === "tired_eyes" ? 1 : 2;
  const nextSteps = {
    neck_shoulders: "Try a 2-minute neck and shoulder reset before your longest focus block.",
    back_hips: "Break up your next long sitting block with a 2-minute back and hip reset.",
    legs_glutes: "Use a 2-minute standing leg and glute reset after your next long meeting.",
    wrists_hands: "Try a 2-minute wrist and hand reset before your longest typing block.",
    tired_eyes: "Take a 1-minute screen-rest reset before your next video meeting.",
    general: "Schedule a 2-minute reset before your longest focus block.",
  };
  const responseTakeaway = !totalRated
    ? "Rate your next reset to start learning what works for you."
    : s.better_rate >= 0.7
      ? "Most rated resets leave you feeling better. Keep the routines that work in rotation."
      : s.better_rate >= 0.45
        ? "Your results are mixed. Try the recommended focus for one week, then compare."
        : "Your recent resets are not helping consistently. Reduce intensity and reconsider the routine.";
  const habitTakeaway = s.sessions_completed >= 5
    ? "You have a steady reset routine. Protect the time blocks where you are already consistent."
    : s.sessions_completed
      ? "You have started the habit. Add one reset before a predictable daily work block."
      : "Complete one reset to establish your personal baseline.";

  // ── the headline insight ──
  // Whoop/Oura pattern: one causal sentence a person can act on, not a wall of
  // counts. "Your neck goes after 4pm" changes behaviour; "neck: 6" does not.
  const pr = d.practice || {};
  const busiest = pr.busiest_daypart;
  const practiced = pr.moves || {};
  const distinctPractised = pr.distinct_moves || 0;
  const totalMoves = Object.keys(S.routines?.moves || {}).length || 26;

  // Which single movement has the best strike rate, with enough rating behind
  // it to mean anything. Two ratings is a low bar, but it is honest about
  // being early rather than silently pretending to a trend.
  const rankedMoves = Object.entries(practiced)
    .filter(([, m]) => m.rated >= 2)
    .map(([k, m]) => ({ key: k, ...m, rate: m.better / m.rated }))
    .sort((a, b) => b.rate - a.rate || b.rated - a.rated);
  const bestMove = rankedMoves[0];

  const headline = busiest && busiest.sessions
    ? `Most of your resets happen ${busiest.label.toLowerCase()}`
    : `${topLabel} is your current focus`;
  const headlineWhy = busiest && busiest.sessions
    ? `${busiest.sessions} of your last ${pr.days || 30} days' sessions started then${
        busiest.top_symptom ? `, most often for ${esc(labels[busiest.top_symptom] || busiest.top_symptom).toLowerCase()}` : ""
      }. Getting ahead of it with one reset before that block tends to work better than reacting after.`
    : nextSteps[topSymptom] || nextSteps.general;

  const score = d.score || null;
  const chk = d.checkins || null;
  const calendar = d.calendar || [];

  // Score ring geometry. One number with its parts shown underneath — a score
  // whose derivation is hidden is one people learn to distrust.
  const R = 52, C = 2 * Math.PI * R;
  const pctArc = score ? (score.score / 100) * C : 0;

  const wrap = el(`<div class="stack">
    <div class="insights-head">
      <div class="stack-sm"><span class="eyebrow">Private to you</span><h1>My insights</h1>
        <p class="muted">Analyzed locally on this machine — never compared with coworkers,
          never shown as a team score.</p></div>
      <div class="insights-topline">
        <div><strong>${s.sessions_completed}</strong><span>completed · 7d</span></div>
        <div><strong>${s.streak_days}</strong><span>day streak</span></div>
        <div><strong>${Math.round((s.better_rate || 0) * 100)}%</strong><span>felt better</span></div>
      </div>
    </div>

    ${score && score.has_data ? `<section class="card score-card">
      <div class="score-ring-wrap">
        <svg class="score-ring" viewBox="0 0 128 128" role="img"
          aria-label="Desk wellbeing score ${score.score} out of 100, ${esc(score.band)}">
          <circle class="ring-track" cx="64" cy="64" r="${R}"></circle>
          <circle class="ring-fill" cx="64" cy="64" r="${R}"
            stroke-dasharray="${pctArc.toFixed(1)} ${(C - pctArc).toFixed(1)}"></circle>
        </svg>
        <div class="score-value"><strong>${score.score}</strong><span>${esc(score.band)}</span></div>
      </div>
      <div class="score-body stack-sm">
        <span class="eyebrow">Desk wellbeing · last ${score.days} days</span>
        <h2>What this score is made of</h2>
        <p class="small muted">This measures the habit, not your body — FlowReset can't
          examine you, so it doesn't pretend to.</p>
        <ul class="score-parts">
          ${score.parts.map((p) => `<li>
            <div class="score-part-head">
              <span>${esc(p.label)}</span>
              <span class="score-part-num">${p.earned}<span class="muted">/${p.weight}</span></span>
            </div>
            <div class="score-part-bar"><span style="width:${p.pct}%"></span></div>
            <p class="tiny muted">${esc(p.why)}</p>
          </li>`).join("")}
        </ul>
        ${score.focus ? `<p class="score-focus">Biggest gain available:
          <strong>${esc(score.focus.label.toLowerCase())}</strong> — ${esc(score.focus.why.toLowerCase())}.</p>` : ""}
      </div>
    </section>` : ""}

    <section class="card checkin-card" aria-labelledby="checkinTitle">
      <div class="stack-sm">
        <span class="eyebrow">${chk?.logged_today ? "Logged today" : "Takes five seconds"}</span>
        <h2 id="checkinTitle">How does your body feel right now?</h2>
        <p class="small muted">The one thing the camera can't tell us. It's also what makes
          the trend below mean anything.</p>
      </div>
      <div class="checkin-controls">
        <div class="checkin-row" id="checkinArea" role="group" aria-label="Body area">
          ${Object.entries(labels).filter(([k]) => k !== "general").map(([k, v], i) =>
            `<button class="chip" data-area="${esc(k)}" aria-pressed="${i === 0}">${esc(v)}</button>`).join("")}
        </div>
        <div class="checkin-row" id="checkinLevel" role="group" aria-label="How it feels">
          ${Object.entries(chk?.levels || { 1: "Easy", 2: "Fine", 3: "Noticeable", 4: "Sore", 5: "Rough" })
            .map(([lv, name]) =>
              `<button class="level-chip" data-level="${lv}" aria-pressed="${lv === "3"}">
                <span class="level-dot" data-lv="${lv}"></span>${esc(name)}</button>`).join("")}
        </div>
        <button class="btn" id="checkinSave">Log how I feel</button>
      </div>
      ${chk?.count ? `<div class="checkin-trend">
        <span class="eyebrow">Last ${chk.days} days</span>
        <div class="trend-strip" role="img" aria-label="Daily check-in levels">
          ${chk.trend.slice(-21).map((t) => `<span class="trend-bar" data-reset="${t.reset}"
            style="height:${(t.level / 5) * 100}%"
            title="${esc(t.date)} · ${esc(chk.levels[Math.round(t.level)] || t.level)}${t.reset ? " · reset done" : ""}"></span>`).join("")}
        </div>
        ${chk.on_reset_days != null && chk.off_reset_days != null ? `
          <p class="small checkin-compare">On days you completed a reset your body reads
            <strong>${chk.on_reset_days.toFixed(1)}</strong>, versus
            <strong>${chk.off_reset_days.toFixed(1)}</strong> on days you didn't.
            <span class="muted">Lower is easier. Observational, not proof.</span></p>`
          : `<p class="tiny muted">Log on a few more days — including days without a reset —
             and this will compare the two.</p>`}
      </div>` : ""}
    </section>

    <section class="card insight-hero" aria-labelledby="next-step-title">
      <div class="stack-sm">
        <span class="eyebrow">The pattern worth knowing</span>
        <h2 id="next-step-title">${esc(headline)}</h2>
        <p class="hero-lede">${headlineWhy}</p>
        <div class="daypart-strip" role="img"
          aria-label="Sessions by time of day over the last ${pr.days || 30} days">
          ${(pr.dayparts || []).map((part) => {
            const max = Math.max(...(pr.dayparts || []).map((x) => x.sessions), 1);
            const pct = Math.round((part.sessions / max) * 100);
            const peak = busiest && part.label === busiest.label && part.sessions > 0;
            return `<div class="daypart" data-peak="${peak}">
              <div class="daypart-bar"><span style="height:${Math.max(pct, 4)}%"></span></div>
              <span class="daypart-label">${esc(part.label)}</span>
              <span class="daypart-count">${part.sessions}</span>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="stack-sm insight-action">
        <span class="pill info">${esc(topLabel)} · most requested</span>
        <button class="btn" id="recommendedReset">Start recommended reset</button>
        <button class="btn subtle" id="insightsToLearn">Learn about ${esc(topLabel.toLowerCase())}</button>
        <p class="tiny muted">${esc(nextSteps[topSymptom] || nextSteps.general)}</p>
      </div>
    </section>

    ${bestMove ? `<section class="card best-move">
      <div class="stack-sm">
        <span class="eyebrow">What's working for you</span>
        <h2>${esc(S.routines?.moves?.[bestMove.key]?.name || bestMove.key.replace(/_/g, " "))}</h2>
        <p class="small muted">You rated <strong>${bestMove.better} of ${bestMove.rated}</strong>
          resets containing this movement as “better” — your strongest response so far.</p>
      </div>
      <button class="btn subtle" data-learn-move="${esc(bestMove.key)}">See the guide</button>
    </section>` : ""}

    <div class="insight-grid">
      <section class="card insight-card stack">
        <div class="insight-card-head">
          <div class="stack-sm"><span class="eyebrow">Routine</span>
            <h2>How often am I resetting?</h2></div>
          <div class="insight-number"><strong>${s.sessions_completed}</strong>
            <span>sessions · 7 days</span></div>
        </div>
        <div id="bars"></div>
        <p class="insight-takeaway"><strong>${s.streak_days}-day streak.</strong>
          ${esc(habitTakeaway)}</p>
      </section>

      <section class="card insight-card stack">
        <div class="stack-sm"><span class="eyebrow">Outcome</span>
          <h2>How do I feel afterwards?</h2>
          <p class="small muted">Your answer after each completed reset.</p></div>
        <div id="split"></div>
        <p class="insight-takeaway">${esc(responseTakeaway)}</p>
      </section>

      <section class="card insight-card stack">
        <div class="stack-sm"><span class="eyebrow">Focus</span>
          <h2>What still needs attention?</h2>
          <p class="small muted">Areas you chose most often this week.</p></div>
        <div id="areas"></div>
        <p class="insight-takeaway"><strong>${esc(topLabel)}</strong> appears most often.
          Use the recommendation above as your next experiment.</p>
      </section>
    </div>

    <div class="insight-lower">
      <section class="card stack" aria-labelledby="calTitle">
        <div class="insight-card-head">
          <div class="stack-sm"><span class="eyebrow">Consistency</span>
            <h2 id="calTitle">Your last five weeks</h2></div>
          <div class="cal-key"><span>fewer</span>
            <i data-lv="0"></i><i data-lv="1"></i><i data-lv="2"></i><i data-lv="3"></i>
            <span>more</span></div>
        </div>
        <div class="cal-grid" role="img"
          aria-label="Daily reset activity over the last five weeks">
          ${calendar.map((day) => {
            const n = day.completed || 0;
            const lv = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
            const dt = new Date(day.date + "T00:00:00");
            return `<i class="cal-cell" data-lv="${lv}"
              title="${dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${n} completed"></i>`;
          }).join("")}
        </div>
        <p class="tiny muted">Each square is a day. The streak matters more than any
          single session — this is the picture worth protecting.</p>
      </section>

      <section class="card stack" aria-labelledby="bodyTitle">
        <div class="stack-sm"><span class="eyebrow">Where it shows up</span>
          <h2 id="bodyTitle">Your body map</h2></div>
        <div class="bodymap-wrap" id="bodymap"></div>
        <ul class="bodymap-legend">
          ${Object.entries(s.by_symptom || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
            .map(([k, n]) => {
              const max = Math.max(...Object.values(s.by_symptom || { x: 1 }));
              return `<li><span class="legend-swatch" style="opacity:${(0.25 + 0.75 * (n / max)).toFixed(2)}"></span>
                ${esc(labels[k] || k)} <span class="muted">${n}</span></li>`;
            }).join("")}
        </ul>
      </section>
    </div>

    <div class="insight-lower">
      <section class="card stack" aria-labelledby="historyTitle">
        <div class="insight-card-head">
          <div class="stack-sm"><span class="eyebrow">History</span>
            <h2 id="historyTitle">Recent sessions</h2></div>
          <span class="pill">Last ${Math.min((d.recent || []).length, 6)}</span>
        </div>
        <ol class="session-timeline" id="rows"></ol>
      </section>

      <section class="card stack" aria-labelledby="coverageTitle">
        <div class="stack-sm"><span class="eyebrow">Your library</span>
          <h2 id="coverageTitle">Movements you've practised</h2>
          <p class="small muted">Out of ${totalMoves} approved movements. Breadth matters
            less than repetition — but a movement you've never tried can't help you yet.</p></div>
        <div class="coverage-meter" role="img"
          aria-label="${distinctPractised} of ${totalMoves} movements practised">
          <span style="width:${Math.round((distinctPractised / totalMoves) * 100)}%"></span>
        </div>
        <p class="coverage-count"><strong>${distinctPractised}</strong> practised ·
          <span class="muted">${Math.max(totalMoves - distinctPractised, 0)} still new to you</span></p>
        <button class="btn subtle" id="coverageToLearn">Browse the full library</button>
      </section>
    </div>
  </div>`);

  $("#bars", wrap).append(charts.dayBars(d.daily));
  $("#split", wrap).append(charts.responseSplit(s.responses));
  $("#areas", wrap).append(charts.areaBars(s.by_symptom, labels));
  $("#recommendedReset", wrap).addEventListener("click", () => {
    S.intake.symptom = topSymptom;
    S.intake.duration_min = recommendedMinutes;
    S.intake.touched.symptom = true;
    S.intake.touched.duration = true;
    go("home");
  });

  // Body map: heat where discomfort actually gets reported. A figure reads
  // faster than a bar chart for "where", because the axis is your own body.
  const bm = $("#bodymap", wrap);
  if (bm) {
    const by = s.by_symptom || {};
    const max = Math.max(...Object.values(by), 1);
    const heat = (k) => (by[k] ? (0.22 + 0.78 * (by[k] / max)).toFixed(2) : "0.06");
    bm.innerHTML = `<svg viewBox="0 0 120 210" class="bodymap" role="img"
      aria-label="Body areas shaded by how often you reported them">
      <g class="bm-base">
        <circle cx="60" cy="24" r="15"/>
        <path d="M45 44 h30 l6 46 h-42 z"/>
        <path d="M39 46 l-11 40 6 3 13-37z"/><path d="M81 46 l11 40 -6 3 -13-37z"/>
        <path d="M47 92 h11 l-2 60 h-11z"/><path d="M62 92 h11 l2 60 h-11z"/>
      </g>
      <g class="bm-heat">
        <ellipse cx="60" cy="47" rx="24" ry="12" style="opacity:${heat("neck_shoulders")}"/>
        <ellipse cx="60" cy="80" rx="20" ry="14" style="opacity:${heat("back_hips")}"/>
        <ellipse cx="60" cy="120" rx="22" ry="26" style="opacity:${heat("legs_glutes")}"/>
        <ellipse cx="30" cy="88" rx="8" ry="9" style="opacity:${heat("wrists_hands")}"/>
        <ellipse cx="90" cy="88" rx="8" ry="9" style="opacity:${heat("wrists_hands")}"/>
        <ellipse cx="60" cy="21" rx="13" ry="7" style="opacity:${heat("tired_eyes")}"/>
      </g>
    </svg>`;
  }

  // Check-in. Optimistic UI would be wrong here — the comparison below depends
  // on the server's recomputed aggregate, so wait for it and re-render.
  const areaRow = $("#checkinArea", wrap);
  const levelRow = $("#checkinLevel", wrap);
  const pickOne = (row, attr) => (btn) => {
    [...row.children].forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
  };
  areaRow?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-area]");
    if (b) pickOne(areaRow)(b);
  });
  levelRow?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (b) pickOne(levelRow)(b);
  });
  $("#checkinSave", wrap)?.addEventListener("click", async (e) => {
    const area = areaRow?.querySelector('[aria-pressed="true"]')?.dataset.area || "general";
    const level = +(levelRow?.querySelector('[aria-pressed="true"]')?.dataset.level || 3);
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = "Saving…";
    if (mock) {
      mock.logCheckin?.(area, level);
      S.dashboard = mock.dashboard();
    } else {
      await fetch("/api/checkin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, level }),
      }).catch(() => {});
      await loadDashboard();
    }
    showToast("Logged. Thanks — that's what makes the trend real.", "ok");
    render();
  });

  $("#insightsToLearn", wrap)?.addEventListener("click", () => {
    S.learnArea = topSymptom;
    go("knowledge");
  });
  $("#coverageToLearn", wrap)?.addEventListener("click", () => go("knowledge"));
  wrap.querySelectorAll("[data-learn-move]").forEach((b) =>
    b.addEventListener("click", () => {
      S.learnMove = b.dataset.learnMove;
      go("knowledge");
    }));

  const tbody = $("#rows", wrap);
  (d.recent || []).slice(0, 6).forEach((r) => {
    const when = new Date(r.started_at);
    const badge = r.response
      ? `<span class="pill ${r.response === "better" ? "good" : r.response === "worse" ? "warn" : ""}">${r.response}</span>`
      : `<span class="pill">not finished</span>`;
    tbody.append(el(`<li class="session-row" data-live="${!r.is_demo}">
      <div class="session-when">
        <strong>${when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong>
        <span class="muted tiny">${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <div class="session-body">
        <div class="row"><strong>${esc(labels[r.symptom] || r.symptom)}</strong>
          <span class="tiny muted">${r.duration_min} min</span>
          ${badge} ${r.is_demo ? "" : '<span class="pill info">this session</span>'}</div>
        <p class="tiny muted">${esc((r.moves || []).map((m) =>
          S.routines?.moves?.[m]?.name || m.replace(/_/g, " ")).join(" · "))}</p>
      </div>
    </li>`));
  });
  return wrap;
}


const LIBRARY_AREAS = [
  "neck_shoulders",
  "back_hips",
  "legs_glutes",
  "wrists_hands",
  "tired_eyes",
  "general",
];

function libraryAreaForMove(move, key = "") {
  if (key === "box_breath") return "general";
  if (key === "squat") return "legs_glutes";
  const targets = new Set(move?.targets || []);
  if (targets.has("eyes")) return "tired_eyes";
  if (targets.has("wrists")) return "wrists_hands";
  if (targets.has("glutes") || targets.has("legs") || targets.has("pelvis")) return "legs_glutes";
  if (targets.has("hips") || targets.has("sitting")) return "back_hips";
  if (targets.has("neck") || targets.has("shoulders")) return "neck_shoulders";
  if (targets.has("back")) return "back_hips";
  return "general";
}

function libraryIcon(area) {
  return {
    neck_shoulders: "↘",
    back_hips: "⌁",
    legs_glutes: "◇",
    wrists_hands: "✦",
    tired_eyes: "◉",
    general: "○",
  }[area] || "○";
}

function viewKnowledge() {
  const kb = S.knowledge;
  if (!kb) {
    loadKnowledge();
    return el(`<div class="notice">Loading the approved wellness library…</div>`);
  }

  const labels = S.routines?.symptoms || {};
  const topics = kb.topics || [];
  const topicByArea = Object.fromEntries(topics.map((topic) => [topic.area, topic]));
  const moves = Object.entries(S.routines?.moves || {}).map(([key, move]) => ({
    key,
    ...move,
    area: libraryAreaForMove(move, key),
  }));
  const areas = LIBRARY_AREAS.filter((area) =>
    topics.some((topic) => topic.area === area) || moves.some((move) => move.area === area)
  );

  // Practice history turns a flat catalog into a personal one: a movement you
  // have done twelve times and one you have never tried should not look
  // identical. Comes from /api/dashboard, which the nav preloads.
  const practiced = S.dashboard?.practice?.moves || {};
  const practisedCount = Object.keys(practiced).length;
  const newCount = Math.max(moves.length - practisedCount, 0);
  // Skip the closer: it is appended to every routine, so it always wins on
  // raw count and would be a meaningless thing to suggest revisiting.
  const mostPractised = Object.entries(practiced)
    .filter(([k]) => k !== "box_breath")
    .sort((a, b) => b[1].practiced - a[1].practiced)[0];
  const continueMove = mostPractised
    ? moves.find((m) => m.key === mostPractised[0])
    : null;

  const wrap = el(`<div class="stack">
    <div class="library-hero card">
      <div class="stack-sm">
        <div class="row"><span class="pill good">Approved wellness content</span>
          <span class="pill">${moves.length} exercise guides</span>
          <span class="pill">${areas.length} desk-work topics</span>
          <span class="pill info">Animated demos</span></div>
        <h1>Learn what helps during a desk day</h1>
        <p class="hero-lede">The movements FlowReset can recommend, and why each one helps.</p>
        <div class="row">
          <button class="btn" id="libraryReset">Start a reset</button>
          ${continueMove ? `<button class="btn secondary" data-demo-move="${esc(continueMove.key)}">
            Revisit ${esc(continueMove.name)}</button>` : ""}
          <span class="tiny muted">Reviewed ${esc(kb.reviewed_at)} · Version ${esc(kb.version)}</span>
        </div>
        ${practisedCount ? `<div class="learn-progress">
          <div class="learn-progress-bar">
            <span style="width:${Math.round((practisedCount / moves.length) * 100)}%"></span>
          </div>
          <p class="tiny muted"><strong>${practisedCount} of ${moves.length}</strong> practised ·
            ${newCount} still new to you</p>
        </div>` : `<p class="tiny muted">Complete a reset and this library starts tracking
          which movements you've practised.</p>`}
      </div>
      <div class="library-boundary">
        <span class="eyebrow">Use this library for</span>
        <strong>Education and general wellness</strong>
        <p class="small">${esc(kb.boundary)}</p>
      </div>
    </div>

    <section class="stack library-section" aria-labelledby="topicsTitle">
      <div class="library-section-head">
        <div class="stack-sm">
          <span class="eyebrow">Explore by need</span>
          <h2 id="topicsTitle">Common desk-work concerns</h2>
        </div>
      </div>
      <div class="grid library-grid">
        ${areas.map((area) => {
          const topic = topicByArea[area];
          if (!topic) return "";
          return `<article class="card library-topic stack-sm">
            <button class="library-topic-open" type="button" data-library-filter="${esc(area)}"
              aria-label="View ${esc(labels[area] || area.replace(/_/g, " "))} exercises">
              <span class="row"><span class="library-icon">${libraryIcon(area)}</span>
                <span><span class="eyebrow">${esc(labels[area] || area.replace(/_/g, " "))}</span>
                  <strong>${esc(topic.title)}</strong></span></span>
              <span class="small muted">${esc(topic.rationale)}</span>
              <span class="topic-open-hint">View exercises <span aria-hidden="true">→</span></span>
            </button>
            <div class="row library-topic-actions">
              <button class="btn subtle" data-library-start="${esc(area)}">Build a reset</button>
            </div>
            <details><summary>Evidence and camera limits</summary>
              <p class="tiny muted"><strong>Camera can check:</strong>
                ${esc((topic.camera?.checks || []).join(" · "))}</p>
              <p class="tiny muted">${esc(topic.camera?.limitation || "")}</p>
              <div class="topic-sources">${(topic.sources || []).map((source) =>
                `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">
                  ${esc(source.organization)} · ${esc(source.title)} ↗</a>`).join("")}</div>
            </details>
          </article>`;
        }).join("")}
      </div>
    </section>

    <section class="stack library-section" id="exerciseLibrary" aria-labelledby="exercisesTitle">
      <div class="library-section-head">
        <div class="stack-sm">
          <span class="eyebrow">Approved movement catalog</span>
          <h2 id="exercisesTitle">Exercise guides</h2>
          <p class="small muted">The only movements the agent can select — it cannot invent one.</p>
        </div>
        <label class="library-search">
          <span class="tiny">Search exercises</span>
          <input id="librarySearch" type="search" placeholder="Try “wrist”, “eyes”, or “seated”">
        </label>
      </div>
      <div class="library-filters" id="libraryFilters" aria-label="Filter exercise guides">
        <button class="chip" data-area="all" aria-pressed="true">All</button>
        ${areas.map((area) => {
          const n = moves.filter((m) => m.area === area).length;
          return `<button class="chip" data-area="${esc(area)}" aria-pressed="false">
            ${esc(labels[area] || area.replace(/_/g, " "))} <span class="chip-count">${n}</span></button>`;
        }).join("")}
        <button class="chip" data-area="new" aria-pressed="false">New to you
          <span class="chip-count">${newCount}</span></button>
      </div>
      <p class="small muted" id="libraryCount" aria-live="polite">${moves.length} exercises</p>
      <div class="exercise-library-grid" id="exerciseCards">
        ${moves.map((move) => {
          const search = [move.name, move.area, ...(move.targets || []), move.cues?.setup, move.cues?.during]
            .filter(Boolean).join(" ").toLowerCase();
          const hist = practiced[move.key];
          const mus = move.muscles || {};
          return `<article class="card exercise-guide-card stack-sm"
            data-area="${esc(move.area)}" data-search="${esc(search)}"
            data-practised="${hist ? "yes" : "no"}">
            <div class="exercise-guide-head">
              <span class="library-icon">${libraryIcon(move.area)}</span>
              <div><h3>${esc(move.name || move.key.replace(/_/g, " "))}</h3>
                <div class="row">
                  <span class="pill">${esc(move.seconds || "—")} sec</span>
                  <span class="pill">${move.seated_ok === false ? "Standing" : "Seated option"}</span>
                  <span class="pill">${esc(move.intensity || "gentle")}</span>
                </div></div>
              ${hist
                ? `<span class="practice-badge" title="You have done this movement ${hist.practiced} times">
                     ${hist.practiced}×</span>`
                : `<span class="practice-badge new" title="You have not tried this yet">New</span>`}
            </div>
            ${mus.primary?.length
              ? `<p class="exercise-muscles">${esc(mus.primary.join(" · "))}</p>`
              : `<p class="exercise-muscles">${esc((move.targets || []).join(" · "))}</p>`}
            <button class="btn subtle exercise-demo-button" type="button"
              data-demo-move="${esc(move.key)}">How to do it</button>
          </article>`;
        }).join("")}
      </div>
      <div class="notice small" id="libraryEmpty" hidden>
        <strong>No exercise guides match that search.</strong>
        Try a body area such as neck, hips, wrists, eyes, or glutes.
      </div>
    </section>

    <dialog class="exercise-demo-dialog" id="exerciseDemo" aria-labelledby="demoTitle">
      <div class="exercise-demo-shell">
        <div class="exercise-demo-head">
          <div><span class="eyebrow">Generated movement demo</span>
            <h2 id="demoTitle">Exercise demo</h2></div>
          <button class="btn subtle" id="demoClose" type="button" aria-label="Close exercise demo">Close</button>
        </div>
        <div class="exercise-demo-layout">
          <div class="exercise-demo-stage" id="demoStage"></div>
          <div class="stack">
            <div class="row" id="demoMeta"></div>
            <div class="exercise-instruction">
              <span>Set up</span><p id="demoSetup"></p>
            </div>
            <div class="exercise-instruction">
              <span>Focus on</span><p id="demoDuring"></p>
            </div>
            <div class="exercise-instruction" id="demoFeel" hidden></div>
            <div class="notice small"><strong>Comfort first.</strong>
              This animation shows movement direction, not a clinical range target.
              Move slowly and stop if a movement causes or worsens pain.</div>
            <div class="row">
              <button class="btn secondary" id="demoPause" type="button" aria-pressed="false">Pause animation</button>
              <button class="btn" id="demoReset" type="button">Build a reset</button>
            </div>
          </div>
        </div>
      </div>
    </dialog>

    <details class="card library-governance">
      <summary><span><strong>How this educational content is governed</strong>
        <small>Sources, review status, and local-agent boundaries</small></span></summary>
      <div class="grid cols-3">
        <div><span class="eyebrow">Source-grounded</span>
          <p class="small muted">Each topic links to the organization and resource used
            for the general-wellness rationale.</p></div>
        <div><span class="eyebrow">Approved actions only</span>
          <p class="small muted">The agent chooses from this catalog. Exercise setup and
            safety cues are authored in the knowledge base.</p></div>
        <div><span class="eyebrow">Local and separate</span>
          <p class="small muted">Your personal history is not added to the shared content
            library. Camera frames remain session-only.</p></div>
      </div>
    </details>
  </div>`);

  const cards = [...wrap.querySelectorAll(".exercise-guide-card")];
  const filters = [...wrap.querySelectorAll("#libraryFilters [data-area]")];
  const search = $("#librarySearch", wrap);
  const count = $("#libraryCount", wrap);
  const empty = $("#libraryEmpty", wrap);
  let activeArea = "all";

  const applyLibraryFilter = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      // "new" is a cross-cutting filter, not a body area — it answers "what
      // haven't I tried?", which is the question a catalog usually can't.
      const areaMatch =
        activeArea === "all" ||
        (activeArea === "new"
          ? card.dataset.practised === "no"
          : card.dataset.area === activeArea);
      const searchMatch = !query || card.dataset.search.includes(query);
      card.hidden = !(areaMatch && searchMatch);
      if (!card.hidden) visible += 1;
    });
    count.textContent = `${visible} ${visible === 1 ? "exercise" : "exercises"}`;
    empty.hidden = visible !== 0;
  };

  const setArea = (area, scroll = false) => {
    activeArea = area;
    filters.forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.area === area)));
    applyLibraryFilter();
    if (scroll) $("#exerciseLibrary", wrap).scrollIntoView({ behavior: "smooth", block: "start" });
  };

  filters.forEach((button) =>
    button.addEventListener("click", () => setArea(button.dataset.area)));

  // Deep links from My insights: land on the area (or the movement) the user
  // clicked, rather than dropping them at the top of a 26-item catalog.
  if (S.learnArea) {
    setArea(S.learnArea, true);
    S.learnArea = null;
  }
  if (S.learnMove) {
    const target = S.learnMove;
    S.learnMove = null;
    requestAnimationFrame(() =>
      wrap.querySelector(`[data-demo-move="${CSS.escape(target)}"]`)?.click());
  }
  wrap.querySelectorAll("[data-library-filter]").forEach((button) =>
    button.addEventListener("click", () => setArea(button.dataset.libraryFilter, true)));
  wrap.querySelectorAll("[data-library-start]").forEach((button) =>
    button.addEventListener("click", () => {
      S.intake.symptom = button.dataset.libraryStart;
      S.intake.touched.symptom = true;
      go("home");
    }));
  const dialog = $("#exerciseDemo", wrap);
  let demoMove = null;
  wrap.querySelectorAll("[data-demo-move]").forEach((button) =>
    button.addEventListener("click", () => {
      demoMove = moves.find((move) => move.key === button.dataset.demoMove);
      if (!demoMove) return;
      $("#demoTitle", wrap).textContent = demoMove.name || demoMove.key.replace(/_/g, " ");
      $("#demoStage", wrap).innerHTML = movementGuideMarkup(demoMove.key);
      $("#demoMeta", wrap).innerHTML = `
        <span class="pill">${esc(demoMove.seconds || "—")} sec</span>
        <span class="pill">${demoMove.seated_ok === false ? "Standing" : "Seated option"}</span>
        <span class="pill">${esc(demoMove.intensity || "gentle")}</span>`;
      $("#demoSetup", wrap).textContent =
        demoMove.cues?.setup || "Follow the coach's setup cue.";
      $("#demoDuring", wrap).textContent =
        demoMove.cues?.during || "Move slowly in a comfortable range.";
      // The cards are scannable summaries now, so the anatomy detail they used
      // to carry lives here — read once, when the user has chosen this move.
      const demoFeel = $("#demoFeel", wrap);
      if (demoFeel) {
        const dm = demoMove.muscles || {};
        demoFeel.hidden = !dm.feel;
        if (dm.feel) {
          demoFeel.innerHTML =
            `<span>Where you should feel it</span><p>${esc(dm.feel)}.` +
            (dm.not_feel ? ` <em>Not ${esc(dm.not_feel)}.</em>` : "") + `</p>`;
        }
      }
      $("#demoPause", wrap).textContent = "Pause animation";
      $("#demoPause", wrap).setAttribute("aria-pressed", "false");
      $("#demoStage", wrap).classList.remove("paused");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }));
  $("#demoClose", wrap).addEventListener("click", () => dialog.close());
  $("#demoPause", wrap).addEventListener("click", (event) => {
    const paused = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(paused));
    event.currentTarget.textContent = paused ? "Play animation" : "Pause animation";
    $("#demoStage", wrap).classList.toggle("paused", paused);
  });
  $("#demoReset", wrap).addEventListener("click", () => {
    if (!demoMove) return;
    S.intake.symptom = demoMove.area;
    S.intake.touched.symptom = true;
    dialog.close();
    go("home");
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  search.addEventListener("input", applyLibraryFilter);
  $("#libraryReset", wrap).addEventListener("click", () => go("home"));

  return wrap;
}

function viewHelp() {
  const wrap = el(`<div class="stack">
    <div class="stack-sm measure">
      <span class="eyebrow">Help &amp; safety</span>
      <h1>What do you need help with?</h1>
      <p class="muted">Short, task-focused answers for completing a reset or fixing a problem.</p>
    </div>

    <div class="grid help-grid">
      <section class="card stack-sm">
        <h2>Take a reset</h2>
        <ol class="help-steps">
          <li>Choose the area that needs attention.</li>
          <li>Confirm your time and whether you can stand.</li>
          <li>Review the plan, then start with or without camera guidance.</li>
          <li>Finish with Better, Same, or Worse so the next plan adapts.</li>
        </ol>
        <button class="btn" id="helpReset">Start a new reset</button>
      </section>

      <section class="card stack-sm">
        <h2>The camera cannot see me</h2>
        <ul class="help-steps">
          <li>Allow camera access in the browser.</li>
          <li>Use even lighting and keep the requested body area visible.</li>
          <li>For standing movements, step back until feet and knees are in frame.</li>
          <li>If it still fails, continue by timer—camera guidance is optional.</li>
        </ul>
      </section>

      <section class="card stack-sm">
        <h2>Local AI is unavailable</h2>
        <ul class="help-steps">
          <li>Check the status badge at the top of the page.</li>
          <li>Confirm the GB10 app and local models are running.</li>
          <li>Reconnect the secure tunnel, then reload this page.</li>
          <li>Your camera stops sending frames when the connection closes.</li>
        </ul>
      </section>

      <section class="card stack-sm">
        <h2>Stop or change a reset</h2>
        <p class="small muted">Use Pause, Skip move, or End at any time. Before starting,
          choose Change request to return to the check-in without saving a session.</p>
        <p class="small muted">Stop for sharp or worsening pain, dizziness, numbness,
          weakness, breathing difficulty, chest pain, or loss of balance.</p>
      </section>

      <section class="card stack-sm">
        <h2>Privacy controls</h2>
        <p class="small muted">Camera guidance is optional. Raw frames are processed in
          memory on the GB10 and discarded. The employee app does not expose a workplace
          dashboard or share your session history.</p>
        <button class="btn secondary" id="helpSettings">Open privacy settings</button>
      </section>

      <section class="card stack-sm">
        <h2>Why was this recommended?</h2>
        <p class="small muted">Open <strong>Why this reset?</strong> on the plan screen to
          see personalization, camera limitations, review status, and supporting sources.</p>
        <button class="btn secondary" id="helpLibrary">Open wellness library</button>
      </section>
    </div>

    <div class="notice small"><strong>Keyboard shortcut:</strong>
      Ctrl/⌘ + Enter builds a reset from the check-in text box.</div>
  </div>`);
  $("#helpReset", wrap).addEventListener("click", () => {
    if (!S.onboarded) finishOnboarding();
    else go("home");
  });
  $("#helpSettings", wrap).addEventListener("click", () => {
    if (!S.onboarded) finishOnboarding();
    go("settings");
  });
  $("#helpLibrary", wrap).addEventListener("click", () => go("knowledge"));
  return wrap;
}

function viewSettings() {
  const h = S.health;
  const wrap = el(`<div class="stack">
    <div class="row settings-title">
      <div class="stack-sm"><span class="eyebrow">Personal controls</span><h1>Settings</h1></div>
      <button class="btn secondary" id="helpCenter">Help &amp; safety</button>
    </div>

    <div class="card stack">
      <h2>Coaching</h2>
      <div class="stack-sm"><span class="eyebrow">Coach style</span>
        <div class="grid option-grid" id="style"></div></div>
      <div class="stack-sm"><span class="eyebrow">Default session length</span>
        <div class="row" id="dur"></div></div>
      <div class="notice small"><strong>Coaching mode is chosen per session.</strong>
        Visual Coach stays quiet; Conversational Coach adds local Piper speech and
        Whisper questions without sending audio to an external AI service.</div>
    </div>

    <div class="card stack">
      <h2>Camera &amp; privacy</h2>
      <div class="row"><span class="pill good">Health-data consent recorded locally · ${esc(CONSENT_VERSION)}</span>
        <button class="btn subtle" id="privacyCenter">Open privacy center</button></div>
      <div class="switch"><div class="txt"><strong>Watch mode</strong>
        <span class="small muted">Off by default. When on, FlowReset tracks accumulated sitting
        and neck time and <em>offers</em> a reset — it never starts one, and it stops asking if
        you decline. Turning it off clears what it accumulated.</span></div>
        <button class="toggle" id="watch" aria-pressed="${S.prefs.watch_mode}" aria-label="Watch mode"></button></div>
      <div class="row">
        <button class="btn secondary" id="export">Export my data</button>
        <button class="btn subtle" id="wipe" style="color:var(--rose)">Delete all my local data</button>
        <button class="btn subtle" id="withdraw">Withdraw future consent</button>
      </div>
    </div>

    <div class="card stack">
      <h2>Where the AI runs</h2>
      <div class="stack-sm small">
        <div class="row"><span class="pill ${S.preview ? "warn" : h?.llm?.reachable ? "good" : "warn"}">
          language</span> <code>${esc(h?.llm?.reason_model || "—")}</code>
          <span class="muted">@ ${esc(h?.llm?.endpoint || "—")}</span></div>
        <div class="row"><span class="pill ${h?.pose?.available ? "good" : "warn"}">vision</span>
          <code>${esc(h?.pose?.model || "—")}</code></div>
        <div class="row"><span class="pill ${h?.tts?.available ? "good" : ""}">voice</span>
          <code>${esc(h?.tts?.engine || "—")}</code></div>
        <div class="row"><span class="pill">runtime</span><code>${esc(h?.runtime?.runtime || "—")}</code></div>
        <div class="row"><span class="pill good">external AI APIs</span><code>none configured</code></div>
        <div class="row"><span class="pill good">frames stored</span><code>${h?.pose?.frames_stored ?? 0}</code></div>
      </div>
      <p class="tiny muted">Tools available to the agent:
        ${esc((h?.runtime?.tools || []).join(", ") || "—")}</p>
    </div>

    <p class="tiny muted">FlowReset offers movement breaks and form awareness. It is not medical
      care and does not diagnose or treat anything. For pain that is severe, persistent, or
      worsening — or numbness, weakness, or vision changes — please see a healthcare professional.</p>
  </div>`);

  STYLES.forEach((s) => {
    const b = el(`<button class="option" type="button" aria-pressed="${S.prefs.coach_style === s.key}">
      <strong>${esc(s.label)}</strong><span class="small muted">${esc(s.hint)}</span></button>`);
    b.addEventListener("click", () => {
      S.prefs.coach_style = s.key;
      [...$("#style", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      savePrefs();
    });
    $("#style", wrap).append(b);
  });

  [1, 2, 3, 5, 10].forEach((m) => {
    const b = el(`<button class="chip" type="button" aria-pressed="${S.prefs.preferred_duration_min === m}">${m} min</button>`);
    b.addEventListener("click", () => {
      S.prefs.preferred_duration_min = m;
      [...$("#dur", wrap).children].forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      savePrefs();
    });
    $("#dur", wrap).append(b);
  });

  const toggle = (id, key, extra) => {
    const b = $(`#${id}`, wrap);
    b.addEventListener("click", () => {
      S.prefs[key] = !S.prefs[key];
      b.setAttribute("aria-pressed", String(S.prefs[key]));
      savePrefs();
      if (extra) extra(S.prefs[key]);
    });
  };
  toggle("watch", "watch_mode", (on) => send({ type: "watch_mode", on }));

  $("#privacyCenter", wrap).addEventListener("click", () => { S.returnTo = "settings"; go("privacy"); });
  $("#helpCenter", wrap).addEventListener("click", () => go("help"));
  $("#export", wrap).addEventListener("click", exportMyData);
  $("#wipe", wrap).addEventListener("click", deleteMyData);
  $("#withdraw", wrap).addEventListener("click", withdrawHealthConsent);

  return wrap;
}

async function exportMyData() {
  try {
    const data = mock ? { prefs: S.prefs, sessions: mock.sessions } :
      await fetch("/api/export").then((r) => {
        if (!r.ok) throw new Error("export failed");
        return r.json();
      });
    data.consent = {
      accepted: S.healthConsent,
      accepted_at: S.healthConsentAt,
      notice_version: CONSENT_VERSION,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "flowreset-export.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Your FlowReset data export is ready.", "status");
  } catch {
    showToast("FlowReset could not export your data. Check the local connection and try again.", "error");
  }
}

async function deleteMyData() {
  if (!confirm("Delete all local preferences and session history? This cannot be undone.")) return;
  if (mock) {
    mock.sessions = [];
    mock.prefs = { ...mock.prefs, concerns: "" };
  } else {
    const response = await fetch("/api/history", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      showToast("FlowReset could not delete your data. Check the local connection and try again.", "error");
      return;
    }
  }
  localStorage.removeItem("flowreset.onboarded");
  localStorage.removeItem("flowreset.healthDataConsent");
  localStorage.removeItem("flowreset.healthDataConsentVersion");
  localStorage.removeItem("flowreset.healthDataConsentAt");
  S.onboarded = false;
  S.healthConsent = false;
  S.healthConsentAt = null;
  S.dashboard = null;
  showToast("Your local preferences and session history were deleted.", "status");
  go("welcome");
}

function withdrawHealthConsent() {
  if (!confirm(
    "Withdraw consent for future wellness-data collection? Existing local data remains " +
    "until you export or delete it, and FlowReset cannot run new personalized sessions."
  )) return;
  S.healthConsent = false;
  S.healthConsentAt = null;
  S.prefs.watch_mode = false;
  localStorage.removeItem("flowreset.healthDataConsent");
  localStorage.removeItem("flowreset.healthDataConsentVersion");
  localStorage.removeItem("flowreset.healthDataConsentAt");
  savePrefs();
  stopCamera();
  S.consentNext = "home";
  go("consent");
}

function infoBack(fallback = "welcome") {
  const target = S.returnTo && !["privacy", "safety", "terms"].includes(S.returnTo)
    ? S.returnTo : fallback;
  S.returnTo = null;
  go(target);
}

function viewPrivacy() {
  const wrap = el(`<div class="trust-page stack">
    <div class="row"><button class="btn subtle" id="privacyBack">← Back</button>
      <span class="pill info">Prototype notice · July 26, 2026</span></div>
    <div class="stack-sm measure"><span class="eyebrow">Consumer health data privacy</span>
      <h1>What FlowReset collects—and what it does not</h1>
      <p class="hero-lede">This standalone notice explains the current local prototype.
        It is written for employees, not lawyers.</p></div>

    <section class="card stack">
      <h2>Data map</h2>
      <div class="table-scroll"><table class="data-map">
        <thead><tr><th>Data</th><th>Source</th><th>Purpose</th><th>Current retention</th></tr></thead>
        <tbody>
          <tr><td>Goals, preferences, optional concerns</td><td>You</td>
            <td>Personalize resets</td><td>On this GB10 until changed or deleted</td></tr>
          <tr><td>Body area, routine, duration, completion, response</td><td>Your sessions</td>
            <td>Run sessions and create My insights</td><td>On this GB10 until deleted</td></tr>
          <tr><td>Camera frames and pose landmarks</td><td>Optional webcam</td>
            <td>Session-only movement feedback</td><td>Memory only; discarded during processing</td></tr>
          <tr><td>Voice recording</td><td>Optional microphone</td>
            <td>Local transcription of your request</td><td>Temporary file deleted after transcription</td></tr>
          <tr><td>Consent state, notice version, timestamp</td><td>You</td>
            <td>Gate future collection and document the notice accepted</td>
            <td>Browser-local until withdrawn or deleted; included in export</td></tr>
        </tbody>
      </table></div>
    </section>

    <div class="grid cols-2">
      <section class="card stack-sm"><h2>Sharing and sale</h2>
        <ul class="policy-list">
          <li>No external AI API receives your data.</li>
          <li>No advertising, data broker, or sale of consumer health data.</li>
          <li>Your employer cannot see individual concerns, body areas, responses,
            sessions, camera, voice, or video.</li>
          <li>The employee app has no employer dashboard or workplace-sharing control.</li>
        </ul></section>
      <section class="card stack-sm"><h2>Your controls</h2>
        <ul class="policy-list">
          <li>Camera permission is requested separately for each session.</li>
          <li>Export a readable copy of preferences and session history.</li>
          <li>Delete all local data or withdraw consent for future collection.</li>
        </ul>
        <div class="row">
          <button class="btn secondary" id="privacyExport">Export my data</button>
          <button class="btn subtle" id="privacyDelete" style="color:var(--rose)">Delete all data</button>
        </div></section>
    </div>

    <section class="notice small stack-sm">
      <strong>HIPAA and production deployment</strong>
      <p>HIPAA applicability depends on whether FlowReset is offered through a covered
        health plan or another covered entity and on the operator's relationships. This
        hackathon prototype does not claim HIPAA compliance or certification. A production
        pilot still requires verified operator contact details, identity and access controls,
        encryption-at-rest review, retention automation, incident response, and legal review.</p>
    </section>
  </div>`);
  $("#privacyBack", wrap).addEventListener("click", () => infoBack(S.healthConsent ? "settings" : "welcome"));
  $("#privacyExport", wrap).addEventListener("click", exportMyData);
  $("#privacyDelete", wrap).addEventListener("click", deleteMyData);
  return wrap;
}

function viewSafety() {
  const wrap = el(`<div class="trust-page stack">
    <div class="row"><button class="btn subtle" id="safetyBack">← Back</button>
      <span class="pill warn">General wellness only</span></div>
    <div class="stack-sm measure"><span class="eyebrow">Wellness &amp; safety disclaimer</span>
      <h1>Movement awareness—not medical assessment</h1>
      <p class="hero-lede">FlowReset provides short movement and screen-rest breaks for
        adults. It does not diagnose, treat, cure, prevent, or monitor a disease or injury.</p></div>

    <div class="grid cols-2">
      <section class="card stack-sm"><h2>Use FlowReset when</h2>
        <ul class="policy-list">
          <li>You want a voluntary general-wellness break during desk work.</li>
          <li>You can move within a comfortable, pain-free range.</li>
          <li>You have a stable chair, suitable clothing, and clear floor space.</li>
          <li>You understand camera feedback checks broad visible movement signals only.</li>
        </ul></section>
      <section class="card stack-sm safety-stop"><h2>Stop and seek help when</h2>
        <ul class="policy-list">
          <li>A movement causes sharp, new, or worsening pain.</li>
          <li>You experience dizziness, faintness, chest pain, breathing difficulty,
            numbness, weakness, loss of balance, or new vision changes.</li>
          <li>Symptoms are severe, persistent, recurring, or follow an injury.</li>
          <li>For a possible emergency, stop and contact local emergency services.</li>
        </ul></section>
    </div>

    <section class="card stack"><h2>Important limitations</h2>
      <div class="consent-grid">
        <div><strong>Not physical therapy</strong><span>No diagnosis, rehabilitation
          plan, prescription, or individualized medical advice.</span></div>
        <div><strong>Camera is not a clinician</strong><span>It can miss unsafe form,
          occlusion, pain, mobility limits, and conditions that are not visible.</span></div>
        <div><strong>No guaranteed outcome</strong><span>A completed reset or positive
          score does not prove that a movement is safe or effective for you.</span></div>
        <div><strong>Your choice</strong><span>Participation and camera use are voluntary.
          Seated and timer-only alternatives are available.</span></div>
      </div>
    </section>
  </div>`);
  $("#safetyBack", wrap).addEventListener("click", () => infoBack(S.healthConsent ? "home" : "welcome"));
  return wrap;
}

function viewTerms() {
  const wrap = el(`<div class="trust-page stack">
    <div class="row"><button class="btn subtle" id="termsBack">← Back</button>
      <span class="pill">Hackathon prototype</span></div>
    <div class="stack-sm measure"><span class="eyebrow">Prototype use terms</span>
      <h1>Use FlowReset as a voluntary wellness aid</h1>
      <p class="hero-lede">These plain-language terms set the boundaries for demonstrating
        and evaluating this prototype.</p></div>

    <section class="card stack">
      <div class="consent-grid">
        <div><strong>Adults only</strong><span>FlowReset is designed for adults 18 and
          older who can choose whether and how to participate.</span></div>
        <div><strong>Not healthcare</strong><span>Do not use it for diagnosis, treatment,
          rehabilitation, emergency help, or as a substitute for a qualified professional.</span></div>
        <div><strong>Use safely</strong><span>Clear your space, use a stable chair, stay
          within a comfortable range, and stop if symptoms appear or worsen.</span></div>
        <div><strong>No guaranteed result</strong><span>AI and camera feedback may be
          incomplete or wrong. A displayed cue is not proof that movement is safe.</span></div>
        <div><strong>Voluntary at work</strong><span>Employers must not require camera use,
          use personal wellness information for employment decisions, or retaliate for opting out.</span></div>
        <div><strong>Prototype availability</strong><span>The hackathon build may change,
          fail, or be unavailable and has not completed production security or clinical review.</span></div>
      </div>
      <div class="notice small">By using the prototype, you acknowledge these boundaries.
        A production release requires verified operator identity, governing-law terms,
        accessibility commitments, support contacts, and counsel-approved language.</div>
    </section>
  </div>`);
  $("#termsBack", wrap).addEventListener("click", () => infoBack(S.healthConsent ? "home" : "welcome"));
  return wrap;
}

/* ─────────────────────── voice input (P1) ───────────────────────
 *
 * Records with MediaRecorder and POSTs the audio to the box, where local
 * Whisper transcribes it. Deliberately NOT the Web Speech API: that streams
 * microphone audio to Google and would break both the competition rule and
 * every privacy claim we make. See server/stt.py.
 */

let recorder = null;
let recordedChunks = [];

function sttAvailable() {
  return !S.preview && !!S.health?.stt?.available && !!navigator.mediaDevices?.getUserMedia;
}

/** Wire a mic button to a target field. The optional callback lets a session
 * transcript go straight to the local Q&A agent after Whisper finishes. */
function bindMic(button, textarea, statusEl, onTranscript = null, options = {}) {
  if (!button) return;
  const idleLabel = options.idleLabel || "🎤 Speak instead";

  if (!sttAvailable()) {
    if (options.keepVisible) {
      button.disabled = true;
      button.textContent = "Voice on GB10";
      button.title = "Local Whisper voice input becomes available when connected to the GB10.";
    } else {
      button.hidden = true;
    }
    if (statusEl && S.preview) {
      statusEl.textContent = options.keepVisible
        ? "Conversation is simulated here; Whisper and Piper connect on the GB10."
        : "Voice input needs the box — type instead for now.";
    } else if (statusEl && S.health?.stt?.error) {
      statusEl.textContent = "Voice input unavailable — type instead.";
    }
    return;
  }

  const setState = (label, pressed) => {
    button.textContent = label;
    button.setAttribute("aria-pressed", String(pressed));
  };

  button.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (statusEl) statusEl.textContent = "No microphone access — type instead.";
      return;
    }

    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    if (onTranscript) {
      S.voiceState = "listening";
      paintVoiceCoach();
    }
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size) recordedChunks.push(e.data);
    });
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("Transcribing…", false);
      if (onTranscript) {
        S.voiceState = "thinking";
        paintVoiceCoach();
      }
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      const b64 = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1]);
        fr.readAsDataURL(blob);
      });
      let result = { ok: false };
      try {
        result = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audio: b64 }),
        }).then((r) => r.json());
      } catch {
        /* fall through to the error path below */
      }
      setState(idleLabel, false);
      if (result.ok && result.text) {
        textarea.value = textarea.value ? `${textarea.value} ${result.text}` : result.text;
        if (onTranscript) {
          const transcript = textarea.value;
          textarea.value = "";
          if (statusEl) statusEl.textContent = "Transcribed locally. Asking your coach…";
          onTranscript(transcript);
        } else if (statusEl) {
          statusEl.textContent = "Transcribed on the box. Edit it if you like.";
        }
      } else if (statusEl) {
        if (onTranscript) S.voiceState = "ready";
        statusEl.textContent = result.error ? "Didn't catch that — try again or type it." : "";
        paintVoiceCoach();
      }
    });

    recorder.start();
    setState("⏹ Stop recording", true);
    if (statusEl) statusEl.textContent = "Recording. Audio is transcribed on the box, not stored.";
  });
}

window.addEventListener("beforeunload", stopCamera);
boot();
