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
