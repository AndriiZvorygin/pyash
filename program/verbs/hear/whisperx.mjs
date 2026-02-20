function normalizeHost(host) {
  const raw = String(host ?? "").trim();
  if (!raw) return "http://localhost:8000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export async function transcribeWithWhisperx({
  host,
  inputPath,
  outputPath,
  language = "en",
  model = "large-v3",
  diarize = false
} = {}) {
  const endpoint = `${normalizeHost(host)}/transcribe`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: inputPath,
      output_srt: outputPath,
      language,
      model,
      diarize
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`whisperx defective: ${message}`);
  }
  return payload;
}

export async function dischargeWhisperx({ host } = {}) {
  const endpoint = `${normalizeHost(host)}/discharge`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`whisperx discharge defective: ${message}`);
  }
  return payload;
}
