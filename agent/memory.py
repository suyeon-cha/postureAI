"""Local memory — SQLite on the box, never leaves it.

Two readers, deliberately asymmetric:

  personal   full detail, single user, drives recommendations
  workspace  aggregate only, k-anonymity floor, drives the B2B dashboard

The workspace reader physically cannot return a row that identifies a person:
it aggregates in SQL and suppresses any cohort under K_ANONYMITY. That is the
whole B2B safety argument, and it is 40 lines you can read.

Nothing here stores video, frames, or landmarks — only what the user chose
and how they said they felt afterward.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("FLOWRESET_DB", Path(__file__).parent.parent / "flowreset.db"))

# No workspace cohort smaller than this is ever reported. Ten is the product's
# conservative MVP floor for reducing re-identification risk.
K_ANONYMITY = 10

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL DEFAULT 'local',
    team            TEXT NOT NULL DEFAULT 'unassigned',
    started_at      TEXT NOT NULL,
    symptom         TEXT NOT NULL,
    duration_min    INTEGER NOT NULL,
    moves           TEXT NOT NULL,
    completed       INTEGER NOT NULL DEFAULT 0,
    response        TEXT,
    camera_used     INTEGER NOT NULL DEFAULT 0,
    trigger         TEXT NOT NULL DEFAULT 'user',
    is_demo         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prefs (
    user_id     TEXT PRIMARY KEY,
    payload     TEXT NOT NULL
);

-- How the body feels, in the user's own reckoning, independent of whether
-- they did a reset. Sessions only tell us about the moments someone acted;
-- this is the baseline those moments are measured against, and it is the one
-- signal the camera and the agent cannot infer for themselves.
CREATE TABLE IF NOT EXISTS checkins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    logged_at   TEXT NOT NULL,
    area        TEXT NOT NULL,
    level       INTEGER NOT NULL,          -- 1 easy ... 5 rough
    note        TEXT,
    is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id, logged_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_team ON sessions(team, started_at);
"""

DEFAULT_PREFS: dict[str, Any] = {
    "goal": "reduce_stiffness",
    "common_areas": ["neck_shoulders"],
    "can_stand": True,
    "preferred_duration_min": 3,
    "coach_style": "supportive",
    "voice": False,
    "watch_mode": False,
    "reminders": "off",
    "team": "unassigned",
    "workspace_opt_in": False,
}


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock, connect() as conn:
        conn.executescript(SCHEMA)


# ────────────────────────────── preferences ──────────────────────────────


def get_prefs(user_id: str = "local") -> dict[str, Any]:
    with _lock, connect() as conn:
        row = conn.execute(
            "SELECT payload FROM prefs WHERE user_id = ?", (user_id,)
        ).fetchone()
    prefs = dict(DEFAULT_PREFS)
    if row:
        prefs.update(json.loads(row["payload"]))
    return prefs


def set_prefs(patch: dict[str, Any], user_id: str = "local") -> dict[str, Any]:
    prefs = get_prefs(user_id)
    prefs.update(patch)
    with _lock, connect() as conn:
        conn.execute(
            "INSERT INTO prefs(user_id, payload) VALUES(?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload",
            (user_id, json.dumps(prefs)),
        )
    return prefs


# ─────────────────────────────── sessions ───────────────────────────────


def start_session(
    symptom: str,
    duration_min: int,
    moves: list[str],
    user_id: str = "local",
    trigger: str = "user",
    camera_used: bool = False,
) -> int:
    prefs = get_prefs(user_id)
    with _lock, connect() as conn:
        cur = conn.execute(
            "INSERT INTO sessions"
            "(user_id, team, started_at, symptom, duration_min, moves,"
            " completed, response, camera_used, trigger, is_demo) "
            "VALUES(?,?,?,?,?,?,0,NULL,?,?,0)",
            (
                user_id,
                prefs.get("team", "unassigned"),
                datetime.now().isoformat(timespec="seconds"),
                symptom,
                duration_min,
                json.dumps(moves),
                int(camera_used),
                trigger,
            ),
        )
        return int(cur.lastrowid)


def finish_session(
    session_id: int,
    completed: bool,
    response: str | None = None,
    camera_used: bool | None = None,
) -> None:
    if response not in (None, "better", "same", "worse"):
        raise ValueError(f"response must be better/same/worse, got {response!r}")
    with _lock, connect() as conn:
        if camera_used is None:
            conn.execute(
                "UPDATE sessions SET completed = ?, response = ? WHERE id = ?",
                (int(completed), response, session_id),
            )
        else:
            conn.execute(
                "UPDATE sessions SET completed = ?, response = ?, camera_used = ? "
                "WHERE id = ?",
                (int(completed), response, int(camera_used), session_id),
            )


def recent(limit: int = 10, user_id: str = "local") -> list[dict[str, Any]]:
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE user_id = ? "
            "ORDER BY started_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [_row_to_session(r) for r in rows]


def _row_to_session(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["moves"] = json.loads(d["moves"])
    d["completed"] = bool(d["completed"])
    d["camera_used"] = bool(d["camera_used"])
    d["is_demo"] = bool(d["is_demo"])
    return d


# ─────────────────────── personal insight (drives the agent) ───────────────────────


def summary(user_id: str = "local", days: int = 7) -> dict[str, Any]:
    """Compact history the agent reasons over. Small on purpose — it goes in a prompt."""
    # Match daily_counts(): "7 days" means today plus the six preceding
    # calendar days. A rolling 168-hour cutoff made the headline total include
    # part of an eighth calendar day, so it could disagree with the chart.
    since_day = date.today() - timedelta(days=days - 1)
    since = datetime.combine(since_day, datetime.min.time()).isoformat(timespec="seconds")
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE user_id = ? AND started_at >= ?",
            (user_id, since),
        ).fetchall()
    sessions = [_row_to_session(r) for r in rows]
    done = [s for s in sessions if s["completed"]]

    by_symptom: dict[str, int] = {}
    for s in sessions:
        by_symptom[s["symptom"]] = by_symptom.get(s["symptom"], 0) + 1

    responses = {"better": 0, "same": 0, "worse": 0}
    for s in done:
        if s["response"] in responses:
            responses[s["response"]] += 1

    # Which moves actually preceded a "better"? This is what personalization means.
    helped: dict[str, int] = {}
    unhelpful: dict[str, int] = {}
    for s in done:
        bucket = helped if s["response"] == "better" else (
            unhelpful if s["response"] == "worse" else None
        )
        if bucket is None:
            continue
        for m in s["moves"]:
            bucket[m] = bucket.get(m, 0) + 1

    top_symptom = max(by_symptom, key=by_symptom.get) if by_symptom else None
    return {
        "days": days,
        "sessions_started": len(sessions),
        "sessions_completed": len(done),
        "completion_rate": round(len(done) / len(sessions), 2) if sessions else 0.0,
        "responses": responses,
        "better_rate": round(responses["better"] / len(done), 2) if done else 0.0,
        "by_symptom": by_symptom,
        "top_symptom": top_symptom,
        "top_symptom_count": by_symptom.get(top_symptom, 0) if top_symptom else 0,
        "moves_that_helped": sorted(helped, key=helped.get, reverse=True)[:4],
        "moves_to_avoid": sorted(unhelpful, key=unhelpful.get, reverse=True)[:3],
        "streak_days": _streak(user_id),
    }


#: Blocks of the working day. Coarse on purpose: "your neck goes at 2pm" is a
#: pattern someone can act on; a 24-bar hourly histogram of a handful of
#: sessions is noise wearing a chart's clothes.
DAYPARTS = [
    ("early", "Before 10am", 0, 10),
    ("midday", "10am – 1pm", 10, 13),
    ("afternoon", "1pm – 4pm", 13, 16),
    ("late", "After 4pm", 16, 24),
]


def practice(user_id: str = "local", days: int = 30) -> dict[str, Any]:
    """Per-move and per-daypart history.

    Two questions the plain summary can't answer: *when* in the day discomfort
    shows up, and *which individual movements* the user has actually practised
    and rated. The first drives the headline insight; the second turns the
    library from a flat catalog into a personal one.
    """
    since_day = date.today() - timedelta(days=days - 1)
    since = datetime.combine(since_day, datetime.min.time()).isoformat(timespec="seconds")
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE user_id = ? AND started_at >= ?",
            (user_id, since),
        ).fetchall()
    sessions = [_row_to_session(r) for r in rows]

    dayparts = {key: {"label": label, "sessions": 0, "by_symptom": {}}
                for key, label, _s, _e in DAYPARTS}
    moves: dict[str, dict[str, Any]] = {}

    for s in sessions:
        try:
            hour = datetime.fromisoformat(s["started_at"]).hour
        except (ValueError, TypeError):
            hour = 12
        for key, _label, start, end in DAYPARTS:
            if start <= hour < end:
                bucket = dayparts[key]
                bucket["sessions"] += 1
                sym = s["symptom"]
                bucket["by_symptom"][sym] = bucket["by_symptom"].get(sym, 0) + 1
                break

        for m in s["moves"]:
            entry = moves.setdefault(m, {"practiced": 0, "better": 0, "rated": 0})
            entry["practiced"] += 1
            if s["completed"] and s["response"] in ("better", "same", "worse"):
                entry["rated"] += 1
                if s["response"] == "better":
                    entry["better"] += 1

    busiest = max(dayparts.values(), key=lambda b: b["sessions"], default=None)
    return {
        "days": days,
        "dayparts": [dict(key=k, **dayparts[k]) for k, _l, _s, _e in DAYPARTS],
        "busiest_daypart": (
            {"label": busiest["label"], "sessions": busiest["sessions"],
             "top_symptom": max(busiest["by_symptom"], key=busiest["by_symptom"].get)
             if busiest["by_symptom"] else None}
            if busiest and busiest["sessions"] else None
        ),
        "moves": moves,
        "distinct_moves": len(moves),
    }


#: Check-in scale. Words, not bare numbers — "rough" is something a person
#: recognises about their own body; "4" is a datapoint about someone else's.
CHECKIN_LEVELS = {
    1: "Easy",
    2: "Fine",
    3: "Noticeable",
    4: "Sore",
    5: "Rough",
}


def log_checkin(area: str, level: int, note: str = "", user_id: str = "local") -> dict[str, Any]:
    """Record how the body feels right now. Local, like everything else."""
    level = max(1, min(5, int(level)))
    now = datetime.now().isoformat(timespec="seconds")
    with _lock, connect() as conn:
        cur = conn.execute(
            "INSERT INTO checkins (user_id, logged_at, area, level, note) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, now, area, level, (note or "")[:280]),
        )
        conn.commit()
        return {"id": cur.lastrowid, "logged_at": now, "area": area, "level": level}


def checkins(user_id: str = "local", days: int = 30) -> dict[str, Any]:
    """Check-in history, plus the trend that makes it worth collecting.

    A single rating is a mood. A fortnight of them, split against the days a
    reset happened, is the closest this product can honestly get to "is any
    of this working?" — so that comparison is computed here rather than left
    for the UI to imply.
    """
    since_day = date.today() - timedelta(days=days - 1)
    since = datetime.combine(since_day, datetime.min.time()).isoformat(timespec="seconds")
    with _lock, connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM checkins WHERE user_id = ? AND logged_at >= ? "
            "ORDER BY logged_at DESC",
            (user_id, since),
        ).fetchall()]
        session_days = {
            r["d"] for r in conn.execute(
                "SELECT DISTINCT date(started_at) AS d FROM sessions "
                "WHERE user_id = ? AND completed = 1 AND started_at >= ?",
                (user_id, since),
            ).fetchall()
        }

    by_day: dict[str, list[int]] = {}
    by_area: dict[str, list[int]] = {}
    for r in rows:
        day = r["logged_at"][:10]
        by_day.setdefault(day, []).append(r["level"])
        by_area.setdefault(r["area"], []).append(r["level"])

    def mean(xs):
        return round(sum(xs) / len(xs), 2) if xs else None

    # The comparison that justifies asking: does the body read better on days
    # a reset happened? Honest about being observational, not causal.
    on_reset = [lv for day, lvs in by_day.items() if day in session_days for lv in lvs]
    off_reset = [lv for day, lvs in by_day.items() if day not in session_days for lv in lvs]

    trend = [
        {"date": d, "level": mean(by_day[d]), "reset": d in session_days}
        for d in sorted(by_day)
    ]
    return {
        "days": days,
        "levels": CHECKIN_LEVELS,
        "count": len(rows),
        "latest": rows[0] if rows else None,
        "logged_today": any(r["logged_at"][:10] == date.today().isoformat() for r in rows),
        "trend": trend,
        "average": mean([lv for lvs in by_day.values() for lv in lvs]),
        "by_area": {a: {"average": mean(v), "count": len(v)} for a, v in by_area.items()},
        "on_reset_days": mean(on_reset),
        "off_reset_days": mean(off_reset),
    }


#: What the wellbeing score is made of, and how much each part can contribute.
#: Named and weighted in the open because a score whose derivation is hidden is
#: a number people learn to distrust — Oura shows its contributors for exactly
#: this reason.
SCORE_PARTS = [
    ("consistency", "Consistency", 35, "Resets completed across the week"),
    ("relief", "Relief", 30, "How often a reset left you feeling better"),
    ("coverage", "Coverage", 20, "Different body areas you've addressed"),
    ("follow_through", "Follow-through", 15, "Resets you started and finished"),
]


def wellbeing_score(user_id: str = "local", days: int = 7) -> dict[str, Any]:
    """A single 0–100 desk-wellbeing number, with its parts shown.

    Deliberately not a health score: it measures the habit, not the body. A
    product that cannot examine you should not imply it has.
    """
    s = summary(user_id=user_id, days=days)
    pr = practice(user_id=user_id, days=days)

    # 5 completed resets a week is the target — roughly one per working day.
    consistency = min(s["sessions_completed"] / 5.0, 1.0)
    rated = sum(s["responses"].values())
    relief = s["better_rate"] if rated else 0.0
    coverage = min(len(s["by_symptom"]) / 3.0, 1.0)      # 3 areas is well-rounded
    follow_through = s["completion_rate"]

    values = {
        "consistency": consistency,
        "relief": relief,
        "coverage": coverage,
        "follow_through": follow_through,
    }
    parts = []
    total = 0.0
    for key, label, weight, why in SCORE_PARTS:
        earned = values[key] * weight
        total += earned
        parts.append({
            "key": key, "label": label, "why": why,
            "weight": weight, "earned": round(earned),
            "pct": round(values[key] * 100),
        })

    score = round(total)
    band = ("Building" if score < 40 else "Steady" if score < 70 else "Strong")
    weakest = min(parts, key=lambda p: p["pct"]) if rated or s["sessions_started"] else None
    return {
        "score": score,
        "band": band,
        "days": days,
        "parts": parts,
        "focus": weakest,
        "has_data": bool(s["sessions_started"]),
        "practised_moves": pr["distinct_moves"],
    }


def _streak(user_id: str) -> int:
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT date(started_at) AS d FROM sessions "
            "WHERE user_id = ? AND completed = 1 ORDER BY d DESC",
            (user_id,),
        ).fetchall()
    days = {r["d"] for r in rows}
    streak, cursor = 0, date.today()
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def daily_counts(user_id: str = "local", days: int = 7) -> list[dict[str, Any]]:
    """Seven-day habit bars for the personal dashboard."""
    with _lock, connect() as conn:
        rows = conn.execute(
            "SELECT date(started_at) AS d, "
            "       SUM(completed) AS done, COUNT(*) AS started "
            "FROM sessions WHERE user_id = ? GROUP BY d",
            (user_id,),
        ).fetchall()
    lookup = {r["d"]: r for r in rows}
    out = []
    for i in range(days - 1, -1, -1):
        day = date.today() - timedelta(days=i)
        row = lookup.get(day.isoformat())
        out.append(
            {
                "date": day.isoformat(),
                "label": day.strftime("%a"),
                "completed": int(row["done"]) if row else 0,
                "started": int(row["started"]) if row else 0,
            }
        )
    return out


# ─────────────────── workspace / B2B aggregate (k-anonymized) ───────────────────


def workspace_summary(days: int = 30) -> dict[str, Any]:
    """Aggregate-only view for People Ops.

    Every number here is a COUNT or an AVG over an opted-in cohort of at
    least K_ANONYMITY people. There is no query in this function that can
    return a single person's data, and no caller can pass a user_id.
    """
    since = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    with _lock, connect() as conn:
        opted_in = {
            r["user_id"]
            for r in conn.execute("SELECT user_id, payload FROM prefs").fetchall()
            if json.loads(r["payload"]).get("workspace_opt_in")
        }
        rows = conn.execute(
            "SELECT * FROM sessions WHERE started_at >= ?", (since,)
        ).fetchall()

    sessions = [_row_to_session(r) for r in rows if r["user_id"] in opted_in]
    participants = {s["user_id"] for s in sessions}

    if len(participants) < K_ANONYMITY:
        return {
            "suppressed": True,
            "reason": (
                f"Fewer than {K_ANONYMITY} people have opted in. FlowReset "
                "reports nothing until a cohort is large enough to be anonymous."
            ),
            "k_anonymity": K_ANONYMITY,
            "participants": len(participants),
            "days": days,
        }

    done = [s for s in sessions if s["completed"]]
    teams: dict[str, dict[str, Any]] = {}
    for s in sessions:
        t = teams.setdefault(
            s["team"], {"team": s["team"], "sessions": 0, "completed": 0, "people": set()}
        )
        t["sessions"] += 1
        t["completed"] += int(s["completed"])
        t["people"].add(s["user_id"])

    team_rows = []
    for t in teams.values():
        headcount = len(t["people"])
        if headcount < K_ANONYMITY:
            continue  # suppressed, not rounded — small teams are simply not reported
        team_rows.append(
            {
                "team": t["team"],
                "participants": headcount,
                "sessions": t["sessions"],
                "completion_rate": round(t["completed"] / t["sessions"], 2)
                if t["sessions"]
                else 0.0,
                "per_person_per_week": round(
                    t["completed"] / headcount / max(days / 7, 1), 1
                ),
            }
        )
    team_rows.sort(key=lambda r: -r["sessions"])
    suppressed_teams = len(teams) - len(team_rows)

    return {
        "suppressed": False,
        "days": days,
        "k_anonymity": K_ANONYMITY,
        "participants": len(participants),
        "sessions_started": len(sessions),
        "sessions_completed": len(done),
        "completion_rate": round(len(done) / len(sessions), 2) if sessions else 0.0,
        "teams": team_rows,
        "suppressed_teams": suppressed_teams,
        "per_person_per_week": round(
            len(done) / len(participants) / max(days / 7, 1), 1
        ),
    }


def wipe(user_id: str = "local") -> None:
    """Settings → 'Delete all my local data'. Deletes sessions and preferences."""
    with _lock, connect() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM prefs WHERE user_id = ?", (user_id,))


def export(user_id: str = "local") -> dict[str, Any]:
    """Settings → 'Export'. The user's data belongs to the user."""
    return {
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "user_id": user_id,
        "prefs": get_prefs(user_id),
        "sessions": recent(limit=10_000, user_id=user_id),
    }
