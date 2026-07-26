"""Seeded demo history.

Two jobs:
  1. The personal dashboard needs a believable week behind it, otherwise the
     charts are empty at 09:00 and the "is it helping?" story doesn't land.
  2. The workspace dashboard needs enough opted-in people to clear the
     k-anonymity floor, or it correctly refuses to show anything.

Everything written here is flagged is_demo=1 so the UI can label it, and the
live session recorded during the demo is the only unflagged row — which is
exactly the moment we want the judges to watch the chart move.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta

from agent import memory

DEMO_USER = "local"

SYMPTOMS = ["neck_shoulders", "back_hips", "wrists_hands", "tired_eyes"]
SYMPTOM_WEIGHTS = [0.45, 0.28, 0.15, 0.12]

MOVES_BY_SYMPTOM = {
    "neck_shoulders": ["neck_side_stretch", "shoulder_rolls", "trap_stretch", "chest_opener"],
    "back_hips": ["seated_twist", "cat_cow", "hip_flexor_reset", "standing_forward_fold"],
    "wrists_hands": ["wrist_stretch", "wrist_prayer", "finger_fan"],
    "tired_eyes": ["eye_horizon", "eye_palming", "eye_figure_eight"],
}

TEAMS = ["Engineering", "Design", "Data", "Support"]


def _insert(conn, user_id, team, when, symptom, duration, moves, completed, response, camera):
    conn.execute(
        "INSERT INTO sessions"
        "(user_id, team, started_at, symptom, duration_min, moves, completed,"
        " response, camera_used, trigger, is_demo) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,1)",
        (
            user_id, team, when.isoformat(timespec="seconds"), symptom, duration,
            json.dumps(moves), int(completed), response, int(camera),
            "watch" if random.random() < 0.25 else "user",
        ),
    )


def seed(force: bool = False, seed_value: int = 7) -> dict[str, int]:
    """Idempotent unless `force`. Returns row counts."""
    memory.init()
    rng = random.Random(seed_value)

    with memory._lock, memory.connect() as conn:
        existing = conn.execute(
            "SELECT COUNT(*) AS n FROM sessions WHERE is_demo = 1"
        ).fetchone()["n"]
        if existing and not force:
            return {"skipped": existing}
        if force:
            conn.execute("DELETE FROM sessions WHERE is_demo = 1")

        personal = 0
        now = datetime.now()

        # ── the demo user's own week ──
        for days_ago in range(13, -1, -1):
            day = now - timedelta(days=days_ago)
            # More sessions on recent days: the habit is forming, which is the story.
            n = rng.choices([0, 1, 2, 3], weights=[0.18, 0.34, 0.32, 0.16])[0]
            for _ in range(n):
                symptom = rng.choices(SYMPTOMS, weights=SYMPTOM_WEIGHTS)[0]
                when = day.replace(
                    hour=rng.choice([10, 11, 14, 15, 16, 17]),
                    minute=rng.randint(0, 59),
                    second=0,
                    microsecond=0,
                )
                duration = rng.choices([1, 2, 3, 5, 10], weights=[0.2, 0.3, 0.3, 0.15, 0.05])[0]
                pool = MOVES_BY_SYMPTOM[symptom]
                moves = rng.sample(pool, k=min(len(pool), rng.randint(2, 3)))
                completed = rng.random() < 0.84
                response = (
                    rng.choices(["better", "same", "worse"], weights=[0.74, 0.21, 0.05])[0]
                    if completed else None
                )
                _insert(conn, DEMO_USER, "Engineering", when, symptom, duration,
                        moves, completed, response, rng.random() < 0.55)
                personal += 1

        # ── a workspace cohort, so the B2B view clears k-anonymity ──
        workspace = 0
        people = []
        for i in range(18):
            uid = f"ws_{i:02d}"
            team = TEAMS[i % len(TEAMS)]
            people.append((uid, team))
            conn.execute(
                "INSERT INTO prefs(user_id, payload) VALUES(?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload",
                (uid, json.dumps({**memory.DEFAULT_PREFS,
                                  "team": team, "workspace_opt_in": True})),
            )

        for uid, team in people:
            engagement = rng.uniform(0.25, 1.0)  # not everyone uses it equally
            for days_ago in range(27, -1, -1):
                if rng.random() > engagement * 0.45:
                    continue
                day = now - timedelta(days=days_ago)
                symptom = rng.choices(SYMPTOMS, weights=SYMPTOM_WEIGHTS)[0]
                when = day.replace(hour=rng.randint(9, 17), minute=rng.randint(0, 59),
                                   second=0, microsecond=0)
                pool = MOVES_BY_SYMPTOM[symptom]
                completed = rng.random() < 0.80
                response = (
                    rng.choices(["better", "same", "worse"], weights=[0.71, 0.24, 0.05])[0]
                    if completed else None
                )
                _insert(conn, uid, team, when, symptom,
                        rng.choice([1, 2, 3, 5]),
                        rng.sample(pool, k=min(len(pool), 2)),
                        completed, response, rng.random() < 0.5)
                workspace += 1

    # The demo user opts in too, so they appear in their own workspace view.
    memory.set_prefs({"team": "Engineering", "workspace_opt_in": True}, DEMO_USER)
    return {"personal": personal, "workspace": workspace, "people": len(people) + 1}


if __name__ == "__main__":
    print(seed(force=True))
