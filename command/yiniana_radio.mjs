#!/usr/bin/env node
// The Yiniana radio station. It serves the rendered catalogue as a plain HTTP
// mp3 stream, the way a listener expects a radio to behave: one programme,
// many listeners, the song changes by itself.

import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigMap, resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { publicCatalogue, scanCatalogue } from "../program/library/radio/catalogue.mjs";
import { DOWNLOAD_PREFIX, downloadNameFromPath, resolveDownloadPath } from "../program/library/radio/download.mjs";
import { renderStationPage } from "../program/library/radio/page.mjs";
import { contractWithOrder, orderTracks, readLanes, readRotation } from "../program/library/radio/rotation.mjs";
import { createRadioStation } from "../program/library/radio/station.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8090;
const DEFAULT_CATALOGUE = "radio/audio";
const DEFAULT_STATION_NAME = "Yiniana Radio";
const DEFAULT_LANES = "radio/topics.txt";
const DEFAULT_ROTATION = "radio/rotation.txt";
const RESCAN_MS = 15 * 1000;

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
 * Build the station server. The station object owns the programme; the server
 * only hands it out over HTTP.
 *
 * The station listens to the open internet, so nothing a stranger sends may
 * take it down: a malformed request is answered and the house keeps playing.
 */
export function createRadioServer({ station, stationName = DEFAULT_STATION_NAME, catalogueDirectory = "" } = {}) {
  const handle = async (req, res) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      jsonResponse(res, 400, { ok: false, error: "bad request" });
      return;
    }
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
    if (pathname.startsWith(DOWNLOAD_PREFIX)) {
      const name = downloadNameFromPath(pathname);
      const known = name ? station.tracks.find((track) => track.filename === name) : null;
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
        "content-disposition": `attachment; filename="${known.filename.replace(/"/gu, "")}"`,
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
      jsonResponse(res, 200, { station: stationName, ...station.state() });
      return;
    }
    if (pathname === "/health") {
      jsonResponse(res, 200, { ok: true, station: stationName, tracks: station.tracks.length });
      return;
    }
    jsonResponse(res, 404, { ok: false, error: "not found" });
  };

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch(() => {
        // A request must never take the station down.
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
 * The songs the station is contracted to play: every lane of every engine,
 * and every song the rotation file names. The producer fills the lanes and
 * the rotation file holds what came before, so the programme and the work
 * list agree.
 *
 * A station without lanes or engines has no contract and plays everything it
 * finds.
 */
export async function rotationContract({ cwd = process.cwd() } = {}) {
  const engines = Object.keys(resolveConfigMap("radio producer engines") ?? {});
  const lanesFile = resolveConfigText("radio producer lanes") || DEFAULT_LANES;
  const topics = await readLanes(path.resolve(cwd, lanesFile));
  const rotationFile = resolveConfigText("radio rotation") || DEFAULT_ROTATION;
  const house = await readRotation(path.resolve(cwd, rotationFile));
  const lanes = [];
  for (const topic of topics) {
    for (const engine of engines) lanes.push(`${engine}-${topic}.mp3`);
  }
  const order = [...house, ...lanes];
  return { contract: contractWithOrder({ engines, topics, order }), order };
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
  const buildProgramme = async () => {
    // The lanes and the rotation file are read every time, so a new lane or
    // a new song joins the programme without the station being restarted.
    const { contract, order } = await rotationContract({ cwd });
    const tracks = orderTracks(
      await scanCatalogue({ directory: catalogueDirectory, lyricsDirectory, contract }),
      order
    );
    return { contract, tracks };
  };
  const { contract, tracks } = await buildProgramme();
  const station = createRadioStation({ tracks });
  station.on("track", ({ track }) => {
    process.stdout.write(`yiniana radio: now playing ${track.title}\n`);
  });
  station.start();
  const { server } = createRadioServer({ station, stationName, catalogueDirectory });
  const rescan = setInterval(async () => {
    const { tracks: next } = await buildProgramme();
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
  process.stdout.write(`yiniana radio listening on http://${formatHost(host)}:${port}\n`);
  process.stdout.write(`yiniana radio stream at http://${formatHost(host)}:${port}/stream.mp3\n`);
  for (const entry of localAddresses()) {
    const address = entry.ipv6 ? formatHost(entry.address) : entry.address;
    process.stdout.write(`yiniana radio reachable at http://${address}:${port}\n`);
  }
  if (!tracks.length) {
    process.stdout.write(`yiniana radio has no rendered track yet in ${catalogueDirectory}\n`);
  }
  if (contract.size) {
    process.stdout.write(`yiniana radio: the rotation holds ${contract.size} song(s), ${tracks.length} rendered\n`);
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
