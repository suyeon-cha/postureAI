/* Camera doctor — paste into the DevTools console on http://localhost:8000
 * (or :8017 locally) and read the verdict. It names the layer that is
 * actually blocking, because "camera doesn't work" has five unrelated causes
 * and they need different fixes — OS, browser, site, hardware, or origin.
 *
 * Run it from the page itself, not from an artifact or a file:// document.
 */
(async () => {
  const out = {};
  const log = (k, v) => { out[k] = v; };

  // 1. Origin. getUserMedia only exists on a secure context: https, or
  //    localhost. http://<lan-ip> silently has no camera API at all.
  log("origin", location.origin);
  log("secureContext", window.isSecureContext);
  log("apiPresent", !!navigator.mediaDevices?.getUserMedia);

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    log("VERDICT", "Insecure origin. Open http://localhost:PORT — over the " +
      "network use an SSH tunnel, not the box's IP.");
    console.table(out);
    return out;
  }

  // 2. Does the browser already know the answer?
  try {
    const p = await navigator.permissions.query({ name: "camera" });
    log("permission", p.state);           // granted | denied | prompt
  } catch { log("permission", "unqueryable"); }

  // 3. Is there a camera at all, and has the OS released its label?
  //    Labels stay empty until permission is granted — a useful signal.
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  log("cameraCount", cams.length);
  log("cameraLabels", cams.map((d) => d.label || "(hidden until granted)").join(", "));

  // 4. Actually ask. The error name is the diagnosis.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    log("stream", "acquired");
    log("track", `${track.label} · ${track.readyState}`);
    stream.getTracks().forEach((t) => t.stop());
    log("VERDICT", "Camera works. If the panel is still black the bug is in " +
      "the app, not permissions — check that #cam has a srcObject.");
  } catch (e) {
    log("errorName", e.name);
    log("errorMessage", e.message);
    log("VERDICT", {
      NotAllowedError:
        "Blocked. Two places to check, in order: macOS System Settings > " +
        "Privacy & Security > Camera > enable Chrome (needs a Chrome restart), " +
        "then the camera icon in Chrome's address bar > Always allow.",
      NotFoundError: "No camera detected by the OS at all.",
      NotReadableError:
        "Camera is held by another app. Quit Zoom / Teams / Photo Booth / " +
        "FaceTime and retry.",
      OverconstrainedError: "Requested resolution unavailable on this device.",
      AbortError: "OS-level failure. Restart Chrome.",
      SecurityError: "Blocked by permissions policy — you are likely inside " +
        "an iframe that disallows camera. Open the page directly.",
    }[e.name] || "Unrecognised failure — report errorName above.");
  }

  console.table(out);
  return out;
})();
