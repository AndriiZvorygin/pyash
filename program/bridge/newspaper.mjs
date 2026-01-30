let runNewspaperLines = null;

export function setRunNewspaperLines(lines) {
  runNewspaperLines = Array.isArray(lines) ? lines : null;
}

export function getRunNewspaperLines() {
  return runNewspaperLines;
}

export function clearRunNewspaperLines() {
  runNewspaperLines = null;
}
