let runNewspaperLines = null;
let runToolEventRecorder = null;

export function setRunNewspaperLines(lines) {
  runNewspaperLines = Array.isArray(lines) ? lines : null;
}

export function getRunNewspaperLines() {
  return runNewspaperLines;
}

export function clearRunNewspaperLines() {
  runNewspaperLines = null;
}

export function setRunToolEventRecorder(recorder) {
  runToolEventRecorder = typeof recorder === "function"
    ? recorder
    : (typeof recorder?.record === "function" ? recorder.record : null);
}

export function submitRunToolEvent(event) {
  if (typeof runToolEventRecorder !== "function") return false;
  try {
    return runToolEventRecorder(event) !== false;
  } catch {
    return false;
  }
}

export function clearRunToolEventRecorder() {
  runToolEventRecorder = null;
}
