#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (idx < 0) return null;
  const token = args[idx];
  if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  return args[idx + 1] ?? null;
}

function detectViolations(text) {
  const markers = [
    { name: "host.docker.internal", pattern: /host\.docker\.internal/i },
    { name: "searxng service host", pattern: /:\/\/searxng(?::\d+)?\b/i },
    { name: "whisperx service host", pattern: /:\/\/whisperx(?::\d+)?\b/i }
  ];
  const violations = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const marker of markers) {
      if (!marker.pattern.test(line)) continue;
      violations.push({
        line: i + 1,
        marker: marker.name,
        text: line.trim()
      });
    }
  }
  return violations;
}

export async function checkLocalConfigSafety(args = process.argv.slice(2), {
  readFile = fs.readFile,
  stdout = (text) => process.stdout.write(`${text}\n`),
  stderr = (text) => process.stderr.write(`${text}\n`)
} = {}) {
  const rootFlag = parseArgValue(args, "--root");
  const rootDir = path.resolve(rootFlag || process.cwd());
  const secretPath = path.join(rootDir, "configure", "secret.pya");

  let text = "";
  try {
    text = await readFile(secretPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      stdout(`config safety: skip (${secretPath} not found)`);
      return 0;
    }
    throw err;
  }

  const violations = detectViolations(text);
  if (violations.length === 0) {
    stdout("config safety: pass");
    return 0;
  }

  stderr("config safety: fail");
  stderr("container-specific hosts found in configure/secret.pya");
  for (const item of violations) {
    stderr(`- line ${item.line}: ${item.marker} :: ${item.text}`);
  }
  stderr("how to fix:");
  stderr("1. Move container routing values from configure/secret.pya to configure/container.pya");
  stderr("2. Keep configure/secret.pya for secrets and host-local endpoints (for example localhost)");
  stderr("3. Re-run: npm run config:safety");
  return 1;
}

async function main() {
  const code = await checkLocalConfigSafety();
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
