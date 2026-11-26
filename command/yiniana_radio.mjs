#!/usr/bin/env node
// The Yiniana radio station. It serves the rendered catalogue as a plain HTTP
// mp3 stream, the way a listener expects a radio to behave: one programme,
// many listeners, the song changes by itself.
//
// The station carries a channel per programme. A channel is a name, a voice, a
// pace, and a set of lanes: the day channel plays the house's own programme
// at the tempo it has always sung at, and the night channel plays the calm
// lanes slow. Each channel has its own stream, and the stream of a channel is
// a plain mp3 at a plain url, so any player can open it.

import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigMap, resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { publicCatalogue, scanCatalogue } from "../program/library/radio/catalogue.mjs";
import { channelByName, channelProgrammes, readChannels } from "../program/library/radio/channels.mjs";
import { DOWNLOAD_PREFIX, LISTEN_PREFIX, downloadNameFor, downloadNameFromPath, downloadUrlFor, listenUrlFor, resolveDownloadPath } from "../program/library/radio/download.mjs";
import { alignedPathFor, readWords, transcriptPathFor } from "../program/library/radio/ticker.mjs";
import { renderStationPage } from "../program/library/radio/page.mjs";
import { orderTracks, readLanes, readRotation } from "../program/library/radio/rotation.mjs";
import { createRadioStation } from "../program/library/radio/station.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8090;
const DEFAULT_CATALOGUE = "radio/audio";
const DEFAULT_STATION_NAME = "Zvorygin Radio";
const DEFAULT_LANES = "radio/topics.txt";
const DEFAULT_ROTATION = "radio/rotation.txt";
const DEFAULT_CHANNELS = "radio/channels.txt";
const RESCAN_MS = 15 * 1000;
const CLOCK_MS = 250;

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * An IPv6 address in a url goes inside brackets, otherwise the port is read
 * as part of the address.
 */
export function formatHost(host) {
  const value = String(host ?? "").trim();
  if (!value) return "";
  if (!value.includes(":")) return value;
  if (value.includes("]")) return value;
  return `[${value}]`;
}

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      if (entry.family === "IPv4" || entry.family === 4) {
        out.push({ address: entry.address, ipv6: false });
        continue;
      }
      if (entry.family === "IPv6" || entry.family === 6) {
        const address = String(entry.address ?? "");
        if (!address || address.startsWith("fe80")) continue;
        out.push({ address, ipv6: true });
      }
    }
  }
  return out;
}

/**
 * The words of a song, with the time of every line.
 *
 * The words of a song are the words of its sheet, placed at the times the
 * house heard them. A song the house could not align is placed on the words
 * that were heard; a song that was never heard keeps its sheet alone.
 */
export async function wordsOfSong(track) {
  if (!track?.lyricSheet) return { source: "none", lines: [] };
  return readWords({
    sheetPath: track.lyricSheet,
    alignedPath: alignedPathFor(track.lyricSheet),
    transcriptPath: transcriptPathFor(track.lyricSheet),
    durationSeconds: track.durationSeconds
  });
}

/**
 * The channels of the station, as a listener is told about them: the name,
 * the pace, the voice, and the plain url the stream can be opened at.
 */
export function publicChannels(channels = []) {
  const list = Array.isArray(channels) ? channels : [];
  return list.map((channel, index) => ({
    name: String(channel.name ?? ""),
    bpm: Number(channel.bpm ?? 0),
    style: String(channel.style ?? ""),
    lanes: [...(channel.lanes ?? [])],
    streamUrl: index === 0 ? "/stream.mp3" : `/${String(channel.name ?? "")}.mp3`,
    songs: channel.station?.tracks?.length ?? 0
  }));
}

/**
 * Build the station server. The station object owns the programme; the server
 * only hands it out over HTTP.
 *
 * A server may carry one programme or several: a channel is a programme of its
 * own, and each has its own stream, its own clock, and its own words.
 *
 * The station listens to the open internet, so nothing a stranger sends may
 * take it down: a malformed request is answered and the house keeps playing.
 */
export function createRadioServer({ station = null, channels = [], stationName = DEFAULT_STATION_NAME, catalogueDirectory = "" } = {}) {
  const programmes = Array.isArray(channels) && channels.length
    ? channels
    : (station ? [{ name: "", station }] : []);
  const channelOf = (name, { fallback = true } = {}) => channelByName(programmes, name, { fallback });
  const defaultChannel = programmes[0] ?? null;
  // A song of any channel may be taken home: the catalogue of the station is
  // one catalogue, and the channels are programmes inside it.
  const everyTrack = () => programmes.flatMap((channel) => channel.station?.tracks ?? []);

  const handle = async (req, res) => {
    let pathname = "/";
    let asked = "";
    let url = null;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
      pathname = url.pathname;
      asked = url.searchParams.get("channel") ?? "";
    } catch {
      jsonResponse(res, 400, { ok: false, error: "bad request" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      jsonResponse(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    const channel = channelOf(asked);
    if (pathname === "/" || pathname === "/index.html") {
      const listed = publicChannels(programmes);
      const body = renderStationPage({
        stationName,
        channels: listed,
        channel: listed.find((entry) => entry.name === (channel?.name ?? "")) ?? listed[0] ?? null
      });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    // The stream of a channel is a plain mp3 at a plain url: /stream.mp3 is
    // the default channel, and /<name>.mp3 is the channel of that name.
    const askedStream = /^\/([a-z0-9][a-z0-9-]*)\.mp3$/u.exec(pathname);
    let stream = null;
    if (pathname === "/stream.mp3" || pathname === "/stream") {
      stream = defaultChannel?.station ?? null;
    } else if (askedStream) {
      const found = channelOf(askedStream[1], { fallback: false });
      if (!found) {
        jsonResponse(res, 404, { ok: false, error: "no such channel" });
        return;
      }
      stream = found.station;
    }
    if (stream) {
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff"
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      stream.subscribe(res);
      return;
    }
    if (pathname === "/channels.json") {
      jsonResponse(res, 200, { station: stationName, channels: publicChannels(programmes) });
      return;
    }
    if (pathname === "/events") {
      if (!channel?.station) {
        jsonResponse(res, 404, { ok: false, error: "no such channel" });
        return;
      }
      const stationOfChannel = channel.station;
      // The words of the song, streamed in step with the audio. The station
      // says which song it is sending and where it stands in the audio it has
      // sent, so a listener reads the words of the song they are hearing.
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff"
      });
      const send = (event, data) => {
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          // the listener is gone
        }
      };
      const state = stationOfChannel.state();
      const current = state.track
        ? stationOfChannel.tracks.find((entry) => entry.filename === state.track.filename)
        : null;
      const entry = state.programme?.[state.programme.length - 1] ?? null;
      if (current && entry) {
        const words = await wordsOfSong(current);
        send("song", {
          channel: channel.name,
          filename: current.filename,
          title: current.title,
          topic: current.topic,
          engine: current.engine,
          durationSeconds: current.durationSeconds,
          contentStart: entry.contentStart,
          downloadUrl: downloadUrlFor(current.filename),
          source: words.source,
          lines: words.lines
        });
      }
      send("clock", {
        epoch: state.epoch,
        channel: channel.name,
        contentSeconds: state.contentSeconds,
        listeners: state.listeners,
        playing: state.playing
      });
      const off = stationOfChannel.on("track", async ({ track, entry: placed }) => {
        const words = await wordsOfSong(track);
        send("song", {
          channel: channel.name,
          filename: track.filename,
          title: track.title,
          topic: track.topic,
          engine: track.engine,
          durationSeconds: track.durationSeconds,
          contentStart: placed.contentStart,
          downloadUrl: downloadUrlFor(track.filename),
          source: words.source,
          lines: words.lines
        });
      });
      const beat = setInterval(() => {
        const now = stationOfChannel.state();
        send("clock", {
          epoch: now.epoch,
          channel: channel.name,
          contentSeconds: now.contentSeconds,
          listeners: now.listeners,
          playing: now.playing
        });
      }, CLOCK_MS);
      res.on("close", () => {
        clearInterval(beat);
        off?.();
      });
      return;
    }
    if (pathname === "/playlist.json") {
      const tracks = channel?.station?.tracks ?? [];
      jsonResponse(res, 200, {
        station: stationName,
        channel: channel?.name ?? "",
        tracks: publicCatalogue(tracks)
      });
      return;
    }
    if (pathname === "/lyrics.json") {
      // The words of a song, with the time of every line. The song is the one
      // playing unless the listener names another: a listener who picks a song
      // out of the catalogue hears that song, and reads its words.
      const askedName = String(url.searchParams.get("filename") ?? "").trim();
      const state = channel?.station?.state();
      const playing = channel?.station?.tracks?.find((entry) => entry.filename === state?.track?.filename) ?? null;
      const track = askedName
        ? everyTrack().find((entry) => entry.filename === askedName) ?? null
        : playing;
      const words = track
        ? await readWords({
          sheetPath: track.lyricSheet,
          alignedPath: alignedPathFor(track.lyricSheet),
          transcriptPath: transcriptPathFor(track.lyricSheet),
          durationSeconds: track.durationSeconds
        })
        : { source: "none", lines: [] };
      jsonResponse(res, 200, {
        station: stationName,
        channel: channel?.name ?? "",
        filename: track?.filename ?? "",
        title: track?.title ?? "",
        durationSeconds: track?.durationSeconds ?? 0,
        downloadUrl: track ? downloadUrlFor(track.filename) : "",
        source: words.source,
        lines: words.lines
      });
      return;
    }
    if (pathname.startsWith(LISTEN_PREFIX)) {
      // The song itself, for a listener who wants to hear it in the page rather
      // than take it home. It is the same file the download serves, with the
      // same guards, served as a stream a player can open.
      const name = downloadNameFromPath(pathname.replace(LISTEN_PREFIX, DOWNLOAD_PREFIX));
      const known = name ? everyTrack().find((track) => track.filename === name) : null;
      const file = known ? resolveDownloadPath({ catalogueDirectory, filename: name }) : "";
      if (!known || !file) {
        jsonResponse(res, 404, { ok: false, error: "no such song" });
        return;
      }
      let size = 0;
      try {
        size = (await fs.stat(file)).size;
      } catch {
        jsonResponse(res, 404, { ok: false, error: "no such song" });
        return;
      }
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "content-length": size,
        "accept-ranges": "none",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const body = fsSync.createReadStream(file);
      body.on("error", () => res.destroy());
      body.pipe(res);
      return;
    }
    if (pathname.startsWith(DOWNLOAD_PREFIX)) {
      const name = downloadNameFromPath(pathname);
      const known = name ? everyTrack().find((track) => track.filename === name) : null;
      const file = known ? resolveDownloadPath({ catalogueDirectory, filename: name }) : "";
      if (!known || !file) {
        jsonResponse(res, 404, { ok: false, error: "no such song" });
        return;
      }
      let size = 0;
      try {
        size = (await fs.stat(file)).size;
      } catch {
        jsonResponse(res, 404, { ok: false, error: "no such song" });
        return;
      }
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "content-length": size,
        "content-disposition": `attachment; filename="${downloadNameFor(known)}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const body = fsSync.createReadStream(file);
      body.on("error", () => res.destroy());
      body.pipe(res);
      return;
    }
    if (pathname === "/status.json") {
      jsonResponse(res, 200, {
        station: stationName,
        channel: channel?.name ?? "",
        ...(channel?.station?.state() ?? { playing: false, total: 0 })
      });
      return;
    }
    if (pathname === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        station: stationName,
        tracks: everyTrack().length,
        channels: programmes.length
      });
      return;
    }
    jsonResponse(res, 404, { ok: false, error: "not found" });
  };

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        // A request must never take the station down, but the house wants to
        // know what went wrong.
        process.stderr.write(`yiniana radio: request fault ${String(error?.stack ?? error)}\n`);
        if (res.headersSent) {
          res.destroy();
          return;
        }
        jsonResponse(res, 500, { ok: false, error: "station fault" });
      });
  });
  server.on("clientError", (error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
  });
  return { server };
}

/**
 * The programmes of the station: every channel, with the contract of the
 * songs it plays and the order it plays them in.
 *
 * The channels file is the truth about the channels. A station without one
 * falls back to the house's own programme: one channel for every engine, at
 * every lane, with the songs that came before the radio opening the first of
 * them.
 */
export async function stationProgrammes({ cwd = process.cwd() } = {}) {
  const engines = Object.keys(resolveConfigMap("radio producer engines") ?? {});
  const lanesFile = resolveConfigText("radio producer lanes") || DEFAULT_LANES;
  const topics = await readLanes(path.resolve(cwd, lanesFile));
  const rotationFile = resolveConfigText("radio rotation") || DEFAULT_ROTATION;
  const house = await readRotation(path.resolve(cwd, rotationFile));
  const channelsFile = resolveConfigText("radio channels") || DEFAULT_CHANNELS;
  const fallback = engines.map((engine) => ({
    name: engine,
    engine,
    bpm: 0,
    style: "",
    lanes: [],
    everyLane: true
  }));
  const channels = await readChannels(path.resolve(cwd, channelsFile), { fallback });
  return channelProgrammes({ channels, topics, house });
}

/**
 * Read the station settings from the pyash configuration surface and bring
 * the station up.
 */
export async function startRadioStation({ cwd = process.cwd(), listen = true } = {}) {
  await loadDefaultConfig({ cwd, interpretFn: interpret });
  const host = resolveConfigText("radio host") || DEFAULT_HOST;
  const port = Number(resolveConfigNum("radio port") || DEFAULT_PORT);
  const catalogueDirectory = path.resolve(cwd, resolveConfigText("radio catalogue") || DEFAULT_CATALOGUE);
  const lyricsDirectory = path.resolve(path.dirname(catalogueDirectory), "lyrics");
  const stationName = resolveConfigText("radio station name") || DEFAULT_STATION_NAME;
  const programmes = await stationProgrammes({ cwd });
  const buildProgramme = async () => {
    // The lanes, the rotation file and the catalogue are read every time, so
    // a new lane or a new song joins the programme without the station being
    // restarted.
    const built = [];
    for (const programme of programmes) {
      const tracks = orderTracks(
        await scanCatalogue({
          directory: catalogueDirectory,
          lyricsDirectory,
          contract: programme.contract,
          own: programme.own
        }),
        programme.order
      );
      built.push({ ...programme, tracks });
    }
    return built;
  };
  const built = await buildProgramme();
  const channels = built.map((programme) => {
    const station = createRadioStation({ tracks: programme.tracks });
    station.on("track", ({ track }) => {
      process.stdout.write(`yiniana radio [${programme.name || "house"}]: now playing ${track.title}\n`);
    });
    station.start();
    return { ...programme, station };
  });
  const { server } = createRadioServer({ channels, stationName, catalogueDirectory });
  const rescan = setInterval(async () => {
    const next = await buildProgramme();
    let changed = 0;
    for (let index = 0; index < channels.length; index += 1) {
      const before = channels[index].station.tracks.map((track) => track.filename).join("\n");
      const after = next[index].tracks.map((track) => track.filename).join("\n");
      if (before === after) continue;
      changed += 1;
      channels[index].station.setTracks(next[index].tracks);
      channels[index].tracks = next[index].tracks;
    }
    if (changed) {
      process.stdout.write(`yiniana radio: ${changed} channel(s) now hold a different programme\n`);
    }
  }, RESCAN_MS);
  rescan.unref?.();
  if (!listen) return { server, channels, stationName, host, port, catalogueDirectory };
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  process.stdout.write(`yiniana radio listening on http://${formatHost(host)}:${port}\n`);
  for (const channel of channels) {
    const url = channel.name ? `/${channel.name}.mp3` : "/stream.mp3";
    process.stdout.write(`yiniana radio [${channel.name || "house"}] stream at http://${formatHost(host)}:${port}${url}\n`);
  }
  for (const entry of localAddresses()) {
    const address = entry.ipv6 ? formatHost(entry.address) : entry.address;
    process.stdout.write(`yiniana radio reachable at http://${address}:${port}\n`);
  }
  for (const channel of channels) {
    if (!channel.tracks.length) {
      process.stdout.write(`yiniana radio [${channel.name || "house"}] has no rendered track yet in ${catalogueDirectory}\n`);
    }
  }
  const close = () => {
    clearInterval(rescan);
    for (const channel of channels) channel.station.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  return { server, channels, stationName, host, port, catalogueDirectory };
}

async function main() {
  await startRadioStation({ cwd: process.cwd(), listen: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
