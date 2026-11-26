import fs from "node:fs/promises";
import { EventEmitter } from "node:events";

import { downloadUrlFor } from "./download.mjs";

// A client that cannot keep up is dropped rather than allowed to hold the
// station back. The threshold is generous: it covers a slow network for
// several seconds of audio.
const MAX_CLIENT_BUFFER_BYTES = 4 * 1024 * 1024;

// The station hands the listeners audio in pieces of about this size. Small
// pieces keep the pacing honest: the audio the station has sent runs ahead of
// the clock of the station by the size of one piece, and a listener reads the
// words against the audio that has reached them. Large ones keep the socket
// quiet.
const PIECE_BYTES = 8 * 1024;

// The programme the station keeps in mind: the songs that went out, and when
// they went out. A listener needs it to know which song the audio they hear
// belongs to.
const PROGRAMME_KEEP = 12;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * Shuffle the songs. A radio does not play in alphabetical order, and it does
 * not play the same programme twice: the station keeps a bag of the songs and
 * empties it before it fills it again, so every song of the rotation is heard
 * once before any of them is heard twice.
 */
export function shuffleTracks(tracks = [], random = Math.random) {
  const list = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  const shuffled = [...list];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = shuffled[index];
    shuffled[index] = shuffled[swap];
    shuffled[swap] = held;
  }
  return shuffled;
}

/**
 * The station plays the catalogue in a loop and hands the same audio to every
 * listener, the way a broadcast does. The programme advances on its own
 * clock, so the station keeps playing whether or not anyone is listening, and
 * a listener who tunes in late joins the song that is playing.
 */
export function createRadioStation({ tracks = [], gapMs = 500, now = () => Date.now(), random = Math.random } = {}) {
  const emitter = new EventEmitter();
  const clients = new Set();
  let playlist = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  let index = -1;
  let bag = [];
  let trackStartedAt = 0;
  let timer = null;
  let stopped = false;
  let started = false;
  let generation = 0;
  // The song that is playing, and the song that will play next. The station
  // is silent for a moment between two songs, and the song that is playing
  // is still the song that is playing during that moment.
  let pending = -1;
  // The audio the station has sent, in seconds of song. It is the clock the
  // words are timed against: a listener hears the audio the station has
  // already sent.
  let contentSeconds = 0;
  // The songs that went out, and the place they took in the audio.
  let programme = [];
  // The identity of this run of the station. A listener that hears the
  // identity change knows the station was restarted under them.
  const epoch = `epoch-${now()}-${Math.floor(random() * 1e9)}`;

  function currentTrack() {
    return index >= 0 ? playlist[index] ?? null : null;
  }

  /**
   * The next song to play: the next one out of the bag, and a fresh bag when
   * the bag is empty. The song that is playing is never put back into the
   * bag, so no song is heard twice before the rest of the rotation has been.
   */
  function nextTrackIndex() {
    if (!playlist.length) return -1;
    const playing = currentTrack();
    if (!bag.length) {
      const rest = playing ? playlist.filter((track) => track.filename !== playing.filename) : playlist;
      bag = shuffleTracks(rest, random).map((track) => track.filename);
    }
    while (bag.length) {
      const name = bag.pop();
      const at = playlist.findIndex((track) => track.filename === name);
      if (at >= 0) return at;
    }
    return Math.floor(random() * playlist.length);
  }

  function dropClient(client) {
    if (!clients.has(client)) return;
    clients.delete(client);
    try {
      client.destroy();
    } catch {
      // the socket is already gone
    }
  }

  function fanOut(chunk) {
    for (const client of [...clients]) {
      if (client.destroyed || client.writableEnded) {
        clients.delete(client);
        continue;
      }
      if (client.writableLength > MAX_CLIENT_BUFFER_BYTES) {
        dropClient(client);
        continue;
      }
      client.write(chunk);
    }
  }

  async function playCurrent() {
    if (stopped || !playlist.length) return;
    if (pending < 0 || !playlist[pending]) pending = nextTrackIndex();
    if (pending < 0) return;
    index = pending;
    pending = -1;
    const track = currentTrack();
    if (!track) return;
    const mine = generation;
    trackStartedAt = now();
    // The song takes its place in the audio of the station.
    const entry = {
      filename: track.filename,
      title: track.title,
      topic: track.topic,
      engine: track.engine,
      contentStart: contentSeconds,
      contentEnd: contentSeconds,
      startedAt: trackStartedAt,
      durationSeconds: Number(track.durationSeconds ?? 0)
    };
    programme = [...programme, entry].slice(-PROGRAMME_KEEP);
    emitter.emit("track", { index, track, entry });
    let buffer = null;
    try {
      buffer = await fs.readFile(track.path);
    } catch {
      buffer = null;
    }
    if (stopped || generation !== mine) return;
    if (!buffer) {
      advance();
      return;
    }
    const offsets = track.frameOffsets ?? [];
    const frameSeconds = Number(track.frameSeconds ?? 0);
    if (!offsets.length || !frameSeconds) {
      // Without a frame clock the station falls back to the measured length of
      // the track: the audio is written once and the station waits out the
      // rest of the song.
      fanOut(buffer.subarray(track.dataOffset ?? 0));
      contentSeconds = entry.contentStart + Number(track.durationSeconds ?? 0);
      entry.contentEnd = contentSeconds;
      await sleep(Math.max(0, (Number(track.durationSeconds ?? 0) - 0.05) * 1000));
      advance();
      return;
    }
    const started = now();
    let pieces = [];
    let pieceBytes = 0;
    for (let frame = 0; frame < offsets.length; frame += 1) {
      if (stopped || generation !== mine) return;
      const begin = offsets[frame];
      const end = frame + 1 < offsets.length ? offsets[frame + 1] : buffer.length;
      if (end <= begin) continue;
      pieces.push(buffer.subarray(begin, end));
      pieceBytes += end - begin;
      if (pieceBytes < PIECE_BYTES && frame + 1 < offsets.length) continue;
      fanOut(Buffer.concat(pieces, pieceBytes));
      pieces = [];
      pieceBytes = 0;
      // The audio that has gone out is the clock the words are timed against.
      contentSeconds = entry.contentStart + (frame + 1) * frameSeconds;
      entry.contentEnd = contentSeconds;
      const due = started + (frame + 1) * frameSeconds * 1000;
      const wait = due - now();
      if (wait > 0) await sleep(wait);
    }
    advance();
  }

  function advance() {
    if (stopped || !playlist.length) return;
    pending = nextTrackIndex();
    if (gapMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        playCurrent();
      }, gapMs);
      return;
    }
    playCurrent();
  }

  function subscribe(client) {
    clients.add(client);
    const leave = () => {
      clients.delete(client);
    };
    client.on("close", leave);
    client.on("error", leave);
    return leave;
  }

  /**
   * Take a fresh catalogue. The track that is playing keeps playing when it
   * survives the change; when it does not, the station moves to the head of
   * the new catalogue. The bag of songs is emptied, so the new catalogue is
   * heard in a fresh order.
   */
  function setTracks(next) {
    const list = Array.isArray(next) ? next.filter(Boolean) : [];
    const playing = currentTrack();
    const keep = playing ? list.findIndex((track) => track.filename === playing.filename) : -1;
    const waiting = pending >= 0 ? playlist[pending] : null;
    playlist = list;
    bag = [];
    if (!playlist.length) {
      index = -1;
      pending = -1;
      generation += 1;
      return;
    }
    if (keep >= 0) {
      index = keep;
      // The song that was going to play keeps its place, if it is still here.
      pending = waiting ? list.findIndex((track) => track.filename === waiting.filename) : -1;
      return;
    }
    pending = nextTrackIndex();
    if (playing) {
      generation += 1;
      playCurrent();
    }
  }

  function state() {
    const track = currentTrack();
    return {
      playing: Boolean(track) && !stopped,
      index,
      total: playlist.length,
      track: track ? {
        filename: track.filename,
        title: track.title,
        topic: track.topic,
        engine: track.engine,
        durationSeconds: track.durationSeconds,
        downloadUrl: downloadUrlFor(track.filename)
      } : null,
      startedAt: trackStartedAt ? new Date(trackStartedAt).toISOString() : "",
      elapsedSeconds: trackStartedAt ? Math.max(0, (now() - trackStartedAt) / 1000) : 0,
      listeners: clients.size,
      epoch,
      contentSeconds,
      programme: programme.map((entry) => ({ ...entry }))
    };
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    pending = nextTrackIndex();
    playCurrent();
  }

  function stop() {
    stopped = true;
    generation += 1;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const client of [...clients]) {
      clients.delete(client);
      try {
        client.end();
      } catch {
        // the socket is already gone
      }
    }
  }

  return {
    emitter,
    get tracks() {
      return playlist;
    },
    subscribe,
    setTracks,
    state,
    start,
    stop,
    on(event, handler) {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    }
  };
}
