/* FlowReset UI.
 *
 * Renders `state` + `coach` messages from ws://<box>:8000/ws. Holds no product
 * logic of its own: which moves exist, which routine fits, and what to say all
 * come from the agent on the box. The browser captures, displays, and counts
 * down — it runs no inference.
 */

import { MockBackend } from "./mock.js";
import { SKELETON_EDGES, drawSkeleton } from "./overlay.js";
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

/* Preview mode can be requested deliberately — `?preview` in the URL, or the
   flag set by scripts/build-preview.py in the single-file bundle — instead of
   being inferred from a failed socket. Useful for sharing screens and for
   working on the UI with the box switched off. */
const FORCE_PREVIEW =
  new URLSearchParams(location.search).has("preview") || window.__FLOWRESET_PREVIEW === true;

const NAV = [
  { key: "home", label: "Reset" },
  { key: "dashboard", label: "Progress" },
  { key: "workspace", label: "Workspace" },
];

// ─────────────────────────────── state ───────────────────────────────

const S = {
  screen: "welcome",
  connected: false,
  preview: false,
  health: null,
  prefs: {
    goal: "reduce_stiffness",
    common_areas: ["neck_shoulders"],
    can_stand: true,
    preferred_duration_min: 3,
    coach_style: "supportive",
    voice: true,
    watch_mode: false,
    workspace_opt_in: true,
    team: "Engineering",
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
  cameraOn: false,
  planning: false,
  dashboard: null,
  workspace: null,
  knowledge: null,
  trace: [],
  completed: false,
  response: null,
  insight: null,
  videoStatus: null,
  onboarded: localStorage.getItem("flowreset.onboarded") === "1",
};

let socket = null;
let mock = null;
let videoStream = null;
let frameTimer = null;
let planningTimer = null;
let toastTimer = null;

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
    const [health, prefs, dash, knowledge] = await Promise.all([
      fetch("/api/health").then((r) => r.json()).catch(() => null),
      fetch("/api/prefs").then((r) => r.json()).catch(() => null),
      fetch("/api/dashboard").then((r) => r.json()).catch(() => null),
      fetch("/api/knowledge").then((r) => r.json()).catch(() => null),
    ]);
    if (health) S.health = health;
    if (prefs) S.prefs = { ...S.prefs, ...prefs };
    if (dash) S.dashboard = dash;
    if (knowledge) S.knowledge = knowledge;
  } else {
    socket = null;
    S.preview = true;
    mock = new MockBackend(handle);
    S.health = mock.health();
    S.dashboard = mock.dashboard();
    S.workspace = mock.workspace();
    S.knowledge = mock.knowledge();
  }

  S.intake.duration_min = S.prefs.preferred_duration_min;
  S.intake.can_stand = S.prefs.can_stand;
  S.screen = S.onboarded ? "home" : "welcome";
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
      S.live = msg.session;
      S.keypoints = msg.keypoints || [];
      S.framing = msg.framing;
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
        if (S.screen === "session") paintCue();
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
      if (S.prefs.voice) new Audio(`data:audio/wav;base64,${msg.wav_b64}`).play().catch(() => {});
      break;

    case "video_ai":
      S.videoStatus = msg;
      if (S.screen === "session") {
        S.cue = msg.text;
        paintCue();
        paintVideoStatus();
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
    go(S.onboarded ? "home" : "welcome");
  });
  $("#settingsShortcut").addEventListener("click", () => {
    if (S.screen !== "session" && S.onboarded) go("settings");
  });
  markNav();
}

function markNav() {
  const open = S.onboarded ? NAV.map((n) => n.key) : [];
  const active = ["plan", "session", "complete", "escalate"].includes(S.screen) ? "home" : S.screen;
  [...$("#nav").children].forEach((b, i) => {
    const key = NAV[i].key;
    b.hidden = !open.includes(key);
    b.disabled = S.screen === "session";
    if (key === active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const settings = $("#settingsShortcut");
  settings.hidden = !S.onboarded;
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
  if (screen === "workspace" && !S.workspace) loadWorkspace();
  if (screen === "dashboard" && !S.dashboard) loadDashboard();
  if (screen === "knowledge" && !S.knowledge) loadKnowledge();
  S.screen = screen;
  render();
}

async function loadDashboard() {
  if (mock) { S.dashboard = mock.dashboard(); return; }
  S.dashboard = await fetch("/api/dashboard").then((r) => r.json()).catch(() => null);
}

async function loadWorkspace() {
  if (mock) { S.workspace = mock.workspace(); render(); return; }
  S.workspace = await fetch("/api/workspace").then((r) => r.json()).catch(() => null);
  render();
}

async function loadKnowledge() {
  if (mock) { S.knowledge = mock.knowledge(); render(); return; }
  S.knowledge = await fetch("/api/knowledge").then((r) => r.json()).catch(() => null);
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
    goals: viewGoals,
    prefs: viewPrefs,
    home: viewHome,
    plan: viewPlan,
    session: viewSession,
    complete: viewComplete,
    escalate: viewEscalate,
    dashboard: viewDashboard,
    knowledge: viewKnowledge,
    workspace: viewWorkspace,
    settings: viewSettings,
    help: viewHelp,
  }[S.screen];
  app.append(view());
  if (S.screen === "session") { paintSession(); paintCue(); }
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
        <div class="step"><strong>Visible progress</strong>
          <p class="small muted">Rate the result and track consistency, outcomes, and body-area patterns.</p></div>
      </div>
      <div class="welcome-trust">
        <span>✓ All AI runs locally on the GB10</span>
        <span>✓ Camera is optional for every session</span>
        <span>✓ General wellness—not medical care</span>
      </div>
    </section>

    <section class="band sunk" style="border-radius:20px" hidden>
      <div class="section">
        <div class="dash-grid">
          <div class="stack">
            <div class="stack-sm measure">
              <h2>Why this runs locally</h2>
              <p class="muted">Not a deployment detail — it's the reason the product is usable at
                all. A camera-guided wellbeing workflow handles the most personal data there is.</p>
            </div>
            <ul class="privacy-list">
              <li><span class="ico">🖥️</span><div><strong>Everything runs on this machine.</strong>
                <div class="small muted">Language model, pose model, agent reasoning, memory, and
                voice all execute on the Dell Pro Max with GB10. No external AI API is called, ever
                — the code refuses a non-local inference endpoint at startup.</div></div></li>
              <li><span class="ico">📷</span><div><strong>The camera is off until you turn it on.</strong>
                <div class="small muted">Guidance is optional and per-session. When it's on, frames
                are analysed in memory and dropped immediately. Nothing is recorded, queued, or
                written to disk.</div></div></li>
              <li><span class="ico">⚡</span><div><strong>Cues arrive while you're moving.</strong>
                <div class="small muted">No round trip to a datacentre, so feedback lands during
                the movement instead of after it — and it still works with the network unplugged.</div></div></li>
              <li><span class="ico">🌿</span><div><strong>This is comfort, not care.</strong>
                <div class="small muted">FlowReset offers movement breaks and form awareness. It
                does not diagnose or treat anything. For pain that is severe, persistent, or getting
                worse, please talk to a healthcare professional.</div></div></li>
            </ul>
          </div>

          <div class="card stack">
            <span class="eyebrow">For workplaces</span>
            <h3>Wellbeing your team will actually opt into</h3>
            <p class="small muted">People Ops sees aggregate engagement for people who chose to
              share it — never an individual, never video, never a symptom. Any cohort under ten
              people is suppressed in the query itself, not hidden in the interface.</p>
            <div class="grid cols-2">
              <div class="stat"><div class="num">10+</div><div class="lbl">minimum reporting cohort</div></div>
              <div class="stat"><div class="num">0</div><div class="lbl">individual records exposed</div></div>
            </div>
            <button class="btn secondary" id="toWorkspace">See the workspace view</button>
          </div>
        </div>
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

  $("#start", wrap).addEventListener("click", () => go("goals"));
  $("#start2", wrap).addEventListener("click", () => go("goals"));
  $("#skipOnboard", wrap).addEventListener("click", finishOnboarding);
  $("#skip2", wrap).addEventListener("click", finishOnboarding);
  $("#toWorkspace", wrap).addEventListener("click", () => {
    S.onboarded = true;
    localStorage.setItem("flowreset.onboarded", "1");
    go("workspace");
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
  if (mock) { Object.assign(mock.prefs, S.prefs); return; }
  fetch("/api/prefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(S.prefs),
  }).catch(() => {});
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
  const lib = mock ? mock.routines().moves : null;
  const name = (k) => lib?.[k]?.name || k.replace(/_/g, " ");
  const secs = (k) => lib?.[k]?.seconds || null;

  const wrap = el(`<div class="stack">
    <div class="row"><span class="pill info">Your reset</span>
      <span class="pill">${p.duration_min} min</span>
      <span class="pill">${p.moves.length} moves</span></div>

    <div class="card stack">
      <h1>${esc(p.symptom_label)} reset</h1>
      <p class="hero-lede">Your plan is ready. Review the sequence, then choose camera
        coaching or timer-and-voice guidance.</p>

      <ol class="plan-moves">
        ${p.moves.map((k, i) => `<li><span>${esc(p.move_names?.[i] || name(k))}</span>
          ${secs(k) ? `<span class="dur">${secs(k)}s</span>` : ""}</li>`).join("")}
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
          <li><strong>Choose guidance.</strong><span>Camera coaching is optional and processed locally; timer and voice always work.</span></li>
          <li><strong>Stay comfortable.</strong><span>Use a comfortable range and stop if movement causes or worsens pain.</span></li>
        </ol>
        <details class="camera-details">
          <summary>What the camera checks</summary>
          <p class="small muted">${esc(kb?.camera?.checks?.join(" · ") || "Visibility, pace, and broad movement signals.")}</p>
          <p class="tiny muted">${esc(kb?.camera?.limitation || "This is broad form awareness, not clinical assessment.")}</p>
        </details>
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
  $("#back", wrap).addEventListener("click", () => { S.plan = null; go("home"); });
  return wrap;
}

async function beginSession(withCamera) {
  let camera = false;
  if (withCamera) camera = await startCamera();
  S.cameraOn = camera;
  S.videoStatus = null;
  send({ type: "start_reset", camera, symptom: S.plan.symptom, duration_min: S.plan.duration_min, can_stand: S.intake.can_stand });
  S.screen = "session";
  render();
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
        </div>
        <div class="row">
          <button class="btn secondary" id="pause">Pause</button>
          <button class="btn subtle" id="skip">Skip move</button>
          <button class="btn subtle" id="stop">End</button>
        </div>
      </div>

      <div class="stack">
        <div class="video-status" id="videoStatus" data-state="${S.cameraOn ? "scanning" : "off"}">
          <span class="video-status-dot"></span>
          <div><strong>${S.cameraOn ? "Video AI is finding your position" : "Video AI is off"}</strong>
            <span>${S.cameraOn ? "Keep the relevant body area in frame." : "Timer and voice guidance remain available."}</span></div>
        </div>
        <div class="cue-banner" id="cueBanner"></div>
        <div class="cam-wrap" id="camWrap">
          <video id="cam" autoplay muted playsinline></video>
          <canvas id="overlay"></canvas>
          <div class="cam-off" id="camOff" ${S.cameraOn ? "hidden" : ""}>
            <strong>Camera is off</strong>
            <p class="small muted">Text and voice guidance only. You can turn the camera
              on at any time — or leave it off entirely.</p>
            <button class="btn secondary" id="camOn">Turn on camera guidance</button>
          </div>
          <div class="cam-flag" id="camFlag" ${S.cameraOn ? "" : "hidden"}>
            ${S.preview ? "Preview skeleton · synthetic" : "Pose on GB10 · not recorded"}
          </div>
        </div>
        <div class="row small muted" id="metrics"></div>
      </div>
    </div>
  </div>`);

  $("#pause", wrap).addEventListener("click", (e) => {
    const on = e.target.textContent === "Pause";
    e.target.textContent = on ? "Resume" : "Pause";
    send({ type: "pause", on });
  });
  $("#skip", wrap).addEventListener("click", () => send({ type: "skip" }));
  $("#stop", wrap).addEventListener("click", () => finishSession(false));
  $("#camOn", wrap).addEventListener("click", async () => {
    const ok = await startCamera();
    S.cameraOn = ok;
    send({ type: "camera", on: ok });
    $("#camOff", wrap).hidden = ok;
    $("#camFlag", wrap).hidden = !ok;
    if (!ok) {
      $("#camOff", wrap).innerHTML =
        `<strong>No camera access</strong><p class="small muted">That's completely fine —
         the routine works with text and voice guidance. Nothing else changes.</p>`;
      $("#camOff", wrap).hidden = false;
    }
  });
  paintVideoStatus();
  return wrap;
}

function paintSession() {
  const live = S.live;
  const p = S.plan;
  if (!live || !p) return;

  const lib = mock ? mock.routines().moves : null;
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
  if (nameEl) nameEl.textContent = lib?.[live.move]?.name || String(live.move || "").replace(/_/g, " ");
  const cueEl = $("#moveCue");
  if (cueEl) cueEl.textContent = lib?.[live.move]?.cues?.during || "";

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
      : `<span class="pill">Guidance: text and voice</span>`;
  }

  drawOverlay();
  paintVideoStatus();
}

function paintVideoStatus() {
  const box = $("#videoStatus");
  if (!box) return;
  if (!S.cameraOn) {
    box.dataset.state = "off";
    box.innerHTML = `<span class="video-status-dot"></span><div><strong>Video AI is off</strong>
      <span>Timer and voice guidance remain available.</span></div>`;
    return;
  }
  if (S.videoStatus) {
    box.dataset.state = S.videoStatus.status;
    box.innerHTML = `<span class="video-status-dot"></span><div><strong>Local video AI check</strong>
      <span>${esc(S.videoStatus.text)}</span></div>`;
    return;
  }
  const ready = S.framing !== "no_person" &&
    (!S.plan?.needs_full_body || S.framing === "full_body");
  box.dataset.state = ready ? "ready" : "scanning";
  box.innerHTML = `<span class="video-status-dot"></span><div>
    <strong>${ready ? "Video AI is ready" : "Video AI is finding your position"}</strong>
    <span>${ready ? "Movement stays on the GB10 and frames are discarded." : "Keep the relevant body area in frame."}</span></div>`;
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
  drawSkeleton(canvas, S.keypoints, getComputedStyle(document.body).getPropertyValue("--accent").trim());
}

async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
  } catch {
    return false;
  }
  const video = $("#cam");
  if (video) {
    video.srcObject = videoStream;
    await video.play().catch(() => {});
  }
  startFrameLoop();
  return true;
}

/* The only place camera data moves. Frames go to the box over the LAN and
   nowhere else — there is no other fetch/send of image data in this file. */
function startFrameLoop() {
  stopFrameLoop();
  if (S.preview) return; // nothing to send frames to
  const video = $("#cam");
  const scratch = document.createElement("canvas");
  scratch.width = 320;
  scratch.height = 240;
  const ctx = scratch.getContext("2d");
  frameTimer = setInterval(() => {
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
            <button class="btn" id="toDash">See progress</button>
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

  const wrap = el(`<div class="stack">
    <div class="stack-sm"><h1>Your progress</h1>
      <p class="muted">Everything here is computed on this machine from your own sessions.</p></div>

    <div class="grid stat-row">
      <div class="card stat"><div class="num">${s.sessions_completed}</div>
        <div class="lbl">resets completed · 7 days</div></div>
      <div class="card stat"><div class="num">${Math.round(s.better_rate * 100)}%</div>
        <div class="lbl">felt better afterwards</div></div>
      <div class="card stat"><div class="num">${Math.round(s.completion_rate * 100)}%</div>
        <div class="lbl">of started resets finished</div></div>
      <div class="card stat"><div class="num">${s.streak_days}</div>
        <div class="lbl">day streak</div></div>
    </div>

    <div class="dash-grid">
      <div class="card stack">
        <div class="stack-sm"><h2>Am I building the habit?</h2>
          <p class="small muted">Completed resets per day.</p></div>
        <div id="bars"></div>
      </div>

      <div class="stack">
        <div class="card stack">
          <div class="stack-sm"><h2>Is it helping?</h2>
            <p class="small muted">How you rated each completed reset.</p></div>
          <div id="split"></div>
        </div>
        <div class="card stack">
          <div class="stack-sm"><h2>Where do I need support?</h2>
            <p class="small muted">Which areas you reset most often.</p></div>
          <div id="areas"></div>
        </div>
      </div>
    </div>

    <div class="card stack">
      <div class="row"><h2>Recent sessions</h2>
        <span class="pill" style="margin-left:auto">demo history is labelled</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>When</th><th>Area</th><th>Length</th><th>Routine</th><th>Result</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
  </div>`);

  $("#bars", wrap).append(charts.dayBars(d.daily));
  $("#split", wrap).append(charts.responseSplit(s.responses));
  $("#areas", wrap).append(charts.areaBars(s.by_symptom, labels));

  const tbody = $("#rows", wrap);
  (d.recent || []).forEach((r) => {
    const when = new Date(r.started_at);
    const badge = r.response
      ? `<span class="pill ${r.response === "better" ? "good" : r.response === "worse" ? "warn" : ""}">${r.response}</span>`
      : `<span class="pill">not finished</span>`;
    tbody.append(el(`<tr data-live="${!r.is_demo}">
      <td>${when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        <span class="muted tiny">${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></td>
      <td>${esc(labels[r.symptom] || r.symptom)}</td>
      <td>${r.duration_min} min</td>
      <td class="small muted">${esc((r.moves || []).map((m) => m.replace(/_/g, " ")).join(", "))}</td>
      <td>${badge} ${r.is_demo ? "" : '<span class="pill info">this session</span>'}</td>
    </tr>`));
  });
  return wrap;
}

function viewKnowledge() {
  const kb = S.knowledge;
  if (!kb) {
    loadKnowledge();
    return el(`<div class="notice">Loading the approved wellness library…</div>`);
  }
  const wrap = el(`<div class="stack">
    <div class="library-hero card">
      <div class="stack-sm">
        <div class="row"><span class="pill good">Approved MVP content</span>
          <span class="pill">Version ${esc(kb.version)}</span>
          <span class="pill">Reviewed ${esc(kb.reviewed_at)}</span></div>
        <h1>Employee wellness library</h1>
        <p class="hero-lede">This is the source-grounded content FlowReset retrieves when it
          explains a recommendation. Personal employee history is stored separately and is
          never added to this shared library.</p>
        <div class="row">
          <a class="btn secondary link-btn"
            href="https://github.com/suyeon-cha/postureAI/blob/feat/flowreset-app/FLOWRESET_KNOWLEDGE_BASE.md"
            target="_blank" rel="noreferrer">Read the governance specification ↗</a>
        </div>
      </div>
      <div class="library-boundary"><span class="eyebrow">Product boundary</span>
        <strong>${esc(kb.audience)}</strong><p class="small">${esc(kb.boundary)}</p></div>
    </div>

    <div class="grid library-grid">
      ${kb.topics.map((topic) => `<article class="card library-topic stack-sm">
        <div class="row"><span class="library-icon">${topic.area === "tired_eyes" ? "◉" :
          topic.area === "wrists_hands" ? "⌁" : "◇"}</span>
          <div><span class="eyebrow">${esc(topic.camera.mode)}</span>
            <h2>${esc(topic.title)}</h2></div></div>
        <p class="small muted">${esc(topic.rationale)}</p>
        <details><summary>What video AI checks</summary>
          <ul>${topic.camera.checks.map((check) => `<li>${esc(check)}</li>`).join("")}</ul>
          <p class="tiny muted">${esc(topic.camera.limitation)}</p></details>
        <div class="topic-sources">${topic.sources.map((source) =>
          `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">
            ${esc(source.organization)} · ${esc(source.title)} ↗</a>`).join("")}</div>
      </article>`).join("")}
    </div>

    <div class="card privacy-architecture">
      <div class="stack-sm"><span class="eyebrow">Local data architecture</span>
        <h2>${esc(kb.privacy.title)}</h2><p class="small muted">${esc(kb.privacy.rationale)}</p></div>
      <div class="retention-grid">
        ${Object.entries(kb.privacy.retention).map(([key, value]) =>
          `<div><span>${esc(key.replace(/_/g, " "))}</span><strong>${esc(value)}</strong></div>`).join("")}
      </div>
    </div>
  </div>`);
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
          memory on the GB10 and discarded. Employer reporting contains opted-in aggregate
          totals only for groups of at least 10.</p>
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

function viewWorkspace() {
  const payload = S.workspace;
  if (!payload) { loadWorkspace(); return el(`<div class="notice">Loading workspace view…</div>`); }
  const w = payload.workspace;

  if (w.suppressed) {
    return el(`<div class="stack">
      <h1>Workspace</h1>
      <div class="notice"><strong>Nothing to report yet.</strong>
        <p class="small" style="margin-top:6px">${esc(w.reason)}</p>
        <p class="small muted" style="margin-top:6px">${w.participants} of ${w.k_anonymity} needed.</p></div>
    </div>`);
  }

  const wrap = el(`<div class="stack">
    <div class="stack-sm">
      <div class="row"><h1>Workspace</h1><span class="pill info" style="margin-left:auto">People Ops view</span></div>
      <p class="muted">Aggregate engagement for people who opted in. Last ${w.days} days.</p>
    </div>

    <div class="notice small">
      <strong>What a manager can and cannot see.</strong>
      No individual is identifiable here: every figure is a count over a cohort of at least
      ${w.k_anonymity} opted-in people, and any team below that floor is suppressed entirely
      ${w.suppressed_teams ? ` (${w.suppressed_teams} ${w.suppressed_teams === 1 ? "team is" : "teams are"} hidden for that reason)` : ""}.
      There is no per-person view, no video, no discomfort detail, and no way to request one —
      the aggregation happens in the query, not in the interface.
    </div>

    <div class="grid stat-row">
      <div class="card stat"><div class="num">${w.participants}</div><div class="lbl">people opted in</div></div>
      <div class="card stat"><div class="num">${w.per_person_per_week}</div><div class="lbl">resets per person per week</div></div>
      <div class="card stat"><div class="num">${Math.round(w.better_rate * 100)}%</div><div class="lbl">reported feeling better</div></div>
      <div class="card stat"><div class="num">${Math.round(w.completion_rate * 100)}%</div><div class="lbl">completion rate</div></div>
    </div>

    <div class="card stack">
      <div class="stack-sm"><h2>Reported outcome</h2>
        <p class="small muted">Self-reported, aggregated across ${w.sessions_completed} completed resets.</p></div>
      <div id="split"></div>
    </div>

    <div class="card stack">
      <h2>By team</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Team</th><th>Opted in</th><th>Resets</th><th>Per person / week</th><th>Completion</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
      ${w.suppressed_teams ? `<p class="tiny muted">${w.suppressed_teams} team(s) hidden:
        fewer than ${w.k_anonymity} people opted in.</p>` : ""}
    </div>
  </div>`);

  $("#split", wrap).append(charts.responseSplit(w.responses));
  (w.teams || []).forEach((t) => {
    $("#rows", wrap).append(el(`<tr>
      <td><strong>${esc(t.team)}</strong></td><td>${t.participants}</td><td>${t.sessions}</td>
      <td>${t.per_person_per_week}</td><td>${Math.round(t.completion_rate * 100)}%</td></tr>`));
  });
  return wrap;
}

function viewSettings() {
  const h = S.health;
  const wrap = el(`<div class="stack">
    <h1>Settings</h1>

    <div class="card stack">
      <h2>Coaching</h2>
      <div class="stack-sm"><span class="eyebrow">Coach style</span>
        <div class="grid option-grid" id="style"></div></div>
      <div class="stack-sm"><span class="eyebrow">Default session length</span>
        <div class="row" id="dur"></div></div>
      <div class="switch"><div class="txt"><strong>Spoken cues</strong>
        <span class="small muted">Piper text-to-speech, synthesised on the box.</span></div>
        <button class="toggle" id="voice" aria-pressed="${S.prefs.voice}" aria-label="Spoken cues"></button></div>
    </div>

    <div class="card stack">
      <h2>Camera &amp; privacy</h2>
      <div class="switch"><div class="txt"><strong>Watch mode</strong>
        <span class="small muted">Off by default. When on, FlowReset tracks accumulated sitting
        and neck time and <em>offers</em> a reset — it never starts one, and it stops asking if
        you decline. Turning it off clears what it accumulated.</span></div>
        <button class="toggle" id="watch" aria-pressed="${S.prefs.watch_mode}" aria-label="Watch mode"></button></div>
      <div class="switch"><div class="txt"><strong>Share anonymous totals with my workspace</strong>
        <span class="small muted">Sends counts only, and only inside a cohort of 10+ people.
        Never your video, your symptoms, or your individual sessions.</span></div>
        <button class="toggle" id="ws" aria-pressed="${S.prefs.workspace_opt_in}" aria-label="Workspace sharing"></button></div>
      <div class="row">
        <button class="btn secondary" id="export">Export my data</button>
        <button class="btn subtle" id="wipe" style="color:var(--rose)">Delete my local history</button>
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
  toggle("voice", "voice");
  toggle("watch", "watch_mode", (on) => send({ type: "watch_mode", on }));
  toggle("ws", "workspace_opt_in");

  $("#export", wrap).addEventListener("click", async () => {
    try {
      const data = mock ? { prefs: S.prefs, sessions: mock.sessions } :
        await fetch("/api/export").then((r) => {
          if (!r.ok) throw new Error("export failed");
          return r.json();
        });
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
  });

  $("#wipe", wrap).addEventListener("click", async () => {
    if (!confirm("Delete all local FlowReset history? This cannot be undone.")) return;
    if (mock) mock.sessions = [];
    else {
      const response = await fetch("/api/history", { method: "DELETE" }).catch(() => null);
      if (!response?.ok) {
        showToast("FlowReset could not delete the history. Check the local connection and try again.", "error");
        return;
      }
    }
    S.dashboard = null;
    await loadDashboard();
    showToast("Local session history deleted.", "status");
    go("dashboard");
  });

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

/** Wire a mic button to a target textarea. Returns nothing; degrades silently. */
function bindMic(button, textarea, statusEl) {
  if (!button) return;

  if (!sttAvailable()) {
    button.hidden = true;
    if (statusEl && S.preview) {
      statusEl.textContent = "Voice input needs the box — type instead for now.";
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
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size) recordedChunks.push(e.data);
    });
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("Transcribing…", false);
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
      setState("🎤 Speak instead", false);
      if (result.ok && result.text) {
        textarea.value = textarea.value ? `${textarea.value} ${result.text}` : result.text;
        if (statusEl) statusEl.textContent = "Transcribed on the box. Edit it if you like.";
      } else if (statusEl) {
        statusEl.textContent = result.error ? "Didn't catch that — try again or type it." : "";
      }
    });

    recorder.start();
    setState("⏹ Stop recording", true);
    if (statusEl) statusEl.textContent = "Recording. Audio is transcribed on the box, not stored.";
  });
}

window.addEventListener("beforeunload", stopCamera);
boot();
