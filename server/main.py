"""FastAPI glue — lane 4.

One process: perception thread + agent task + WebSocket broadcast.
Serves ui/ statics, /ws per contracts.md Transport, pipes coach.speak
to Piper. Integration checkpoints: 13:00 skeleton end-to-end,
16:00 full loop.
"""

# TODO(lane 4): implement at the event
