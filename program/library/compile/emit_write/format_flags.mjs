export function readWriteFormat(sentence) {
  const formatParts = [];
  if (sentence?.become?.name) formatParts.push(sentence.become.name);
  if (sentence?.become?.text) formatParts.push(sentence.become.text);
  const formatRaw = formatParts.join(" ").trim().toLowerCase();
  const jsonMode = formatRaw.includes("json")
    ? (formatRaw.includes("beautiful") ? "pretty" : "canonical")
    : null;
  const wantJson = jsonMode !== null;
  const wantYaml = formatRaw.includes("yaml");
  const wantCsv = formatRaw.includes("csv");
  return { formatRaw, jsonMode, wantJson, wantYaml, wantCsv };
}
