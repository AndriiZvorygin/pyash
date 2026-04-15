import fs from "node:fs";
import path from "node:path";

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_TOP = 30;

function usage() {
  return [
    "Usage: node command/voice_similarity_report.mjs [voices_dir] [--threshold 0.8] [--top 30] [--base speaker_001]",
    "Example: node command/voice_similarity_report.mjs world/voices --threshold 0.8",
    "Example: node command/voice_similarity_report.mjs world/voices --base speaker_001 --top 20"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: "world/voices",
    threshold: DEFAULT_THRESHOLD,
    top: DEFAULT_TOP,
    base: ""
  };
  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("--")) {
    out.voicesDir = args.shift();
  }
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--threshold") {
      out.threshold = Number(args.shift() ?? "");
      continue;
    }
    if (arg === "--top") {
      out.top = Number(args.shift() ?? "");
      continue;
    }
    if (arg === "--base") {
      out.base = String(args.shift() ?? "").trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}\n${usage()}`);
  }
  if (!Number.isFinite(out.threshold) || out.threshold < -1 || out.threshold > 1) {
    throw new Error(`invalid --threshold: ${out.threshold}`);
  }
  if (!Number.isFinite(out.top) || out.top < 1) {
    throw new Error(`invalid --top: ${out.top}`);
  }
  return out;
}

function parseNpyVector(filename) {
  const buf = fs.readFileSync(filename);
  if (buf.length < 16) throw new Error(`npy too small: ${filename}`);
  if (buf[0] !== 0x93 || String.fromCharCode(...buf.subarray(1, 6)) !== "NUMPY") {
    throw new Error(`not npy: ${filename}`);
  }
  const major = buf[6];
  const minor = buf[7];
  let headerLen = 0;
  let offset = 0;
  if (major === 1 || major === 2) {
    if (major === 1) {
      headerLen = buf.readUInt16LE(8);
      offset = 10;
    } else {
      headerLen = buf.readUInt32LE(8);
      offset = 12;
    }
  } else {
    throw new Error(`unsupported npy version ${major}.${minor} in ${filename}`);
  }
  const header = buf.subarray(offset, offset + headerLen).toString("latin1");
  const descrMatch = header.match(/'descr':\s*'([^']+)'/u);
  const fortranMatch = header.match(/'fortran_order':\s*(True|False)/u);
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/u);
  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error(`npy header parse failed: ${filename}`);
  }
  if (fortranMatch[1] !== "False") {
    throw new Error(`fortran_order not supported: ${filename}`);
  }
  const dtype = descrMatch[1];
  const shapeParts = shapeMatch[1]
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v));
  if (shapeParts.length !== 1 || !Number.isFinite(shapeParts[0])) {
    throw new Error(`only 1D npy supported: ${filename}`);
  }
  const size = shapeParts[0];
  const dataOffset = offset + headerLen;
  let bytesPer = 0;
  if (dtype === "<f4") bytesPer = 4;
  else if (dtype === "<f8") bytesPer = 8;
  else throw new Error(`unsupported dtype ${dtype} in ${filename}`);
  const expectedBytes = size * bytesPer;
  if (buf.length < dataOffset + expectedBytes) {
    throw new Error(`npy data truncated: ${filename}`);
  }
  const out = new Float64Array(size);
  if (dtype === "<f4") {
    for (let i = 0; i < size; i += 1) out[i] = buf.readFloatLE(dataOffset + i * 4);
  } else {
    for (let i = 0; i < size; i += 1) out[i] = buf.readDoubleLE(dataOffset + i * 8);
  }
  return out;
}

function cosine(a, b) {
  if (a.length !== b.length) return Number.NaN;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    an += av * av;
    bn += bv * bv;
  }
  if (an <= 0 || bn <= 0) return Number.NaN;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

function listSpeakerNpy(voicesDir) {
  const items = fs.readdirSync(voicesDir, { withFileTypes: true });
  return items
    .filter((it) => it.isFile() && /^speaker_\d+\.npy$/u.test(it.name))
    .map((it) => ({
      key: it.name.replace(/\.npy$/u, ""),
      npy: path.join(voicesDir, it.name)
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function loadDisplayName(voicesDir, key) {
  const pya = path.join(voicesDir, `${key}.pya`);
  if (!fs.existsSync(pya)) return "";
  const text = fs.readFileSync(pya, "utf8");
  const full = text.match(/su name full_name ob text "([^"]+)"/u)?.[1]?.trim();
  const name = text.match(/su name name ob text "([^"]+)"/u)?.[1]?.trim();
  return full || name || "";
}

function reportPairs({ vectors, threshold, top }) {
  const pairs = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const sim = cosine(vectors[i].vec, vectors[j].vec);
      if (!Number.isFinite(sim)) continue;
      if (sim >= threshold) {
        pairs.push({
          a: vectors[i],
          b: vectors[j],
          sim
        });
      }
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);
  process.stdout.write(`voices: ${vectors.length}\n`);
  process.stdout.write(`threshold: ${threshold.toFixed(3)}\n`);
  process.stdout.write(`pairs_above_threshold: ${pairs.length}\n`);
  process.stdout.write("\n");
  for (const item of pairs.slice(0, top)) {
    const aName = item.a.display ? ` (${item.a.display})` : "";
    const bName = item.b.display ? ` (${item.b.display})` : "";
    process.stdout.write(`${item.a.key}${aName} <-> ${item.b.key}${bName} : ${item.sim.toFixed(4)}\n`);
  }
}

function reportBase({ vectors, baseKey, top }) {
  const base = vectors.find((v) => v.key === baseKey);
  if (!base) {
    throw new Error(`base speaker not found: ${baseKey}`);
  }
  const rows = [];
  for (const v of vectors) {
    if (v.key === base.key) continue;
    const sim = cosine(base.vec, v.vec);
    if (!Number.isFinite(sim)) continue;
    rows.push({ base, other: v, sim });
  }
  rows.sort((x, y) => y.sim - x.sim);
  process.stdout.write(`base: ${base.key}${base.display ? ` (${base.display})` : ""}\n`);
  process.stdout.write(`compared: ${rows.length}\n\n`);
  for (const row of rows.slice(0, top)) {
    process.stdout.write(`${row.other.key}${row.other.display ? ` (${row.other.display})` : ""} : ${row.sim.toFixed(4)}\n`);
  }
}

export {
  parseArgs,
  parseNpyVector,
  cosine,
  listSpeakerNpy,
  loadDisplayName,
  reportPairs,
  reportBase
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const voicesDir = path.resolve(process.cwd(), opts.voicesDir);
  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) {
    throw new Error(`voices dir not found: ${voicesDir}`);
  }
  const entries = listSpeakerNpy(voicesDir);
  const vectors = [];
  for (const it of entries) {
    try {
      const vec = parseNpyVector(it.npy);
      vectors.push({
        ...it,
        vec,
        display: loadDisplayName(voicesDir, it.key)
      });
    } catch (error) {
      process.stderr.write(`[voice-sim] skip ${it.key}: ${error?.message || String(error)}\n`);
    }
  }
  if (opts.base) {
    reportBase({ vectors, baseKey: opts.base, top: Math.floor(opts.top) });
    return;
  }
  reportPairs({ vectors, threshold: opts.threshold, top: Math.floor(opts.top) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  }
}
