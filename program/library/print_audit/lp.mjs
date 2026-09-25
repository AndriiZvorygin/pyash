import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { appendPrintEvent, DEFAULT_PRINT_JOURNAL_ROOT } from "./journal.mjs";
import { calculatePrintCost, calculatePrintMetrics, createCostSnapshot, pdfPageCount, printSettingsFromArgs } from "./cost.mjs";
import { discoverPrinterIdentity, loadPrinterProfiles, profileSnapshot, resolvePrinterProfile } from "./profile.mjs";

const VALUE_OPTIONS = new Set(["-d", "-H", "-h", "-i", "-n", "-o", "-P", "-q", "-t", "-U"]);
const COMPACT_VALUE_OPTIONS = ["-d", "-H", "-h", "-i", "-n", "-o", "-P", "-q", "-t", "-U"];
const PAPER_OPTION_NAMES = new Set(["media", "media-col", "pagesize"]);

function isPaperOption(value = "") {
  const name = String(value).split("=", 1)[0].trim().toLowerCase();
  return PAPER_OPTION_NAMES.has(name);
}

export function forceLetterMedia(args = []) {
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === "--") {
      normalized.push("-o", "media=Letter", "--", ...args.slice(index + 1).map(String));
      return normalized;
    }
    if (arg === "-o" && index + 1 < args.length && isPaperOption(args[index + 1])) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-o") && arg.length > 2 && isPaperOption(arg.slice(2))) continue;
    normalized.push(arg);
  }
  normalized.push("-o", "media=Letter");
  return normalized;
}

function optionValue(arg, option) {
  if (arg === option) return null;
  return arg.startsWith(option) && arg.length > option.length ? arg.slice(option.length) : undefined;
}

export function parseLpArguments(args = [], env = process.env) {
  const files = [];
  const options = [];
  let copies = 1;
  let printer = String(env.LPDEST || env.PRINTER || "");
  let title = "";
  let modifyingJobId = "";
  let afterDoubleDash = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (afterDoubleDash) {
      files.push(arg);
      continue;
    }
    if (arg === "--") {
      options.push(arg);
      afterDoubleDash = true;
      continue;
    }
    if (arg === "-" || !arg.startsWith("-")) {
      files.push(arg);
      continue;
    }

    let matchedCompact = false;
    for (const option of COMPACT_VALUE_OPTIONS) {
      const compact = optionValue(arg, option);
      if (compact === undefined || compact === null) continue;
      matchedCompact = true;
      options.push(arg);
      if (option === "-n") copies = Math.max(1, Number.parseInt(compact, 10) || 1);
      if (option === "-d") printer = compact;
      if (option === "-t") title = compact;
      if (option === "-i") modifyingJobId = compact;
      break;
    }
    if (matchedCompact) continue;

    options.push(arg);
    if (VALUE_OPTIONS.has(arg) && index + 1 < args.length) {
      const value = String(args[index + 1]);
      options.push(value);
      index += 1;
      if (arg === "-n") copies = Math.max(1, Number.parseInt(value, 10) || 1);
      if (arg === "-d") printer = value;
      if (arg === "-t") title = value;
      if (arg === "-i") modifyingJobId = value;
    }
  }

  return { args: args.map(String), files, options, copies, printer, title, modifyingJobId };
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function collectPrintSources(files = [], cwd = process.cwd()) {
  const sources = [];
  const sourceArgs = files.length ? files : ["-"];
  for (const raw of sourceArgs) {
    if (raw === "-") {
      sources.push({ raw: "stdin", absolute: "stdin", canonical: "", directory: cwd, size: 0, sha256: "" });
      continue;
    }
    const absolute = path.resolve(cwd, raw);
    let canonical = absolute;
    let stat = null;
    try {
      canonical = await fsPromises.realpath(absolute);
      stat = await fsPromises.stat(canonical);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    const sha256 = stat?.isFile() ? await hashFile(canonical) : "";
    sources.push({
      raw,
      absolute,
      canonical,
      directory: path.dirname(absolute),
      size: stat?.isFile() ? stat.size : 0,
      sha256
    });
  }
  return sources;
}

export function parseLpRequestIds(stdout = "") {
  const ids = [];
  const regex = /request id is\s+([^\s]+)\s+/giu;
  let match;
  while ((match = regex.exec(String(stdout))) !== null) ids.push(match[1]);
  return ids;
}

function runLpProcess(lpBinary, args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(lpBinary, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    });
    let stdoutText = "";
    child.stdout.on("data", (chunk) => {
      stdoutText += String(chunk);
      stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal, stdout: stdoutText }));
    void stdin;
  });
}

function eventFromSources(base, sources) {
  return {
    ...base,
    sourcePaths: sources.map(({ absolute }) => absolute),
    canonicalPaths: sources.map(({ canonical }) => canonical),
    sourceDirectories: sources.map(({ directory }) => directory),
    sourceSizes: sources.map(({ size }) => size),
    sourceHashes: sources.map(({ sha256 }) => sha256)
  };
}

export async function runAuditedLp(args = process.argv.slice(2), {
  lpBinary = "/usr/bin/lp",
  journalRoot = process.env.PYA_PRINT_JOURNAL_ROOT || DEFAULT_PRINT_JOURNAL_ROOT,
  appendEvent = appendPrintEvent,
  runProcess = runLpProcess,
  cwd = process.cwd(),
  user = os.userInfo().username,
  now = () => new Date(),
  discoverIdentity = discoverPrinterIdentity,
  loadProfiles = loadPrinterProfiles,
  pageCount = pdfPageCount
} = {}) {
  if (args.includes("--help")) {
    const result = await runProcess(lpBinary, args);
    return result.code;
  }
  const effectiveArgs = forceLetterMedia(args);
  const parsed = parseLpArguments(effectiveArgs);
  const sources = parsed.modifyingJobId ? [] : await collectPrintSources(parsed.files, cwd);
  const eventId = crypto.randomUUID();
  const title = parsed.title || path.basename(sources.find(({ absolute }) => absolute !== "stdin")?.absolute || "stdin");
  const timestamp = now().toISOString();
  let identity = { cups_queue: parsed.printer || "", cups_server: "localhost" };
  let profile = null;
  try {
    identity = { ...identity, ...await discoverIdentity(parsed.printer || "") };
    profile = resolvePrinterProfile((await loadProfiles()).profiles, identity, timestamp);
  } catch (err) {
    identity.profile_lookup_error = err?.message || String(err);
  }
  const sourceFile = sources.find(({ canonical }) => canonical)?.canonical || "";
  const documentPages = await pageCount(sourceFile).catch(() => 0);
  const settings = printSettingsFromArgs(parsed.args);
  const metrics = calculatePrintMetrics({ documentPages, copies: parsed.copies, numberUp: settings.numberUp, sides: settings.sides });
  const costSnapshot = createCostSnapshot(profile, settings);
  const estimate = calculatePrintCost(costSnapshot, {
    impressions: metrics.printed_impressions_requested,
    sheets: metrics.physical_sheets_requested,
    basis: "requested"
  });
  const campaign = /(?:gardener|mayor)-flyer.*\.pdf$/iu.test(title) ? "mayor" : "";
  const base = eventFromSources({
    eventId,
    timestamp,
    cwd,
    copies: parsed.copies,
    printer: identity.cups_queue || parsed.printer,
    title,
    user,
    args: parsed.args,
    details: [
      ...(parsed.modifyingJobId ? [`modifies=${parsed.modifyingJobId}`] : []),
      ...(identity.profile_lookup_error ? [`profile_lookup_error=${identity.profile_lookup_error}`] : [])
    ],
    ...identity,
    printer_profile: profile?.id || "",
    printer_profile_version: profile?.version || "",
    printer_profile_snapshot: profileSnapshot(profile),
    cost_snapshot: costSnapshot,
    campaign,
    ...metrics,
    ...estimate,
    original_estimated_total_cost: estimate.estimated_total_cost
  }, sources);

  try {
    await appendEvent({ ...base, status: "prepared" }, { root: journalRoot });
  } catch (err) {
    const message = `Print stopped: unable to write audit journal: ${err?.message || err}\n`;
    process.stderr.write(message);
    return 73;
  }

  let result;
  try {
    result = await runProcess(lpBinary, parsed.args);
  } catch (err) {
    await appendEvent({
      ...base,
      timestamp: now().toISOString(),
      status: "rejected",
      details: [...base.details, `error=${err?.message || err}`]
    }, { root: journalRoot });
    process.stderr.write(`lp failed: ${err?.message || err}\n`);
    return 1;
  }

  const requestIds = parseLpRequestIds(result.stdout);
  const status = result.code === 0 ? "accepted" : "rejected";
  try {
    await appendEvent({
      ...base,
      timestamp: now().toISOString(),
      status,
      cupsJobId: requestIds[0] || parsed.modifyingJobId || "",
      details: [...base.details, ...(result.signal ? [`signal=${result.signal}`] : [])]
    }, { root: journalRoot });
  } catch (err) {
    process.stderr.write(`Print audit warning: CUPS returned, but the result could not be recorded: ${err?.message || err}\n`);
    return result.code === 0 ? 74 : result.code;
  }

  return result.code;
}
