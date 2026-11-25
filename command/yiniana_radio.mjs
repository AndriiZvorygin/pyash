#!/usr/bin/env node
// The Yiniana radio station. It serves the rendered catalogue as a plain HTTP
// mp3 stream, the way a listener expects a radio to behave: one programme,
// many listeners, the song changes by itself.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { publicCatalogue, scanCatalogue } from "../program/library/radio/catalogue.mjs";
import { renderStationPage } from "../program/library/radio/page.mjs";
import { createRadioStation } from "../program/library/radio/station.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8090;
const DEFAULT_CATALOGUE = "radio/audio";
const DEFAULT_STATION_NAME = "Yiniana Radio";
const RESCAN_MS = 60 * 1000;

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

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      out.push(entry.address);
    }
  }
  return out;
}

/**
 * Build the station server. The station object owns the programme; the server
 * only hands it out over HTTP.
 */
export function createRadioServer({ station, stationName = DEFAULT_STATION_NAME } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    if (req.method !== "GET" && req.method !== "HEAD") {
      jsonResponse(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      const body = renderStationPage({ stationName });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    if (pathname === "/stream.mp3" || pathname === "/stream") {
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
      station.subscribe(res);
      return;
    }
    if (pathname === "/playlist.json") {
      jsonResponse(res, 200, { station: stationName, tracks: publicCatalogue(station.tracks) });
      return;
    }
    if (pathname === "/status.json") {
      jsonResponse(res, 200, { station: stationName, ...station.state() });
      return;
    }
    if (pathname === "/health") {
      jsonResponse(res, 200, { ok: true, station: stationName, tracks: station.tracks.length });
      return;
    }
    jsonResponse(res, 404, { ok: false, error: "not found" });
  });
  return { server };
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
  const tracks = await scanCatalogue({ directory: catalogueDirectory, lyricsDirectory });
  const station = createRadioStation({ tracks });
  station.start();
  station.on("track", ({ track }) => {
    process.stdout.write(`yiniana radio: now playing ${track.title}\n`);
  });
  const { server } = createRadioServer({ station, stationName });
  const rescan = setInterval(async () => {
    const next = await scanCatalogue({ directory: catalogueDirectory, lyricsDirectory });
    const before = station.tracks.map((track) => track.filename).join("\n");
    const after = next.map((track) => track.filename).join("\n");
    if (before === after) return;
    station.setTracks(next);
    process.stdout.write(`yiniana radio: catalogue now holds ${next.length} track(s)\n`);
  }, RESCAN_MS);
  rescan.unref?.();
  if (!listen) return { server, station, stationName, host, port, catalogueDirectory };
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  process.stdout.write(`yiniana radio listening on http://${host}:${port}\n`);
  process.stdout.write(`yiniana radio stream at http://${host}:${port}/stream.mp3\n`);
  for (const address of localAddresses()) {
    process.stdout.write(`yiniana radio reachable at http://${address}:${port}\n`);
  }
  if (!tracks.length) {
    process.stdout.write(`yiniana radio has no rendered track yet in ${catalogueDirectory}\n`);
  }
  const close = () => {
    clearInterval(rescan);
    station.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  return { server, station, stationName, host, port, catalogueDirectory };
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
