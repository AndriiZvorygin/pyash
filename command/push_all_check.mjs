#!/usr/bin/env node

// Validation for the github remote used by command/push_all.sh.
//
// The remote may be the canonical github.com URL or a ~/.ssh/config alias
// for it. Both are legitimate, so the check resolves the alias through ssh
// and confirms it still points at github.com before anything is pushed.

import { execFileSync } from "node:child_process";

export const GITHUB_REPO_PATH = "AndriiZvorygin/pyash.git";

function defaultSshRunner(host) {
  try {
    const output = execFileSync("ssh", ["-G", host], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of output.split("\n")) {
      const match = /^hostname\s+(\S+)$/u.exec(line.trim());
      if (match) return match[1];
    }
    return "";
  } catch {
    return "";
  }
}

// Returns { host, path } for an SSH-style git remote, or null.
export function parseSshRemote(url) {
  const match = /^git@([^:]+):(.+)$/u.exec(String(url || "").trim());
  if (!match) return null;
  return { host: match[1], path: match[2] };
}

// Resolves an ssh host (possibly an alias) to the real hostname it dials.
export function resolveSshHost(host, runner = defaultSshRunner) {
  const resolved = runner(host);
  return resolved || host;
}

export function validateGithubRemote(url, runner = defaultSshRunner) {
  const parsed = parseSshRemote(url);
  if (!parsed) {
    return { ok: false, reason: `remote ${url} is not an SSH URL` };
  }
  if (parsed.path !== GITHUB_REPO_PATH) {
    return { ok: false, reason: `remote points to ${parsed.path}, expected ${GITHUB_REPO_PATH}` };
  }
  const resolved = resolveSshHost(parsed.host, runner);
  if (resolved !== "github.com" && !resolved.endsWith(".github.com")) {
    return {
      ok: false,
      reason: `remote host ${parsed.host} resolves to ${resolved}, not github.com`,
    };
  }
  return { ok: true, host: parsed.host, path: parsed.path, resolved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  const outcome = validateGithubRemote(url);
  if (!outcome.ok) {
    console.error(`push_all: ${outcome.reason}`);
    process.exit(1);
  }
  console.log(`push_all: github remote accepted (${outcome.host} -> ${outcome.resolved})`);
}
