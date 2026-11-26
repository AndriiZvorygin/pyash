// The station page. It is the front door of the radio: it shows what is
// playing, it lists the catalogue, and it plays the same stream any other
// player would.

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds ?? 0)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * Render the station page. The stream url is passed in so the page can be
 * served from any host the station is bound to.
 */
export function renderStationPage({ stationName = "Radio", streamUrl = "/stream.mp3", statusUrl = "/status.json", playlistUrl = "/playlist.json", lyricsUrl = "/lyrics.json" } = {}) {
  const title = escapeText(stationName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2.5rem 1.5rem; background: #0d0f14; color: #e8e6e1;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { margin: 0 0 .25rem; font-size: 1.9rem; letter-spacing: .01em; }
  .tagline { margin: 0 0 2rem; color: #8b8f9c; }
  .now { border: 1px solid #23262f; border-radius: .75rem; padding: 1.25rem; background: #14171e; }
  .now .label { color: #8b8f9c; font-size: .78rem; text-transform: uppercase; letter-spacing: .12em; }
  .now .title { font-size: 1.35rem; margin: .35rem 0 .15rem; }
  .now .meta { color: #8b8f9c; font-size: .9rem; }
  button { margin-top: 1.25rem; padding: .7rem 1.4rem; border-radius: .5rem; border: 0;
           background: #d8a657; color: #17140e; font-size: 1rem; font-weight: 600; cursor: pointer; }
  button:hover { background: #e6b76e; }
  audio { width: 100%; margin-top: 1.25rem; }
  h2 { margin: 2.5rem 0 .75rem; font-size: 1.05rem; color: #c9c6bf; }
  ol { margin: 0; padding-left: 1.2rem; }
  li { margin: .35rem 0; color: #b9b6af; }
  li .meta { color: #6f7380; }
  li .download { margin-left: .6rem; color: #d8a657; font-size: .85rem; text-decoration: none;
                 border-bottom: 1px solid #4a3d22; }
  li .download:hover { color: #e6b76e; }
  a.download { display: inline-block; margin-left: .6rem; padding: .35rem .8rem; border-radius: .4rem;
               border: 1px solid #4a3d22; color: #d8a657; font-size: .85rem; text-decoration: none; }
  a.download:hover { background: #1d212a; color: #e6b76e; }
  .now a.download { margin-top: .9rem; }
  .now .playing { color: #d8a657; font-size: .8rem; text-transform: uppercase; letter-spacing: .12em; }
  .ticker { margin-top: 1.25rem; border: 1px solid #23262f; border-radius: .5rem; background: #14171e; overflow: hidden; }
  .ticker .label { color: #8b8f9c; font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; padding: .5rem .9rem 0; }
  .ticker .run { display: inline-block; white-space: nowrap; padding: .35rem 0 .5rem; color: #d8a657; font-size: .95rem;
                 animation: ticker-run 26s linear infinite; }
  @keyframes ticker-run { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
  .words { margin-top: .9rem; }
  .words .now-line { color: #e8e6e1; font-size: 1.05rem; line-height: 1.5; }
  .words .next-line { color: #6f7380; font-size: .95rem; line-height: 1.5; margin-top: .35rem; }
  .words .empty { color: #6f7380; font-size: .95rem; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p class="tagline">Plain HTTP stream. Tune in with any player.</p>
  <section class="now">
    <div class="label">Now playing</div>
    <div class="title" id="now-title">Loading the station</div>
    <div class="meta" id="now-meta"></div>
    <div id="now-download"></div>
    <button id="tune" type="button">Tune in</button>
    <audio id="player" controls preload="none" src="${escapeText(streamUrl)}"></audio>
    <div class="words" id="words"><div class="empty">The words of the song will follow it here.</div></div>
  </section>
  <div class="ticker" id="ticker">
    <div class="label">Sung now</div>
    <div class="run" id="ticker-run"></div>
  </div>
  <h2>Catalogue</h2>
  <p class="tagline">Every song can be taken home.</p>
  <ol id="catalogue"></ol>
</main>
<script>
  const player = document.getElementById("player");
  const nowTitle = document.getElementById("now-title");
  const nowMeta = document.getElementById("now-meta");
  const nowDownload = document.getElementById("now-download");
  const wordsBox = document.getElementById("words");
  const tickerRun = document.getElementById("ticker-run");
  document.getElementById("tune").addEventListener("click", () => player.play());

  // The words of the song that is playing, and the clock of the song itself.
  let words = { filename: "", source: "none", lines: [] };
  let clockOffset = 0;
  let shownLine = -1;

  function downloadLink(url, label) {
    if (!url) return null;
    const link = document.createElement("a");
    link.className = "download";
    link.href = url;
    link.textContent = label || "Download";
    link.setAttribute("download", "");
    return link;
  }

  function songSeconds() {
    return Date.now() / 1000 + clockOffset;
  }

  function lineIndexAt(lines, seconds) {
    if (!lines.length) return -1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (seconds < Number(line.start || 0)) return index === 0 ? 0 : index - 1;
      if (seconds <= Number(line.end || 0)) return index;
    }
    return lines.length - 1;
  }

  function renderWords() {
    const lines = words.lines || [];
    const index = lineIndexAt(lines, songSeconds());
    if (index === shownLine) return;
    shownLine = index;
    const current = index >= 0 ? lines[index] : null;
    const next = index >= 0 && index + 1 < lines.length ? lines[index + 1] : null;
    wordsBox.replaceChildren();
    if (!current) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = words.source === "none"
        ? "The words of the song will follow it here."
        : "The song is between its words.";
      wordsBox.append(empty);
      tickerRun.textContent = "";
      return;
    }
    const line = document.createElement("div");
    line.className = "now-line";
    line.textContent = current.text;
    wordsBox.append(line);
    if (next) {
      const after = document.createElement("div");
      after.className = "next-line";
      after.textContent = next.text;
      wordsBox.append(after);
    }
    // The running ticker takes the line again, so it starts its run with the
    // words that are being sung now.
    tickerRun.textContent = current.text + "  ·  ";
    tickerRun.style.animation = "none";
    void tickerRun.offsetWidth;
    tickerRun.style.animation = "";
  }

  async function loadWords() {
    try {
      const response = await fetch(${JSON.stringify(lyricsUrl)}, { cache: "no-store" });
      const payload = await response.json();
      if (payload.filename !== words.filename) {
        words = payload;
        shownLine = -1;
        renderWords();
      }
    } catch (error) {
      // the words are a convenience; the stream is the station
    }
  }

  async function refresh() {
    try {
      const response = await fetch(${JSON.stringify(statusUrl)}, { cache: "no-store" });
      const status = await response.json();
      if (!status.track) {
        nowTitle.textContent = "The catalogue is empty";
        nowMeta.textContent = "No rendered track is waiting to play.";
        nowDownload.replaceChildren();
        return;
      }
      nowTitle.textContent = status.track.title;
      const played = Math.floor(status.elapsedSeconds || 0);
      nowMeta.textContent = status.track.engine + " - " + status.track.topic
        + " - " + played + "s of " + Math.round(status.track.durationSeconds || 0) + "s"
        + " - " + status.listeners + " listening";
      const link = downloadLink(status.track.downloadUrl, "Download this song");
      nowDownload.replaceChildren(...(link ? [link] : []));
      clockOffset = Number(status.elapsedSeconds || 0) - Date.now() / 1000;
      await loadWords();
    } catch (error) {
      nowTitle.textContent = "The station is out of reach";
    }
  }

  async function loadCatalogue() {
    try {
      const response = await fetch(${JSON.stringify(playlistUrl)}, { cache: "no-store" });
      const payload = await response.json();
      const list = document.getElementById("catalogue");
      list.innerHTML = "";
      // The list is alphabetical, so a listener can find a song by its name.
      // The station itself does not play in this order: the programme plays
      // the house's songs first and then the lanes, and the bag decides the
      // rest.
      const tracks = [...(payload.tracks || [])].sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? "")));
      for (const track of tracks) {
        const item = document.createElement("li");
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = " - " + track.engine + " - " + Math.round(track.durationSeconds || 0) + "s";
        item.append(track.title, meta);
        const link = downloadLink(track.downloadUrl, "Download");
        if (link) item.append(link);
        list.append(item);
      }
    } catch (error) {
      // the catalogue is a convenience; the stream is the station
    }
  }

  refresh();
  loadCatalogue();
  setInterval(refresh, 3000);
  // The words follow the song between the polls of the clock.
  function follow() {
    renderWords();
    requestAnimationFrame(follow);
  }
  requestAnimationFrame(follow);
</script>
</body>
</html>
`;
}

export { formatDuration };
