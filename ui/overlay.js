/* Skeleton overlay.
 *
 * Draws the landmarks the box sent back. Deliberately soft: thin lines, small
 * joints, no bounding box, no red warning state. The overlay exists so the
 * user can see the guidance is tracking them, not so they can be scored.
 */

// Mirrors perception/pose.py SKELETON_EDGES. Same indices, same order.
export const SKELETON_EDGES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

const HEAD = [0, 7, 8];
const VISIBILITY_MIN = 0.5;

export function drawSkeleton(canvas, keypoints, accent = "#6d5b9e") {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!keypoints || keypoints.length < 29) return;

  const W = canvas.width;
  const H = canvas.height;
  const pt = (i) => {
    const k = keypoints[i];
    if (!k || k[2] < VISIBILITY_MIN) return null;
    return [k[0] * W, k[1] * H];
  };

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Bones
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(2, W * 0.005);
  SKELETON_EDGES.forEach(([a, b]) => {
    const p1 = pt(a);
    const p2 = pt(b);
    if (!p1 || !p2) return;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  });

  // Joints
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = accent;
  const r = Math.max(3, W * 0.007);
  SKELETON_EDGES.flat().forEach((i) => {
    const p = pt(i);
    if (!p) return;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Head: one circle through the ears rather than a face mesh — we are
  // tracking movement, not identifying anyone.
  const nose = pt(HEAD[0]);
  const lEar = pt(HEAD[1]);
  const rEar = pt(HEAD[2]);
  if (nose && lEar && rEar) {
    const radius = Math.max(Math.hypot(lEar[0] - rEar[0], lEar[1] - rEar[1]) * 0.85, r * 2);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.beginPath();
    ctx.arc(nose[0], nose[1], radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/** The guided frame: the outline the user positions themselves into.
 *
 * Drawn beneath the skeleton so it reads as a target, not as tracking. Its
 * shape encodes what the current move actually needs — a torso box for seated
 * work, a taller full-body box when the form rules depend on seeing ankles.
 * `state` is the server's frame check, so the outline, the ready indicator
 * and the spoken cue can never disagree.
 */
export function drawFrameGuide(canvas, state) {
  if (!state || !canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Full body wants nearly the whole height; torso sits in the upper-middle.
  const box =
    state.target === "full_body"
      ? { x: W * 0.24, y: H * 0.05, w: W * 0.52, h: H * 0.9 }
      : { x: W * 0.2, y: H * 0.08, w: W * 0.6, h: H * 0.66 };

  const ok = !!state.ok;
  const ready = !!state.ready;
  const colour = ready ? "#7fc98f" : ok ? "#e2c66b" : "#e08a7a";

  ctx.save();
  ctx.setLineDash(ready ? [] : [10, 8]);
  ctx.lineWidth = ready ? 4 : 3;
  ctx.strokeStyle = colour;
  ctx.globalAlpha = ready ? 0.95 : 0.75;

  const r = 18;
  ctx.beginPath();
  ctx.moveTo(box.x + r, box.y);
  ctx.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + box.h, r);
  ctx.arcTo(box.x + box.w, box.y + box.h, box.x, box.y + box.h, r);
  ctx.arcTo(box.x, box.y + box.h, box.x, box.y, r);
  ctx.arcTo(box.x, box.y, box.x + box.w, box.y, r);
  ctx.closePath();
  ctx.stroke();

  // While holding position, fill the outline clockwise so the wait is legible
  // rather than a frozen box the user assumes has hung.
  if (ok && !ready && state.held_s > 0) {
    const pct = Math.min(state.held_s / 1.2, 1);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#7fc98f";
    ctx.beginPath();
    ctx.arc(W / 2, box.y + box.h + 22, 14, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
