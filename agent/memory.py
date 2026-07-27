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
