export function parseAdbDevicesOutput(text = "") {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    if (line.toLowerCase().startsWith("list of devices attached")) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    const details = parts.slice(2).join(" ");
    out.push({ serial, state, details, raw: line });
  }
  return out;
}

export function upsertAndroidDeviceIdSentence(text = "", serial = "") {
  const selected = String(serial ?? "").trim();
  if (!selected) throw new Error("android default device defective: missing serial");
  const nextLine = `exists su name android device id ob text ${JSON.stringify(selected)} be default ya`;
  const body = String(text ?? "");
  const pattern = /^\s*(?:exists\s+)?su name android device id ob text .*?(?:\s+be default)?\s+ya\s*$/m;
  if (pattern.test(body)) {
    const replaced = body.replace(pattern, nextLine);
    return replaced.endsWith("\n") ? replaced : `${replaced}\n`;
  }
  if (!body.trim()) return `${nextLine}\n`;
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `${trimmed}\n${nextLine}\n`;
}
