// The station page. It is the front door of the radio: it shows what is
// playing, it lists the catalogue, and it plays the same stream any other
// player would.
//
// The station carries a channel per programme. The page shows them, and the
// url of each: a listener who wants the night programme in another player
// takes the plain mp3 url and opens it there.

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
 * The json of the channels, in a block of its own: the closing tag cannot
 * appear in it, so the page cannot be broken by a name.
 */
function channelData(channels) {
  return JSON.stringify(channels).replace(/</gu, "\\u003c");
}

/**
 * Render the station page. The channels are passed in so the page can show
 * the picker and the plain url of the stream, whichever channel was asked
 * for.
 */
export function renderStationPage({ stationName = "Radio", channels = [], channel = null } = {}) {
  const title = escapeText(stationName);
  const list = Array.isArray(channels) ? channels : [];
  const chosen = channel ?? list[0] ?? null;
  const streamUrl = escapeText(chosen?.streamUrl ?? "/stream.mp3");
  const picker = list.map((entry) => {
    const name = escapeText(entry.name);
    const bpm = Number(entry.bpm ?? 0);
    const pace = bpm > 0 ? `${Math.round(bpm)} bpm` : "the house's own pace";
    const songs = Number(entry.songs ?? 0);
    const current = entry.name === chosen?.name;
    return `      <a class="channel${current ? " current" : ""}" href="/?channel=${name}"${current ? ' aria-current="true"' : ""}>
        <span class="channel-name">${name}</span>
        <span class="channel-pace">${escapeText(pace)}</span>
        <span class="channel-songs">${songs} song${songs === 1 ? "" : "s"}</span>
      </a>`;
  }).join("\n");
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
  .tagline { margin: 0 0 1.5rem; color: #8b8f9c; }
  .channels { display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1.75rem; }
  .channel { display: flex; flex-direction: column; gap: .1rem; padding: .55rem .9rem; border-radius: .55rem;
             border: 1px solid #23262f; background: #14171e; color: #e8e6e1; text-decoration: none; min-width: 8rem; }
  .channel:hover { border-color: #4a3d22; }
  .channel.current { border-color: #d8a657; }
  .channel-name { font-weight: 600; }
  .channel-pace, .channel-songs { color: #8b8f9c; font-size: .78rem; }
  .now { border: 1px solid #23262f; border-radius: .75rem; padding: 1.25rem; background: #14171e; }
  .now .label { color: #8b8f9c; font-size: .78rem; text-transform: uppercase; letter-spacing: .12em; }
  .now .title { font-size: 1.35rem; margin: .35rem 0 .15rem; }
  .now .meta { color: #8b8f9c; font-size: .9rem; }
  .now .listen { margin-top: .9rem; color: #6f7380; font-size: .85rem; }
  .now .listen code { color: #d8a657; font-size: .9rem; word-break: break-all; }
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
  a.download:hover { background: #1d212a; }
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
  .find { margin: 0 0 .75rem; display: flex; gap: .6rem; align-items: center; }
  .find input { flex: 1; padding: .5rem .7rem; border-radius: .45rem; border: 1px solid #2b2f3a;
                background: #14171e; color: #e8e6e1; font-size: .95rem; font-family: inherit; }
  .find input:focus { outline: none; border-color: #4a3d22; }
  .find .count { color: #6f7380; font-size: .85rem; white-space: nowrap; }
  .empty-list { color: #6f7380; font-size: .95rem; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p class="tagline">Plain HTTP stream. Tune in with any player.</p>
  <nav class="channels" id="channels">
${picker}
  </nav>
  <section class="now">
    <div class="label">Now playing</div>
    <div class="title" id="now-title">Loading the station</div>
    <div class="meta" id="now-meta"></div>
    <div id="now-download"></div>
    <p class="listen">This channel, in any player: <code id="listen-url">${streamUrl}</code></p>
    <button id="tune" type="button">Tune in</button>
    <audio id="player" controls preload="none" src="${streamUrl}"></audio>
    <div class="words" id="words"><div class="empty">The words of the song will follow it here.</div></div>
  </section>
  <div class="ticker" id="ticker">
    <div class="label">Sung now</div>
    <div class="run" id="ticker-run"></div>
  </div>
  <h2>Catalogue</h2>
  <p class="tagline">Every song can be taken home.</p>
  <div class="find">
    <input id="find" type="search" placeholder="Find a song" autocomplete="off" aria-label="Find a song">
    <span class="count" id="find-count"></span>
  </div>
  <ol id="catalogue"></ol>
</main>
<script id="channel-data" type="application/json">${channelData(list)}</script>
<script>
  const player = document.getElementById("player");
  const nowTitle = document.getElementById("now-title");
  const nowMeta = document.getElementById("now-meta");
  const nowDownload = document.getElementById("now-download");
  const wordsBox = document.getElementById("words");
  const tickerRun = document.getElementById("ticker-run");
  document.getElementById("tune").addEventListener("click", () => player.play());

  // The channel the listener asked for. The page is a page of one channel,
  // and the channel is named in the address.
  const channels = JSON.parse(document.getElementById("channel-data").textContent || "[]");
  const asked = new URLSearchParams(location.search).get("channel") || "";
  const channel = channels.find((entry) => entry.name === asked) || channels[0] || { name: "", streamUrl: "/stream.mp3" };
  const listenUrl = document.getElementById("listen-url");
  if (listenUrl && channel.streamUrl) listenUrl.textContent = location.origin + channel.streamUrl;

  // The songs the station has streamed, and the place they take in the audio
  // it has sent. The words of a song come with the song.
  let songs = [];
  // The audio the station has sent, in seconds of song, and the moment the
  // browser was told about it.
  let contentSeconds = 0;
  let contentAt = Date.now();
  let epoch = "";
  let listeners = 0;
  let shownLine = -1;
  let shownSong = "";
  let shownSecond = -1;
  // The audio the listener is hearing, and whether the listener has heard any
  // yet.
  let heardContent = 0;
  let hasPlayed = false;
  // The catalogue as the station last reported it, so the listener can find a
  // song by a word of its name without the station being asked again.
  let catalogue = [];

  function downloadLink(url, label) {
    if (!url) return null;
    const link = document.createElement("a");
    link.className = "download";
    link.href = url;
    link.textContent = label || "Download";
    link.setAttribute("download", "");
    return link;
  }

  // The audio the station has sent, grown by the time that has passed since
  // the browser was told about it.
  function sentAudio() {
    return contentSeconds + Math.max(0, (Date.now() - contentAt) / 1000);
  }

  // The audio that has reached the browser but has not been played yet. The
  // listener hears the audio that is behind that.
  function waitingAudio() {
    if (!player.buffered.length) return 0;
    return Math.max(0, player.buffered.end(player.buffered.length - 1) - player.currentTime);
  }

  // The audio the listener is hearing right now.
  function heardAudio() {
    if (hasPlayed && player.paused) return heardContent;
    const content = sentAudio() - waitingAudio();
    if (hasPlayed) heardContent = content;
    return content;
  }

  // The song that holds that audio.
  function songAt(content) {
    let found = null;
    for (const song of songs) {
      const start = Number(song.contentStart || 0);
      const end = start + Number(song.durationSeconds || 0);
      if (content >= start && content < end) found = song;
    }
    return found || songs[songs.length - 1] || null;
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

  function showSong(song) {
    nowTitle.textContent = song.title || "The station is between its songs";
    const link = downloadLink(song.downloadUrl, "Download this song");
    nowDownload.replaceChildren(...(link ? [link] : []));
    shownSecond = -1;
  }

  function renderWords() {
    const content = heardAudio();
    const song = songAt(content);
    if (!song) {
      wordsBox.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "The station is getting ready.";
      wordsBox.append(empty);
      tickerRun.textContent = "";
      return;
    }
    if (song.filename !== shownSong) {
      shownSong = song.filename;
      shownLine = -1;
      showSong(song);
    }
    const seconds = content - Number(song.contentStart || 0);
    const played = Math.max(0, Math.floor(seconds));
    if (played !== shownSecond) {
      shownSecond = played;
      nowMeta.textContent = song.engine + " - " + song.topic
        + " - " + played + "s of " + Math.round(Number(song.durationSeconds || 0)) + "s"
        + " - " + listeners + " listening";
    }
    const lines = song.lines || [];
    const index = lineIndexAt(lines, seconds);
    if (index === shownLine) return;
    shownLine = index;
    const current = index >= 0 ? lines[index] : null;
    const next = index >= 0 && index + 1 < lines.length ? lines[index + 1] : null;
    wordsBox.replaceChildren();
    if (!current) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "The song is between its words.";
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

  // The station streams the words of the song in step with the audio it
  // sends. A listener hears the song the words belong to.
  function openStream() {
    const source = new EventSource("/events?channel=" + encodeURIComponent(channel.name));
    source.addEventListener("song", (event) => {
      let song = null;
      try {
        song = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (epoch && song && songs.length && songs[songs.length - 1].filename === song.filename) {
        return;
      }
      songs = [...songs, song].slice(-6);
    });
    source.addEventListener("clock", (event) => {
      let clock = null;
      try {
        clock = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (clock.epoch && epoch && clock.epoch !== epoch) {
        // the station was restarted: the audio starts over
        songs = [];
        shownSong = "";
        shownLine = -1;
      }
      epoch = clock.epoch || epoch;
      contentSeconds = Number(clock.contentSeconds || 0);
      contentAt = Date.now();
      listeners = Number(clock.listeners || 0);
    });
    source.addEventListener("error", () => {
      // the stream will come back on its own
    });
  }

  player.addEventListener("playing", () => {
    hasPlayed = true;
  });

  async function loadCatalogue() {
    try {
      const response = await fetch("/playlist.json?channel=" + encodeURIComponent(channel.name), { cache: "no-store" });
      const payload = await response.json();
      // The list is alphabetical, so a listener can find a song by its name.
      // The station itself does not play in this order: the programme plays
      // the house's songs first and then the lanes, and the bag decides the
      // rest.
      catalogue = [...(payload.tracks || [])].sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? "")));
      renderCatalogue();
    } catch (error) {
      // the catalogue is a convenience; the stream is the station
    }
  }

  function renderCatalogue() {
    const list = document.getElementById("catalogue");
    const count = document.getElementById("find-count");
    const asked = String(document.getElementById("find").value ?? "").trim().toLowerCase();
    const found = asked
      ? catalogue.filter((track) => String(track.title ?? "").toLowerCase().includes(asked)
        || String(track.topic ?? "").toLowerCase().includes(asked)
        || String(track.engine ?? "").toLowerCase().includes(asked))
      : catalogue;
    list.replaceChildren();
    if (asked) {
      count.textContent = found.length + " of " + catalogue.length;
    } else {
      count.textContent = catalogue.length + " songs";
    }
    if (!found.length) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "No song carries that name.";
      list.append(empty);
      return;
    }
    for (const track of found) {
      const item = document.createElement("li");
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = " - " + track.engine + " - " + Math.round(track.durationSeconds || 0) + "s";
      item.append(track.title, meta);
      const link = downloadLink(track.downloadUrl, "Download");
      if (link) item.append(link);
      list.append(item);
    }
  }

  document.getElementById("find").addEventListener("input", renderCatalogue);

  openStream();
  loadCatalogue();
  // The words follow the song between the moments the station speaks.
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
