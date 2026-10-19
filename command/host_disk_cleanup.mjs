#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage() {
  return [
    "Usage: node command/host_disk_cleanup.mjs [--apply] [--json]",
    "",
    "Without --apply, prints reclaimable host space and proposed cleanup only.",
    "With --apply, removes dangling Docker images, old Docker build cache,",
    "disabled Snap revisions, and apt cache. Active containers and tagged images stay.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { apply: false, json: false };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return result;
}

function run(command, args = [], { allowFailure = true } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const status = Number.isInteger(result.status) ? result.status : 1;
  if (!allowFailure && status !== 0) {
    throw new Error(`${command} failed (${status}): ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return {
    command,
    args,
    status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function parseDf(stdout = "") {
  const lines = String(stdout).trim().split(/\r?\n/u).filter(Boolean);
  const fields = String(lines.at(-1) || "").trim().split(/\s+/u);
  return {
    filesystem: fields[0] || "",
    size: fields[1] || "",
    used: fields[2] || "",
    available: fields[3] || "",
    use_percent: fields[4] || "",
    mount: fields.slice(5).join(" "),
  };
}

export function parseDisabledSnaps(stdout = "") {
  return String(stdout)
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((fields) => fields.length >= 6 && fields.slice(5).some((field) => field.toLowerCase().includes("disabled")))
    .map((fields) => ({ name: fields[0], revision: fields[2], notes: fields.slice(5).join(" ") }));
}

export function collectHostDiskReport({ runner = run } = {}) {
  const rootDisk = parseDf(runner("df", ["-Pk", "/"]).stdout);
  const dockerDf = runner("docker", ["system", "df"], { allowFailure: true });
  const dangling = runner("docker", ["images", "--filter", "dangling=true", "--format", "{{.ID}}\t{{.Size}}\t{{.CreatedSince}}"], { allowFailure: true });
  const builder = runner("docker", ["builder", "du"], { allowFailure: true });
  const snaps = runner("snap", ["list", "--all"], { allowFailure: true });
  const apt = runner("du", ["-sb", "/var/cache/apt/archives"], { allowFailure: true });
  const disabledSnaps = parseDisabledSnaps(snaps.stdout);
  const danglingRows = dangling.stdout ? dangling.stdout.split(/\r?\n/u).filter(Boolean) : [];
  const aptBytes = Number(String(apt.stdout).split(/\s+/u)[0] || 0);
  return {
    root_disk: rootDisk,
    docker: {
      system_df: dockerDf.stdout,
      dangling_images: danglingRows,
      dangling_image_count: danglingRows.length,
      builder_du: builder.stdout,
    },
    snaps: { disabled: disabledSnaps },
    apt_cache_bytes: Number.isFinite(aptBytes) ? aptBytes : 0,
    proposed_actions: [
      "docker image prune --force",
      "docker builder prune --force --filter until=168h",
      ...disabledSnaps.map((snap) => `sudo snap remove --purge ${snap.name} --revision ${snap.revision}`),
      "sudo apt-get clean",
    ],
  };
}

export function applyHostDiskCleanup({ runner = run, report = collectHostDiskReport({ runner }) } = {}) {
  const actions = [];
  actions.push(runner("docker", ["image", "prune", "--force"], { allowFailure: true }));
  actions.push(runner("docker", ["builder", "prune", "--force", "--filter", "until=168h"], { allowFailure: true }));
  for (const snap of report.snaps.disabled) {
    actions.push(runner("sudo", ["-n", "snap", "remove", "--purge", snap.name, "--revision", snap.revision], { allowFailure: true }));
  }
  actions.push(runner("sudo", ["-n", "apt-get", "clean"], { allowFailure: true }));
  return actions;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = collectHostDiskReport();
  const result = { mode: args.apply ? "apply" : "report", report };
  if (args.apply) result.actions = applyHostDiskCleanup({ report });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const disk = report.root_disk;
  process.stdout.write(`[host-disk-cleanup] mode=${result.mode} root=${disk.use_percent || "?"} used=${disk.used || "?"} available=${disk.available || "?"}\n`);
  process.stdout.write(`[host-disk-cleanup] dangling_docker_images=${report.docker.dangling_image_count} disabled_snaps=${report.snaps.disabled.length} apt_cache=${report.apt_cache_bytes} bytes\n`);
  if (!args.apply) process.stdout.write("[host-disk-cleanup] dry run only; pass --apply to execute the listed safe cleanup actions\n");
  else process.stdout.write(`[host-disk-cleanup] actions=${result.actions.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[host-disk-cleanup] error ${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  }
}
