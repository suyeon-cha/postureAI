/* Charts, hand-rolled.
 *
 * No chart library: three shapes, all of them simple, and the box shouldn't
 * need a CDN it can't reach with egress blocked. Each function returns a
 * detached element the caller appends.
 *
 * Every chart answers one question in words above it (see viewDashboard), so
 * these draw values and labels only — no titles, no legends-as-decoration.
 */

const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Seven-day habit bars. "Am I building the habit?" */
export function dayBars(daily = []) {
  const max = Math.max(1, ...daily.map((d) => d.completed));
  const wrap = el(`<div class="bars" role="img"
    aria-label="Completed resets per day: ${esc(daily.map((d) => `${d.label} ${d.completed}`).join(", "))}"></div>`);
  daily.forEach((d) => {
    const pct = (d.completed / max) * 100;
    const col = el(`<div class="col" title="${esc(d.date)} — ${d.completed} of ${d.started} completed">
        <span class="tiny muted">${d.completed || ""}</span>
        <div class="bar" data-empty="${d.completed === 0}" style="height:${Math.max(pct, d.completed ? 8 : 2)}%"></div>
        <span class="tick">${esc(d.label)}</span>
      </div>`);
    wrap.append(col);
  });
  return wrap;
}

/** Better / same / worse split. "Is it helping?" */
export function responseSplit(responses = {}) {
  const better = responses.better || 0;
  const same = responses.same || 0;
  const worse = responses.worse || 0;
  const total = better + same + worse;

  if (!total) {
    return el(`<p class="small muted">No rated sessions yet — the split appears after your
      first Better / Same / Worse answer.</p>`);
  }

  const pct = (n) => (n / total) * 100;
  const wrap = el(`<div class="stack-sm"></div>`);
  wrap.append(
    el(`<div class="split" role="img" aria-label="${better} better, ${same} same, ${worse} worse">
        ${better ? `<span class="better" style="width:${pct(better)}%">${Math.round(pct(better))}%</span>` : ""}
        ${same ? `<span class="same" style="width:${pct(same)}%">${same > total * 0.08 ? `${Math.round(pct(same))}%` : ""}</span>` : ""}
        ${worse ? `<span class="worse" style="width:${pct(worse)}%">${worse > total * 0.08 ? `${Math.round(pct(worse))}%` : ""}</span>` : ""}
      </div>`)
  );
  wrap.append(
    el(`<div class="row tiny muted">
        <span><strong style="color:var(--green)">${better}</strong> better</span>
        <span><strong style="color:var(--amber)">${same}</strong> about the same</span>
        <span><strong style="color:var(--rose)">${worse}</strong> worse</span>
        <span style="margin-left:auto">${total} rated</span>
      </div>`)
  );
  return wrap;
}

/** Body-area distribution. "Where do I need support?" */
export function areaBars(bySymptom = {}, labels = {}) {
  const rows = Object.entries(bySymptom).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return el(`<p class="small muted">No sessions in this window yet.</p>`);

  const max = Math.max(...rows.map(([, n]) => n));
  const total = rows.reduce((a, [, n]) => a + n, 0);
  const wrap = el(`<div class="hbar"></div>`);
  rows.forEach(([key, n]) => {
    wrap.append(
      el(`<div class="item">
          <span>${esc(labels[key] || key.replace(/_/g, " "))}</span>
          <div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div>
          <span class="muted tiny">${n} · ${Math.round((n / total) * 100)}%</span>
        </div>`)
    );
  });
  return wrap;
}
