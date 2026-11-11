import fs from "node:fs/promises";
import path from "node:path";

import { resolveWorldAgentHouseDirectory } from "../library/agent_command_policy.mjs";

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectLabel(cwd) {
  const basename = path.basename(path.resolve(cwd));
  const label = basename.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return label || "project";
}

export function resolveCodingSaddleHousePath({ worldRoot, cwd } = {}) {
  const resolvedWorldRoot = path.resolve(String(worldRoot ?? "world"));
  const houseName = `${projectLabel(cwd ?? process.cwd())}-coding-saddle`;
  return path.join(resolvedWorldRoot, "house", houseName);
}

async function atomicWrite(filename, content) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, filename);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function directoryIsEmpty(directory) {
  try {
    return (await fs.readdir(directory)).length === 0;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function resolvesToSameDirectory(left, right) {
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([
      fs.realpath(left),
      fs.realpath(right)
    ]);
    return resolvedLeft === resolvedRight;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function assertManifestScope({ worldRoot, cwd }) {
  const filename = path.join(worldRoot, "coding-saddle-project.pya");
  let content;
  try {
    content = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return filename;
    throw error;
  }
  const match = content.match(/^su name coding saddle project cwd ob filename ("(?:\\.|[^"\\])*") ya\s*$/mu);
  if (!match) {
    if (content.trim()) throw new Error(`coding saddle project manifest is malformed: ${filename}`);
    return filename;
  }
  const storedCwd = JSON.parse(match[1]);
  if (path.resolve(String(storedCwd)) !== path.resolve(cwd)) {
    throw new Error(`coding saddle project world belongs to ${storedCwd}, not ${path.resolve(cwd)} (${worldRoot})`);
  }
  return filename;
}

async function migrateLegacyHouse({ worldRoot, destination }) {
  const fallback = path.join(worldRoot, "house", "coding saddle");
  const mapped = resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName: "coding saddle",
    includeFallback: false
  });
  const candidates = [...new Set([mapped, fallback].filter(Boolean).map((value) => path.resolve(value)))];

  for (const source of candidates) {
    if (source === destination || await resolvesToSameDirectory(source, destination)) continue;
    let sourceExists = false;
    try {
      const stat = await fs.stat(source);
      if (!stat.isDirectory()) throw new Error(`coding saddle house is not a directory: ${source}`);
      sourceExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!sourceExists) continue;

    const isLegacyLocation = source === fallback
      || (path.basename(source).toLowerCase() === "coding saddle"
        && isWithin(path.join(worldRoot, "house"), source));
    if (!isLegacyLocation) {
      throw new Error(`coding saddle has a custom mapped house at ${source}; refusing to move it automatically`);
    }

    let destinationExists = false;
    try {
      const stat = await fs.stat(destination);
      if (!stat.isDirectory()) throw new Error(`coding saddle destination is not a directory: ${destination}`);
      destinationExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (destinationExists && !(await directoryIsEmpty(destination)) && !(await directoryIsEmpty(source))) {
      throw new Error(`coding saddle house migration conflict: legacy ${source} and destination ${destination} both contain data`);
    }
    if (destinationExists && !(await directoryIsEmpty(destination))) {
      return;
    }
    if (destinationExists) await fs.rmdir(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
    return;
  }
}

async function writeHouseMapping(worldRoot, destination) {
  const filename = path.join(worldRoot, "conduct", "agent.pya");
  let content = "";
  try {
    content = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const canonicalDestination = await fs.realpath(destination);
  const declaration = `su name coding saddle house directory ob filename ${JSON.stringify(canonicalDestination)} ya`;
  const lines = content.split(/\r?\n/u);
  const kept = lines.filter((line) => !/^\s*su name coding saddle house directory ob filename\b/iu.test(line));
  const normalized = `${kept.join("\n").trimEnd()}${kept.some((line) => line.trim()) ? "\n" : ""}${declaration}\n`;
  if (`${content.trimEnd()}\n` === normalized) return;
  await atomicWrite(filename, normalized);
}

async function writeProjectManifest({ filename, cwd, destination }) {
  const label = path.basename(path.resolve(cwd));
  const canonicalDestination = await fs.realpath(destination);
  const declarations = [
    `su name coding saddle project cwd ob filename ${JSON.stringify(path.resolve(cwd))} ya`,
    `su name coding saddle project label ob text ${JSON.stringify(label)} ya`,
    `su name coding saddle project house ob filename ${JSON.stringify(canonicalDestination)} ya`
  ];
  let existing = "";
  try {
    existing = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const kept = existing.split(/\r?\n/u).filter((line) => !/^\s*su name coding saddle project (?:cwd|label|house)\b/iu.test(line));
  const content = `${kept.join("\n").trimEnd()}${kept.some((line) => line.trim()) ? "\n" : ""}${declarations.join("\n")}\n`;
  if (`${existing.trimEnd()}\n` !== content) await atomicWrite(filename, content);
}

export async function ensureCodingSaddleHouse({ worldRoot, cwd } = {}) {
  const resolvedWorldRoot = path.resolve(String(worldRoot ?? "world"));
  const resolvedCwd = path.resolve(String(cwd ?? process.cwd()));
  const destination = resolveCodingSaddleHousePath({ worldRoot: resolvedWorldRoot, cwd: resolvedCwd });
  const manifestPath = await assertManifestScope({ worldRoot: resolvedWorldRoot, cwd: resolvedCwd });

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await migrateLegacyHouse({ worldRoot: resolvedWorldRoot, destination });
  await fs.mkdir(destination, { recursive: true });
  await writeHouseMapping(resolvedWorldRoot, destination);
  await writeProjectManifest({ filename: manifestPath, cwd: resolvedCwd, destination });
  return destination;
}

export async function seedCodingSaddleHouseGuide({ agentHouse, cwd } = {}) {
  const filename = path.join(agentHouse, "identity", "HOUSE.md");
  try {
    await fs.access(filename);
    return filename;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const content = [
    "# Coding Saddle House",
    "",
    `This house belongs to the project directory \`${path.resolve(cwd)}\`. Its parent world is selected from that exact resolved project path, so another working directory has a separate house and session history.`,
    "Use absolute paths under this house when reading or updating house files; ordinary relative file-tool paths resolve from the project working directory, not from this house.",
    "",
    "- `identity/`: stable agent identity, working agreements, user preferences, and this house guide. Preserve existing identity files.",
    "- `memory/MEMORY.md`: concise, durable project decisions and constraints only. Add a note after a coding task passes its final verification, and include the validation command plus a session or artifact evidence reference. Skip routine task logs and uncertain claims.",
    "- `memory/SUMMARY.md` and dated `memory/*.md`: curated continuity summary and dated notes; keep the Knowledge Core and source corpus separate.",
    "- `session/`: conversation transcripts and session-specific state.",
    "- `conduct/`: saddle preferences, selected models, plans, and project-house registration.",
    "- `artifacts/`: generated evidence and outputs when a workflow writes them.",
    "- `program/` in the Pyash repository contains the shared runtime; do not duplicate project source or the Knowledge Core in this house.",
    "",
    "Project files remain in the working directory. File tools resolve ordinary relative paths from that directory; `~/...` and explicit absolute paths under the home directory are available to saddle file tools. Shell commands continue to run from the project directory under their existing command sandbox and authorization rules."
  ].join("\n") + "\n";
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, content, { encoding: "utf8", flag: "wx" }).catch(async (writeError) => {
    if (writeError?.code !== "EEXIST") throw writeError;
  });
  return filename;
}
