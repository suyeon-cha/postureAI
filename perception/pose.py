"""Camera capture + MediaPipe PoseLandmarker.

Owns: webcam loop, pose_landmarker_heavy.task (LIVE_STREAM mode),
keypoint extraction. Emits raw 33-landmark frames to detectors.

Keep everything behind get_keypoints(frame) so the backend can be
swapped (e.g. Ultralytics) without touching detectors.
"""

# TODO(lane 1): implement at the event
