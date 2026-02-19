import fs from "node:fs/promises";
import path from "node:path";

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

function readDirNamesOrEmpty(dirPath) {
  return fs.readdir(dirPath).catch((err) => {
    if (err?.code === "ENOENT") return [];
    throw err;
  });
}

function readTailFromText(text, tailCount) {
  if (!text) return { found: false, totalLines: 0, lines: [] };
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    found: true,
    totalLines: lines.length,
    lines: lines.slice(-tailCount)
  };
}

function intervalMsToCase(intervalMs) {
  const ms = Math.max(1, Math.floor(Number(intervalMs) || 0));
  const second = 1000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (ms % week === 0) return { during: { week: ms / week } };
  if (ms % day === 0) return { during: { day: ms / day } };
  if (ms % hour === 0) return { during: { hour: ms / hour } };
  if (ms % minute === 0) return { during: { minute: ms / minute } };
  if (ms % second === 0) return { during: { second: ms / second } };
  return { during: { second: Math.max(1, Math.round(ms / second)) } };
}

function renderCalendarSentenceFromJob(job, { sentenceToPyash }) {
  const intervalCase = intervalMsToCase(job?.intervalMs);
  const withCase = job?.withCase && typeof job.withCase === "object"
    ? job.withCase
    : { wo: "tools" };
  return sentenceToPyash({
    mood: "ya",
    su: { name: String(job?.jobName ?? "").trim() },
    be: "calendar",
    for: { name: String(job?.agentName ?? "").trim() },
    vyah: { habit: true },
    ...intervalCase,
    with: withCase
  });
}

function renderServiceMap(name, items) {
  const lines = [`su name ${name} be map def`];
  for (const item of items) {
    lines.push(`  su name ${item.key} ob text ${quoteText(item.sentence)} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function hasCalendarHealthFailure(result) {
  if (!result || result.running !== true) return true;
  const jobs = Array.isArray(result?.status?.jobs) ? result.status.jobs : [];
  for (const job of jobs) {
    const errorCount = Number(job?.errorCount ?? 0);
    const consecutiveErrors = Number(job?.consecutiveErrors ?? 0);
    const lastError = String(job?.lastError ?? "").trim();
    if (errorCount > 0 || consecutiveErrors > 0 || lastError) return true;
  }
  return false;
}

function renderCalendarDebugLog(name, log, { textOut }) {
  const filePath = String(log?.path ?? "").trim() || "(unknown)";
  textOut(`- ${name} ${filePath}`);
  if (!log?.found) {
    textOut("  (not found)");
    return;
  }
  const lines = Array.isArray(log?.lines) ? log.lines : [];
  const totalLines = Number(log?.totalLines ?? 0) || 0;
  textOut(`  total lines ${totalLines}`);
  textOut(`  showing ${lines.length}`);
  for (const line of lines) {
    textOut(`  ${line}`);
  }
}

async function readSchedulerNewspaperLog({ worldRoot, tailCount, readText }) {
  const newspaperDir = path.join(worldRoot, "newspaper");
  const suffix = "-calendar.pya";
  const names = await readDirNamesOrEmpty(newspaperDir);
  const matches = names
    .filter((name) => name.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b, "en"));
  const fileName = matches[matches.length - 1] || null;
  const filePath = fileName
    ? path.join(newspaperDir, fileName)
    : path.join(newspaperDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-calendar.pya`);
  const text = await readText(filePath);
  const tail = readTailFromText(text, tailCount);
  return {
    found: tail.found,
    path: filePath,
    totalLines: tail.totalLines,
    lines: tail.lines,
    expectedPattern: path.join(worldRoot, "newspaper", "YYYYMMDD-calendar.pya")
  };
}

async function readSchedulerCalendarDebug({ worldRoot, tailCount, readText }) {
  const schedulerNewspaper = await readSchedulerNewspaperLog({ worldRoot, tailCount, readText });
  const daemonPath = path.join(worldRoot, "conduct", "scheduler.log");
  const daemonText = await readText(daemonPath);
  const daemonTail = readTailFromText(daemonText, tailCount);
  return {
    schedulerNewspaper,
    schedulerDaemonLog: {
      found: daemonTail.found,
      path: daemonPath,
      totalLines: daemonTail.totalLines,
      lines: daemonTail.lines
    }
  };
}

export function createCalendarCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    schedulerHealth,
    schedulerBegin,
    schedulerStop,
    schedulerRestart,
    schedulerList,
    discoverScheduledJobs,
    isServiceEnabled,
    sentenceToPyash,
    readText,
    jsonOut,
    textOut
  } = deps;

  return async function calendarCommand(args) {
    const sub = (args[0] ?? "health").toLowerCase();
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agentFilter = parseArgValue(args, "--agent") ?? "";

    let result;
    if (sub === "health") result = await schedulerHealth({ worldRoot });
    else if (sub === "begin") result = await schedulerBegin({ worldRoot });
    else if (sub === "stop") result = await schedulerStop({ worldRoot });
    else if (sub === "restart") result = await schedulerRestart({ worldRoot });
    else if (sub === "list") result = await schedulerList({ worldRoot });
    else throw new Error(`unknown calendar command: ${sub}`);

    const payload = {
      ok: true,
      route: `calendar ${sub}`,
      worldRoot,
      result
    };
    if (sub === "list") {
      const jobsAll = await discoverScheduledJobs({ worldRoot });
      const jobs = agentFilter
        ? jobsAll.filter((job) => String(job?.agentName ?? "") === agentFilter)
        : jobsAll;
      const serviceRows = [];
      for (const job of jobs) {
        const enabled = await isServiceEnabled({ worldRoot, serviceName: job.jobName });
        const key = `${String(job.agentName || "").trim()} ${String(job.jobName || "").trim()}`.trim();
        serviceRows.push({
          key,
          agentName: job.agentName,
          jobName: job.jobName,
          active: enabled !== false,
          sentence: renderCalendarSentenceFromJob(job, { sentenceToPyash })
        });
      }
      const services = [...new Set(jobs.map((job) => String(job.jobName ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "en"));
      const available = serviceRows.filter((row) => row.active);
      const stopped = serviceRows.filter((row) => !row.active);
      payload.services = services;
      payload.agent = agentFilter || null;
      payload.available = available;
      payload.stopped = stopped;
      payload.calendar = serviceRows;
    }
    if (json) {
      jsonOut(payload);
      return;
    }
    textOut(`calendar ${sub} complete`);
    textOut(`- scheduler ${result?.running ? "running" : "stopped"}`);
    if (result?.pid) textOut(`- pid ${result.pid}`);
    if (sub === "health") {
      const failure = hasCalendarHealthFailure(result);
      const debugLogs = await readSchedulerCalendarDebug({ worldRoot, tailCount: 80, readText });
      textOut(`- scheduler newspaper ${debugLogs.schedulerNewspaper.path}`);
      if (!debugLogs.schedulerNewspaper.found && debugLogs.schedulerNewspaper.expectedPattern) {
        textOut(`  expected pattern ${debugLogs.schedulerNewspaper.expectedPattern}`);
      }
      if (failure) {
        textOut("- calendar debug tail");
        renderCalendarDebugLog("scheduler newspaper", debugLogs.schedulerNewspaper, { textOut });
        renderCalendarDebugLog("scheduler daemon log", debugLogs.schedulerDaemonLog, { textOut });
      }
    }
    if (sub === "list") {
      const services = Array.isArray(payload?.services) ? payload.services : [];
      textOut(`- services ${services.length}`);
      for (const service of services) textOut(`  ${service}`);
      if (agentFilter) textOut(`- agent ${agentFilter}`);
      const available = Array.isArray(payload.available) ? payload.available : [];
      const stopped = Array.isArray(payload.stopped) ? payload.stopped : [];
      textOut(renderServiceMap("available calendar services", available));
      textOut(renderServiceMap("stopped calendar services", stopped));
    }
  };
}
