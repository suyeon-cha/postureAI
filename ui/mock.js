/* Offline preview backend.
 *
 * The UI is a pure renderer of `state` + `coach` messages, so a stand-in that
 * emits the same shapes lets lane 3 build and demo screens without the box.
 *
 * This is NOT part of the judging path. It only activates when the real
 * WebSocket is unreachable, and when it does the local-AI badge says
 * "Preview — no box attached" instead of claiming local inference. Never let
 * this be mistaken for the real thing.
 */

const MOVES = {
  neck_side_stretch: { name: "Neck side stretch", seconds: 45, targets: ["neck"], cues: { setup: "Sit tall. Let your right ear drift toward your right shoulder.", during: "Breathe out and let the shoulder drop away from your ear." } },
  shoulder_rolls: { name: "Shoulder rolls", seconds: 40, targets: ["shoulders"], cues: { setup: "Arms heavy. Roll your shoulders up, back, and down.", during: "Make the circle bigger — all the way back." } },
  trap_stretch: { name: "Upper trap stretch", seconds: 50, targets: ["neck"], cues: { setup: "Reach your right hand under the chair seat. Tilt your head left.", during: "Long, slow exhale. No pulling — just weight." } },
  chest_opener: { name: "Chest opener", seconds: 35, targets: ["shoulders"], cues: { setup: "Clasp your hands behind your back, or grip the sides of the chair.", during: "Lift your chest and widen across the collarbones." } },
  chin_tuck: { name: "Chin tuck", seconds: 40, targets: ["neck"], cues: { setup: "Look straight ahead. Draw your chin back.", during: "Small movement — the back of your neck should feel long." } },
  seated_twist: { name: "Seated spinal twist", seconds: 50, targets: ["back"], cues: { setup: "Feet flat. Turn your chest to the right, hand on the chair back.", during: "Grow taller as you exhale, then turn a little further." } },
  cat_cow: { name: "Seated cat-cow", seconds: 50, targets: ["back"], cues: { setup: "Hands on your knees. Arch your back, then round it.", during: "Move with your breath." } },
  hip_flexor_reset: { name: "Standing hip flexor reset", seconds: 60, targets: ["hips"], cues: { setup: "Step your right foot back into a short lunge.", during: "Tuck your tailbone under." } },
  standing_forward_fold: { name: "Standing forward fold", seconds: 35, targets: ["back"], cues: { setup: "Feet hip width. Soft knees. Hinge and let your head hang.", during: "Let your neck go completely." } },
  wrist_stretch: { name: "Wrist extensor stretch", seconds: 45, targets: ["wrists"], cues: { setup: "Arm straight out, palm down. Draw the fingers back.", during: "Ease off if it's sharp." } },
  wrist_prayer: { name: "Prayer stretch", seconds: 30, targets: ["wrists"], cues: { setup: "Palms together at your chest, lower your hands.", during: "Stop where you feel it. Breathe." } },
  finger_fan: { name: "Finger fan and fist", seconds: 25, targets: ["wrists"], cues: { setup: "Spread your fingers wide, then make a loose fist.", during: "Keep the fist loose." } },
  eye_horizon: { name: "Distance gaze", seconds: 25, targets: ["eyes"], cues: { setup: "Look at something at least twenty feet away.", during: "Let your eyes relax onto it. Blink normally." } },
  eye_palming: { name: "Palming", seconds: 30, targets: ["eyes"], cues: { setup: "Rub your palms warm, then cup them over your closed eyes.", during: "No pressure on the eyeballs." } },
  eye_figure_eight: { name: "Slow figure eight", seconds: 25, targets: ["eyes"], cues: { setup: "Trace a slow, wide figure eight with your eyes.", during: "Slower. Reach the edges of your vision." } },
  box_breath: { name: "Box breathing", seconds: 35, targets: ["sitting"], cues: { setup: "In for four, hold four, out for four, hold four.", during: "Let the exhale be the longest part." } },
  glute_squeeze: { name: "Seated glute squeeze", seconds: 35, targets: ["glutes"], cues: { setup: "Sit tall, feet flat and uncrossed. Squeeze both glutes and hold for three.", during: "Squeeze, hold three, release. Keep breathing." } },
  figure_four: { name: "Seated figure-four", seconds: 60, targets: ["glutes"], cues: { setup: "Cross your right ankle over your left knee, letting the knee open outward.", during: "Sit tall and hinge forward slightly from the hips." } },
  chair_squat: { name: "Sit-to-stand", seconds: 50, targets: ["glutes", "legs"], cues: { setup: "Feet hip width in front of your chair. Stand up without using your hands.", during: "Push the floor away through your heels. Sit back down slowly." } },
  hip_hinge: { name: "Standing hip hinge", seconds: 45, targets: ["glutes"], cues: { setup: "Feet hip width, soft knees, hands on your hip creases.", during: "Push your hips back, chest stays long. Squeeze your glutes to stand." } },
  lunge: { name: "Split-stance lunge", seconds: 70, targets: ["glutes", "legs"], cues: { setup: "Step your right foot back about a stride. Both toes pointing forward.", during: "Drop straight down — front shin vertical, torso tall." } },
};

const BY_SYMPTOM = {
  neck_shoulders: ["neck_side_stretch", "shoulder_rolls", "trap_stretch", "chest_opener", "chin_tuck"],
  back_hips: ["seated_twist", "cat_cow", "hip_flexor_reset", "standing_forward_fold"],
  legs_glutes: ["glute_squeeze", "figure_four", "chair_squat", "hip_hinge", "lunge"],
  wrists_hands: ["wrist_stretch", "wrist_prayer", "finger_fan"],
  tired_eyes: ["eye_horizon", "eye_palming", "eye_figure_eight"],
  general: ["shoulder_rolls", "seated_twist", "cat_cow", "eye_horizon"],
};

// Moves that need to be on your feet — the mock's stand-in for seated_ok.
const STANDING_ONLY = ["hip_flexor_reset", "standing_forward_fold", "chair_squat", "hip_hinge", "lunge"];

const LABELS = {
  neck_shoulders: "Neck & shoulders",
  back_hips: "Back & hips",
  legs_glutes: "Legs & glutes",
  wrists_hands: "Wrists & hands",
  tired_eyes: "Tired eyes",
  general: "General reset",
};

const SOURCE_OSHA = {
  organization: "U.S. Occupational Safety and Health Administration",
  title: "Computer Workstations: Hazards and Solutions",
  url: "https://www.osha.gov/computer-workstations/hazards-solutions",
};
const SOURCE_AOA = {
  organization: "American Optometric Association",
  title: "Computer Vision Syndrome",
  url: "https://www.aoa.org/healthy-eyes/eye-and-vision-conditions/computer-vision-syndrome?sso=y",
};
const TOPIC_META = {
  neck_shoulders: ["Neck and shoulder reset", "A short movement break interrupts prolonged static desk posture.", "Body pose", "MediaPipe PoseLandmarker", ["Shoulders and head are visible", "Movement pace", "Comfortable movement range", "Excessive trunk movement"], "The camera cannot diagnose neck or shoulder conditions.", [SOURCE_OSHA]],
  back_hips: ["Back and hip reset", "Changing position and using a short controlled movement can interrupt an extended seated period.", "Body pose", "MediaPipe PoseLandmarker", ["Torso and hips are visible", "Controlled pace", "Movement range", "Required full-body framing"], "The camera cannot identify the cause of back or hip discomfort.", [SOURCE_OSHA]],
  legs_glutes: ["Leg and glute reset", "A brief movement changes loading after prolonged sitting.", "Full-body pose", "MediaPipe PoseLandmarker", ["Hips, knees, and feet are visible", "Repetition count", "Movement pace", "Selected alignment signals"], "This is not a clinical gait or joint assessment.", [SOURCE_OSHA]],
  wrists_hands: ["Wrist and hand reset", "A brief change from keyboard activity can break up repetitive hand use.", "Local vision check", "Qwen2.5-VL via the local agent", ["Hands and wrists are visible", "Movement matches the selected reset", "Movement appears slow and controlled"], "The MVP does not calculate clinical wrist angles.", [SOURCE_OSHA]],
  tired_eyes: ["Screen-rest reset", "Looking away from a near screen provides a deliberate pause from sustained near work.", "Local vision check", "Qwen2.5-VL via the local agent", ["Face is visible before the reset", "Attention turns away from the screen", "The interval is completed"], "The camera cannot diagnose eye strain or myopia.", [SOURCE_AOA]],
  general: ["General desk reset", "A short guided change of position reduces the friction of choosing a desk break.", "Body pose", "MediaPipe PoseLandmarker", ["Required landmarks are visible", "Movement pace", "Routine completion"], "FlowReset provides general movement awareness only.", [SOURCE_OSHA]],
};
const KNOWLEDGE = {
  version: 1,
  review_status: "hackathon_general_wellness",
  reviewed_at: "2026-07-26",
  audience: "Adults 18+",
  boundary: "General workplace-wellness guidance only; not diagnosis or treatment.",
  topics: Object.entries(TOPIC_META).map(([area, value]) => ({
    area, title: value[0], rationale: value[1],
    camera: { mode: value[2], model: value[3], checks: value[4], limitation: value[5] },
    sources: value[6], review_status: "hackathon_general_wellness", reviewed_at: "2026-07-26",
  })),
  privacy: {
    title: "Private local processing",
    rationale: "Camera data is processed on the GB10 so raw frames do not leave the workplace or need to be retained.",
    retention: {
      raw_frames: "Memory only; discarded immediately after local inference",
      landmarks: "Session only",
      personal_history: "Until the user deletes it in this prototype; automated retention is a production requirement",
      employer_reporting: "Aggregate, opted-in cohorts of 10 or more",
    },
  },
};

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function seededHistory() {
  const r = rng(7);
  const symptoms = Object.keys(BY_SYMPTOM).slice(0, 4);
  const rows = [];
  for (let d = 13; d >= 0; d--) {
    const n = [0, 1, 1, 2, 2, 3][Math.floor(r() * 6)];
    for (let i = 0; i < n; i++) {
      const symptom = symptoms[Math.floor(r() * symptoms.length)];
      const when = new Date();
      when.setDate(when.getDate() - d);
      when.setHours(10 + Math.floor(r() * 8), Math.floor(r() * 60), 0, 0);
      const completed = r() < 0.84;
      const roll = r();
      rows.push({
        id: rows.length + 1,
        started_at: when.toISOString().slice(0, 19),
        symptom,
        duration_min: [1, 2, 3, 5][Math.floor(r() * 4)],
        moves: BY_SYMPTOM[symptom].slice(0, 2 + Math.floor(r() * 2)),
        completed,
        response: completed ? (roll < 0.74 ? "better" : roll < 0.95 ? "same" : "worse") : null,
        camera_used: r() < 0.55,
        is_demo: true,
      });
    }
  }
  return rows;
}

export class MockBackend {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.sessions = seededHistory();
    this.prefs = {
      goal: "reduce_stiffness",
      common_areas: ["neck_shoulders"],
      can_stand: true,
      preferred_duration_min: 3,
      coach_style: "supportive",
      voice: true,
      watch_mode: false,
      team: "Engineering",
      workspace_opt_in: false,
    };
    this.plan = null;
    this.session = null;
    this.liveSessionId = null;
    this.cueIndex = 0;
    this.tick = 0;
    this.timer = setInterval(() => this._tick(), 1000 / 8);
  }

  close() { clearInterval(this.timer); }

  send(msg) {
    const fn = this[`_on_${msg.type}`];
    if (fn) fn.call(this, msg);
  }

  _emit(m) { this.onMessage(m); }

  // ── intake → plan ──

  _on_intake({ text, override }) {
    const lower = (text || "").toLowerCase();
    let symptom = "general";
    if (/neck|shoulder|trap/.test(lower)) symptom = "neck_shoulders";
    else if (/glute|butt|leg|thigh|quad|hamstring|knee|calf|cross/.test(lower)) symptom = "legs_glutes";
    else if (/back|hip|sitting/.test(lower)) symptom = "back_hips";
    else if (/wrist|hand|finger|typing/.test(lower)) symptom = "wrists_hands";
    else if (/eye|screen|headache|blurry/.test(lower)) symptom = "tired_eyes";

    let duration = this.prefs.preferred_duration_min;
    const min = lower.match(/(\d+)\s*(?:min|minute)/);
    const sec = lower.match(/(\d+)\s*(?:sec|second)/);
    if (min) duration = Math.max(1, Math.min(10, +min[1]));
    else if (sec) duration = Math.max(1, Math.round(+sec[1] / 60));

    // Mirrors agent/coach.py::parse_intake — a stated ability beats an
    // incidental mention of sitting, so ability is checked first.
    let canStand = this.prefs.can_stand;
    if (/can stand|could stand|able to stand|can get up|happy to stand|standing is fine|standing's fine|on my feet|don'?t mind standing/.test(lower)) canStand = true;
    else if (/stay seated|seated only|remain seated|stay in my (chair|seat)|stay at my desk|can'?t stand|cannot stand|can'?t get up|need to sit|have to sit|without standing|on a call|in a meeting|at my desk/.test(lower)) canStand = false;

    if (override?.symptom) symptom = override.symptom;
    if (override?.duration_min) duration = override.duration_min;
    if (override?.can_stand !== undefined) canStand = override.can_stand;

    this._trace({ kind: "intake", parsed: { symptom, duration_min: duration, can_stand: canStand } });

    const budget = duration * 60;
    const pool = BY_SYMPTOM[symptom].filter((k) => canStand || !STANDING_ONLY.includes(k));
    const moves = [];
    let spent = 0;
    const reserve = duration >= 2 ? MOVES.box_breath.seconds : 0;
    for (const key of pool) {
      if (spent + MOVES[key].seconds > budget - reserve) continue;
      moves.push(key);
      spent += MOVES[key].seconds;
    }
    if (!moves.length) { moves.push(pool[0]); spent = MOVES[pool[0]].seconds; }
    if (reserve) { moves.push("box_breath"); spent += reserve; }

    setTimeout(() => this._trace({ kind: "model", step: 0, content: "", tool_calls: ["get_user_context"], latency_ms: 210, model: "qwen3:8b" }), 120);
    setTimeout(() => this._trace({ kind: "tool", name: "get_user_context", arguments: {}, result: { goal: this.prefs.goal, can_stand: canStand } }), 220);
    setTimeout(() => this._trace({ kind: "model", step: 1, content: "", tool_calls: ["get_reset_history"], latency_ms: 180, model: "qwen3:8b" }), 340);
    setTimeout(() => this._trace({ kind: "tool", name: "get_reset_history", arguments: { days: 7 }, result: this._summary() }), 430);
    setTimeout(() => this._trace({ kind: "model", step: 2, content: "", tool_calls: ["select_approved_routine"], latency_ms: 240, model: "qwen3:8b" }), 560);
    setTimeout(() => this._trace({ kind: "tool", name: "select_approved_routine", arguments: { symptom, duration_min: duration, can_stand: canStand }, result: { moves } }), 660);

    const s = this._summary();
    const count = s.by_symptom[symptom] || 0;
    const plan = {
      symptom,
      symptom_label: LABELS[symptom],
      duration_min: duration,
      estimated_seconds: spent,
      moves,
      move_names: moves.map((k) => MOVES[k].name),
      // Every category offers camera participation. For eye resets, the camera
      // confirms looking away/completion rather than diagnosing vision or gaze.
      camera_useful: true,
      knowledge: KNOWLEDGE.topics.find((topic) => topic.area === symptom),
      needs_full_body: moves.some((k) => STANDING_ONLY.includes(k)),
      avoided: [],
    };
    this.plan = plan;
    this.liveSessionId = 9000 + this.sessions.length;

    const why = [
      `You said ${LABELS[symptom].toLowerCase()}, ${canStand ? "standing is fine" : "seated only"}, ${duration} min.`,
      `${moves.length} moves from the approved library, about ${spent}s total.`,
    ];
    if (count > 1) why.push(`This is your ${["first", "second", "third", "fourth", "fifth"][Math.min(count, 4)]} ${LABELS[symptom].toLowerCase()} check-in in 7 days.`);

    setTimeout(() => {
      this._trace({ kind: "action", action: "session_created", session_id: this.liveSessionId, moves });
      this._emit({
        type: "coach",
        text: `Here's a ${duration}-minute ${canStand ? "" : "seated "}reset for your ${LABELS[symptom].toLowerCase()}: ${plan.move_names.slice(0, 3).join(", ")}. Start when you're ready.`,
        speak: this.prefs.voice,
        routine: { duration_min: duration, moves },
        plan,
        why,
        session_id: this.liveSessionId,
      });
    }, 780);
  }

  _on_start_reset(msg) {
    if (!this.plan) return;
    this.session = {
      index: 0,
      elapsed: 0,
      moveElapsed: 0,
      camera: !!msg.camera,
      paused: false,
      rep: 0,
      lastVideoCheck: 0,
    };
    this.cueIndex = 0;
    this._emit({ type: "session_started", plan: this.plan, camera_on: this.session.camera });
    this._emit({ type: "coach", text: MOVES[this.plan.moves[0]].cues.setup, speak: this.prefs.voice, routine: null });
  }

  _on_camera(msg) { if (this.session) this.session.camera = !!msg.on; this._emit({ type: "camera", on: !!msg.on }); }
  _on_pause(msg) { if (this.session) this.session.paused = !!msg.on; }
  _on_skip() { this._advance(); }
  _on_watch_mode(msg) { this.prefs.watch_mode = !!msg.on; this._emit({ type: "watch_mode", on: !!msg.on }); }

  _on_end_session(msg) {
    const plan = this.plan;
    this.session = null;
    if (plan) {
      this.sessions.push({
        id: this.liveSessionId,
        started_at: new Date().toISOString().slice(0, 19),
        symptom: plan.symptom,
        duration_min: plan.duration_min,
        moves: plan.moves,
        completed: msg.completed !== false,
        response: msg.response || null,
        camera_used: true,
        is_demo: false,
      });
    }
    this._trace({ kind: "tool", name: "record_session_result", arguments: { session_id: this.liveSessionId, completed: true, response: msg.response }, result: { saved: true } });
    const s = this._summary();
    const line =
      msg.response === "better" ? "Good. I'll put this one first next time that area speaks up."
      : msg.response === "worse" ? "Thanks for telling me — I'll skip those moves next time and go gentler."
      : "Noted. I'll try a different mix next time and see if it lands better.";
    this._emit({
      type: "coach", text: line, speak: this.prefs.voice, routine: null,
      insight: s.sessions_completed >= 3 && s.better_rate >= 0.6
        ? `${Math.round(s.better_rate * 100)}% of your resets this week left you feeling better (${s.sessions_completed} completed).`
        : null,
      summary: s,
    });
    this._emit({ type: "dashboard", data: this.dashboard() });
  }

  // ── ticking ──

  _tick() {
    if (!this.session || this.session.paused) return;
    const dt = 1 / 8;
    this.session.elapsed += dt;
    this.session.moveElapsed += dt;
    this.tick += dt;

    const key = this.plan.moves[this.session.index];
    const spec = MOVES[key];

    if (this.session.camera && Math.random() < 0.02 && this.session.moveElapsed > 5) {
      const cue = this.cueIndex++ % 2 === 0 ? spec.cues.during : spec.cues.setup;
      this._emit({ type: "coach", text: cue, speak: this.prefs.voice, routine: null });
      this._trace({ kind: "tool", name: "generate_coaching_cue", arguments: { move: key },
        result: { source: "approved_move_library", preview_simulated: true } });
    }
    if (this.session.camera && this.session.moveElapsed > 5 &&
        this.session.moveElapsed - this.session.lastVideoCheck > 8) {
      this.session.lastVideoCheck = this.session.moveElapsed;
      this._emit({
        type: "video_ai",
        status: "ready",
        move: key,
        text: `Preview simulation for ${spec.name}: compare your movement with the animated guide. ${spec.cues.during}`,
      });
      this._trace({ kind: "tool", name: "look_at_frame", arguments: { move: key },
        result: { local_preview: true, visible: true } });
    }

    if (this.session.moveElapsed >= spec.seconds) this._advance();

    this._emit({
      type: "state",
      mode: "reset",
      keypoints: this.session.camera ? this._fakeKeypoints() : [],
      posture_debt: { neck: 12.5, shoulders: 8, sitting: 46 },
      session: {
        move: key,
        move_index: this.session.index,
        move_count: this.plan.moves.length,
        rep: Math.floor(this.session.moveElapsed / 4),
        target_reps: 8,
        hold_seconds: Math.round(this.session.moveElapsed),
        form: "ok",
        tempo: "good",
        elapsed: Math.round(this.session.elapsed),
        paused: false,
      },
      framing: this.session.camera ? "torso_only" : "no_person",
      camera_on: this.session.camera,
    });
  }

  _advance() {
    if (!this.session || !this.plan) return;
    const done = this.plan.moves[this.session.index];
    this._emit({ type: "coach", text: `Good. That's ${MOVES[done].name} done.`, speak: this.prefs.voice, routine: null });
    this.session.index += 1;
    this.session.moveElapsed = 0;
    this.session.lastVideoCheck = 0;
    if (this.session.index >= this.plan.moves.length) {
      this.session = null;
      this._emit({ type: "routine_complete" });
      return;
    }
    const next = this.plan.moves[this.session.index];
    setTimeout(() => this._emit({ type: "coach", text: MOVES[next].cues.setup, speak: this.prefs.voice, routine: null }), 900);
  }

  /* A gently breathing skeleton so the overlay can be seen working.
     Obviously synthetic — the real one comes from MediaPipe on the box. */
  _fakeKeypoints() {
    const t = this.tick;
    const sway = Math.sin(t * 0.8) * 0.012;
    const bob = Math.sin(t * 1.4) * 0.008;
    const arm = Math.sin(t * 0.9) * 0.05;
    const kp = new Array(33).fill(null).map(() => [0, 0, 0]);
    const put = (i, x, y, v = 0.95) => (kp[i] = [x + sway, y + bob, v]);
    put(0, 0.5, 0.20);
    put(7, 0.455, 0.215); put(8, 0.545, 0.215);
    put(11, 0.40, 0.35); put(12, 0.60, 0.35);
    put(13, 0.35, 0.50 + arm); put(14, 0.65, 0.50 + arm);
    put(15, 0.33, 0.64 + arm * 1.6); put(16, 0.67, 0.64 + arm * 1.6);
    put(23, 0.43, 0.65); put(24, 0.57, 0.65);
    put(25, 0.42, 0.85, 0.4); put(26, 0.58, 0.85, 0.4);
    return kp;
  }

  // ── read models ──

  _trace(entry) {
    this._emit({ type: "trace", entry: { ...entry, at: new Date().toTimeString().slice(0, 8) } });
  }

  _summary() {
    // Use the same seven calendar days shown by dashboard(), so the headline
    // session count and day bars always reconcile.
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    const week = this.sessions.filter((s) => new Date(s.started_at) >= since);
    const done = week.filter((s) => s.completed);
    const responses = { better: 0, same: 0, worse: 0 };
    done.forEach((s) => { if (s.response) responses[s.response]++; });
    const bySymptom = {};
    week.forEach((s) => (bySymptom[s.symptom] = (bySymptom[s.symptom] || 0) + 1));
    const top = Object.keys(bySymptom).sort((a, b) => bySymptom[b] - bySymptom[a])[0] || null;
    return {
      days: 7,
      sessions_started: week.length,
      sessions_completed: done.length,
      completion_rate: week.length ? +(done.length / week.length).toFixed(2) : 0,
      responses,
      better_rate: done.length ? +(responses.better / done.length).toFixed(2) : 0,
      by_symptom: bySymptom,
      top_symptom: top,
      top_symptom_count: top ? bySymptom[top] : 0,
      moves_that_helped: ["shoulder_rolls", "neck_side_stretch"],
      moves_to_avoid: [],
      streak_days: 3,
    };
  }

  dashboard() {
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rows = this.sessions.filter((s) => s.started_at.slice(0, 10) === key);
      daily.push({
        date: key,
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        completed: rows.filter((s) => s.completed).length,
        started: rows.length,
      });
    }
    return {
      summary: this._summary(),
      daily,
      recent: [...this.sessions].reverse().slice(0, 8),
      symptom_labels: LABELS,
    };
  }

  workspace() {
    const r = rng(21);
    const teams = ["Engineering", "Design", "Data", "Support"].map((team) => {
      const participants = 4 + Math.floor(r() * 8);
      const sessions = participants * (6 + Math.floor(r() * 10));
      return {
        team,
        participants,
        sessions,
        completion_rate: +(0.72 + r() * 0.2).toFixed(2),
        per_person_per_week: +(1.4 + r() * 2.2).toFixed(1),
      };
    });
    const reported = teams.filter((t) => t.participants >= 10);
    const participants = reported.reduce((a, t) => a + t.participants, 0);
    const sessions = reported.reduce((a, t) => a + t.sessions, 0);
    const completed = Math.round(sessions * 0.79);
    return {
      workspace: {
        suppressed: false,
        days: 30,
        k_anonymity: 10,
        participants,
        sessions_started: sessions,
        sessions_completed: completed,
        completion_rate: +(completed / sessions).toFixed(2),
        teams: reported,
        suppressed_teams: teams.length - reported.length,
        per_person_per_week: +(sessions / participants / 4).toFixed(1),
      },
      symptom_labels: LABELS,
    };
  }

  health() {
    return {
      preview: true,
      llm: { endpoint: "preview", local: false, reachable: false, reason_model: "qwen3:8b", vision_model: "qwen2.5vl:7b" },
      runtime: { runtime: "preview", tools: ["get_user_context", "get_reset_history", "retrieve_wellness_guidance", "select_approved_routine", "analyze_pose", "generate_coaching_cue", "record_session_result"] },
      pose: { model: "MediaPipe PoseLandmarker (heavy)", available: false, frames_stored: 0 },
      tts: { engine: "Piper (local)", available: false },
      stt: { engine: "faster-whisper (local)", available: false, audio_stored: 0 },
      library_moves: Object.keys(MOVES).length,
    };
  }

  routines() {
    return { moves: MOVES, symptoms: LABELS, durations: [1, 2, 3, 5, 10] };
  }

  knowledge() {
    return KNOWLEDGE;
  }
}
