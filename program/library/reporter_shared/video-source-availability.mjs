function decodeHtmlEntities(text = "") {
  return String(text).replace(/&quot;/giu, "\"").replace(/&#39;/giu, "'").replace(/&amp;/giu, "&");
}

export function isIsiStandalonePlayerUrl(url = "") {
  try {
    const parsed = new URL(String(url));
    return parsed.hostname.toLowerCase().endsWith("escribemeetings.com")
      && parsed.pathname.toLowerCase().includes("/players/isistandaloneplayer.aspx");
  } catch {
    return false;
  }
}

function embeddedIsiMediaUrl(html = "") {
  const direct = String(html).match(/https:\/\/video\.isilive\.ca\/[^"'<> \t\r\n]+/iu)?.[0];
  if (direct) return decodeHtmlEntities(direct);
  const client = String(html).match(/data-client_id=(["'])(.*?)\1/iu)?.[2];
  const filename = String(html).match(/data-(?:file_name|stream_name)=(["'])(.*?)\1/iu)?.[2];
  if (!client || !filename) return "";
  return `https://video.isilive.ca/${encodeURIComponent(decodeHtmlEntities(client).trim())}/${encodeURIComponent(decodeHtmlEntities(filename).trim())}`;
}

async function responseOk(fetchImpl, url, method) {
  try {
    const response = await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(8000),
    });
    return response?.ok ? response : null;
  } catch {
    return null;
  }
}

export async function isReachableIsiPlayerSource(playerUrl, { fetchImpl = fetch } = {}) {
  if (!isIsiStandalonePlayerUrl(playerUrl)) return true;
  const player = await responseOk(fetchImpl, playerUrl, "GET");
  if (!player) return false;
  const mediaUrl = embeddedIsiMediaUrl(await player.text());
  if (!mediaUrl) return false;
  return Boolean(await responseOk(fetchImpl, mediaUrl, "HEAD"));
}

export async function isiMeetingVideoIsReachable(payload = {}, options = {}) {
  const urls = Array.isArray(payload?.video) ? payload.video.map(String).filter(Boolean) : [];
  const isiPlayers = urls.filter(isIsiStandalonePlayerUrl);
  if (urls.some((url) => !isIsiStandalonePlayerUrl(url))) return true;
  if (!isiPlayers.length) return true;
  for (const playerUrl of isiPlayers) {
    if (await isReachableIsiPlayerSource(playerUrl, options)) return true;
  }
  return false;
}
