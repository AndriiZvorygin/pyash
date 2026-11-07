import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveSandboxSettings } from "../verbs/command/sandbox.mjs";
import { command } from "../verbs/command/command.mjs";

function fail(sentence, name, message, raw = {}) {
  throwErrorSentence({ name, message, from: { la: sentence }, raw });
}

function shellArgument(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function stateValue(value) {
  return String(value?.wo ?? value?.text ?? value?.name ?? "").trim().toLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isWithinAny(roots, candidate) {
  for (const root of roots ?? []) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (realRoot && isWithin(realRoot, candidate)) return true;
  }
  return false;
}

async function resolveSandboxPath(raw, sandbox, { access = "read", kind = "file" } = {}) {
  const candidate = path.resolve(sandbox.cwd, String(raw ?? ""));
  const cwdReal = await fs.realpath(sandbox.cwd).catch(() => null);
  if (!cwdReal || !isWithin(cwdReal, candidate)) {
    return { error: "path must remain under the command working directory", candidate };
  }
  const real = await fs.realpath(candidate).catch(() => null);
  const roots = access === "write" ? sandbox.writableRoots : sandbox.commandRoots;
  if (!real || !isWithin(cwdReal, real) || !await isWithinAny(roots, real)) {
    return { error: `path is outside ${access === "write" ? "writable" : "command"} roots`, candidate };
  }
  const stat = await fs.stat(real).catch(() => null);
  if (kind === "file" && !stat?.isFile()) return { error: "path must be a regular file", candidate: real };
  if (kind === "directory" && !stat?.isDirectory()) return { error: "path must be a directory", candidate: real };
  return { path: real, cwd: cwdReal };
}

async function assertNoSymlinks(root, sentence) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      fail(sentence, "cluster compress input invalid", "HTML folder input cannot contain symbolic links", { path: fullPath });
    }
    if (entry.isDirectory()) await assertNoSymlinks(fullPath, sentence);
  }
}

function textFromSentence(sentence) {
  const source = sentence?.from ?? sentence?.ob ?? {};
  return typeof source.text === "string" ? source.text : null;
}

function filenameFromSentence(sentence) {
  for (const source of [sentence?.from, sentence?.ob, sentence?.in, sentence?.inside]) {
    if (typeof source?.filename === "string") return source.filename;
  }
  return null;
}

function outputFromSentence(sentence) {
  return typeof sentence?.to?.filename === "string" ? sentence.to.filename : "";
}

function sanitizeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeArchiveName(outputPath) {
  const base = path.basename(outputPath, path.extname(outputPath));
  return base.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "archive";
}

function resolveMetadata(sentence, rememberFn, outputPath, sourceState) {
  const outputName = path.basename(outputPath, path.extname(outputPath));
  const metadataName = sentence?.with?.name ?? sentence?.accordingto?.name ?? "";
  const metadataMap = metadataName ? rememberFn(metadataName)?.ob?.map : null;
  const mapText = (key) => {
    const item = metadataMap?.[key];
    return item?.ob?.text ?? item?.text ?? item?.ob?.name ?? item?.name ?? "";
  };
  const title = mapText("title") || outputName;
  const description = mapText("description") || `Offline archive created from ${sourceState} content.`;
  return {
    title,
    name: mapText("name") || safeArchiveName(outputPath),
    language: mapText("language") || resolveConfigText("zim archive default language", { rememberFn }) || "und",
    description,
    longDescription: mapText("long description") || `${description} Created by Pyash.`,
    creator: mapText("creator") || resolveConfigText("zim archive default creator", { rememberFn }) || "Pyash",
    publisher: mapText("publisher") || resolveConfigText("zim archive default publisher", { rememberFn }) || "Pyash",
    welcome: mapText("welcome") || "index.html"
  };
}

function configuredTool(name, fallback, rememberFn) {
  return resolveConfigText(name, { rememberFn }) || fallback;
}

function configuredImage(name, fallback, rememberFn) {
  return resolveConfigText(name, { rememberFn }) || fallback;
}

async function runCommand(sentence, commandText, label, { rememberFn, runtimeContext } = {}) {
  return command({
    mood: "do",
    su: { name: `${label} command` },
    ob: { text: commandText },
    to: { name: `${label} command output` },
    be: "command"
  }, { remember: rememberFn, runtimeContext });
}

async function ensureTarget(sentence, sandbox) {
  const rawTarget = outputFromSentence(sentence);
  if (!rawTarget) fail(sentence, "cluster compress output missing", "ZIM conversion requires to filename");
  if (path.extname(rawTarget).toLowerCase() !== ".zim") {
    fail(sentence, "cluster compress output invalid", "ZIM output filename must use the .zim extension", { target: rawTarget });
  }
  const target = path.resolve(sandbox.cwd, rawTarget);
  const parent = await resolveSandboxPath(path.dirname(target), sandbox, { access: "write", kind: "directory" });
  if (parent.error) fail(sentence, "cluster compress sandbox defective", parent.error, { target: rawTarget, path: parent.candidate });
  const targetPath = path.join(parent.path, path.basename(target));
  const exists = await fs.lstat(targetPath).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    fail(sentence, "cluster compress output invalid", "cannot inspect ZIM output path", { targetPath, error: error?.message });
  });
  if (exists) fail(sentence, "cluster compress output exists", `cluster-compress refuses to overwrite ${targetPath}`, { targetPath });
  return { targetPath, parent: parent.path, relativeTarget: path.relative(parent.cwd, targetPath) };
}

async function resolveInputFile(sentence, sandbox, rawPath) {
  const resolved = await resolveSandboxPath(rawPath, sandbox, { access: "read", kind: "file" });
  if (resolved.error) fail(sentence, "cluster compress input invalid", resolved.error, { path: rawPath, resolved: resolved.candidate });
  return resolved;
}

async function resolveInputDirectory(sentence, sandbox, rawPath) {
  const resolved = await resolveSandboxPath(rawPath, sandbox, { access: "read", kind: "directory" });
  if (resolved.error) fail(sentence, "cluster compress input invalid", resolved.error, { path: rawPath, resolved: resolved.candidate });
  await assertNoSymlinks(resolved.path, sentence);
  return resolved;
}

async function inferSourceState(sentence, source, sandbox) {
  if (typeof source?.text === "string") return "text";
  if (!source?.filename) return "";
  if (/\.warc(?:\.gz)?$/iu.test(source.filename)) return "warc";
  const resolved = await resolveSandboxPath(source.filename, sandbox, { access: "read", kind: "any" });
  if (resolved.error) fail(sentence, "cluster compress input invalid", resolved.error, { path: source.filename, resolved: resolved.candidate });
  const stats = await fs.stat(resolved.path).catch(() => null);
  if (stats?.isDirectory()) return "html";
  if (stats?.isFile()) return "text";
  fail(sentence, "cluster compress input invalid", "input must be a regular file or HTML directory", { path: resolved.path });
}

function zimwriterfsCommand({ input, output, metadata, illustration, tool }) {
  const args = [
    `${tool}`,
    `--welcome=${metadata.welcome}`,
    `--language=${metadata.language}`,
    `--title=${metadata.title}`,
    `--description=${metadata.description}`,
    `--longDescription=${metadata.longDescription}`,
    `--creator=${metadata.creator}`,
    `--publisher=${metadata.publisher}`,
    `--name=${metadata.name}`,
    input,
    output
  ];
  if (illustration) args.splice(2, 0, `--illustration=${illustration}`);
  return args.map(shellArgument).join(" ");
}

async function runZimwriterfs(sentence, { inputDirectory, target, metadata, sandbox, rememberFn, runtimeContext }) {
  const tool = configuredTool("zim html folder writer module", "zimwriterfs", rememberFn);
  const illustrationSetting = resolveConfigText("zim archive illustration", { rememberFn });
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".zim-writer-"));
  try {
    const stagedInput = path.join(stage, "content");
    await fs.cp(inputDirectory, stagedInput, { recursive: true, errorOnExist: true });
    const illustration = illustrationSetting
      ? path.resolve(sandbox.runRoot, illustrationSetting)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../containers/zim-tools/archive-illustration.png");
    const iconStats = await fs.stat(illustration).catch(() => null);
    if (!iconStats?.isFile()) {
      fail(sentence, "cluster compress configuration invalid", "ZIM illustration file is unavailable", { illustration });
    }
    let iconName = "pyash-archive-illustration.png";
    for (let suffix = 2; await fs.lstat(path.join(stagedInput, iconName)).then(() => true).catch(() => false); suffix += 1) {
      iconName = `pyash-archive-illustration-${suffix}.png`;
    }
    const stagedIllustration = path.join(stagedInput, iconName);
    await fs.copyFile(illustration, stagedIllustration);
    const relativeInput = path.relative(sandbox.cwd, stagedInput) || ".";
    const relativeTarget = path.relative(sandbox.cwd, target);
    const commandText = zimwriterfsCommand({
      tool,
      input: relativeInput,
      output: relativeTarget,
      metadata,
      illustration: iconName
    });
    return await runCommand(sentence, commandText, "zim html folder writer", { rememberFn, runtimeContext });
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function writeTextSource(sentence, { source, sandbox, target, metadata, rememberFn, runtimeContext }) {
  let text = source.text;
  if (text === null && source.filename) {
    const input = await resolveInputFile(sentence, sandbox, source.filename);
    const bytes = await fs.readFile(input.path);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      fail(sentence, "cluster compress input invalid", "text input must be UTF-8", { path: input.path, error: error.message });
    }
  }
  if (typeof text !== "string") fail(sentence, "cluster compress input missing", "text state requires from text or from filename");
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".zim-text-"));
  try {
    const html = `<!doctype html>\n<html lang="${sanitizeHtml(metadata.language)}"><head><meta charset="utf-8"><title>${sanitizeHtml(metadata.title)}</title></head><body><pre>${sanitizeHtml(text)}</pre></body></html>\n`;
    await fs.writeFile(path.join(stage, "index.html"), html, "utf8");
    return await runZimwriterfs(sentence, {
      inputDirectory: stage,
      target,
      metadata,
      sandbox,
      rememberFn,
      runtimeContext
    });
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function writeHtmlFolder(sentence, { source, sandbox, target, metadata, rememberFn, runtimeContext }) {
  if (!source.filename) fail(sentence, "cluster compress input missing", "HTML state requires from filename naming an HTML folder");
  const input = await resolveInputDirectory(sentence, sandbox, source.filename);
  const welcome = path.resolve(input.path, metadata.welcome);
  if (!isWithin(input.path, welcome) || !await fs.stat(welcome).then((stat) => stat.isFile()).catch(() => false)) {
    fail(sentence, "cluster compress input invalid", "HTML folder must contain the configured ZIM welcome file", { welcome: metadata.welcome, input: input.path });
  }
  const result = await runZimwriterfs(sentence, {
    inputDirectory: input.path,
    target,
    metadata,
    sandbox,
    rememberFn,
    runtimeContext
  });
  return result;
}

async function listFilesRecursively(root) {
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFilesRecursively(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function writeWebCapture(sentence, { source, sandbox, target, rememberFn, runtimeContext }) {
  const urlText = String(source.filename ?? source.text ?? "").trim();
  let url;
  try {
    url = new URL(urlText);
  } catch {
    fail(sentence, "cluster compress input invalid", "web state requires an absolute HTTP or HTTPS URL", { url: urlText });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(sentence, "cluster compress input invalid", "web state supports only HTTP and HTTPS URLs", { url: urlText });
  }
  if (sandbox.networkAllowed === false) fail(sentence, "cluster compress network disabled", "web-to-ZIM capture requires network access", { url: url.href });
  const name = safeArchiveName(target);
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".zim-web-"));
  const image = configuredImage("zim website capture image", "ghcr.io/openzim/zimit", rememberFn);
  const tool = configuredTool("zim website capture module", "zimit", rememberFn);
  const commandText = [
    "docker run --rm",
    "-v",
    shellArgument(`${stage}:/output`),
    shellArgument(image),
    shellArgument(tool),
    shellArgument(`--seeds=${url.href}`),
    shellArgument(`--name=${name}`),
    "--output=/output",
    "--keep"
  ].join(" ");
  let retainedCapture = false;
  try {
    const commandResult = await runCommand(sentence, commandText, "zim website capture", { rememberFn, runtimeContext });
    if (commandResult?.be !== "command" || commandResult?.mood !== "ya") return commandResult;
    const generated = path.join(stage, `${name}.zim`);
    const stats = await fs.stat(generated).catch(() => null);
    if (!stats?.isFile() || stats.size === 0) {
      fail(sentence, "cluster compress output missing", "Zimit completed without creating a non-empty ZIM archive", { output: generated, outputText: commandResult?.ob?.text ?? "" });
    }
    const warcs = (await listFilesRecursively(stage)).filter((filename) => /\.warc(?:\.gz)?$/iu.test(filename));
    const captureDirectory = `${target}.capture`;
    const captureExists = await fs.lstat(captureDirectory).then(() => true).catch(() => false);
    if (captureExists) {
      fail(sentence, "cluster compress capture exists", `capture artifact directory already exists: ${captureDirectory}`, { captureDirectory });
    }
    await fs.rename(generated, target);
    await fs.rename(stage, captureDirectory);
    retainedCapture = true;
    return {
      mood: "ya",
      su: sentence?.su ?? { name: "cluster-compressed archive" },
      ob: { filename: target },
      from: { filename: url.href },
      to: { filename: target },
      ...(warcs.length ? { warc: { filename: path.join(captureDirectory, path.relative(stage, warcs[0])) } } : {}),
      capture: { filename: captureDirectory },
      be: "cluster-compress"
    };
  } finally {
    if (!retainedCapture) await fs.rm(stage, { recursive: true, force: true });
  }
}

async function writeWarcSource(sentence, { source, sandbox, target, rememberFn, runtimeContext }) {
  if (!source.filename) fail(sentence, "cluster compress input missing", "WARC state requires from filename");
  const input = await resolveInputFile(sentence, sandbox, source.filename);
  if (!/\.warc(?:\.gz)?$/iu.test(input.path)) fail(sentence, "cluster compress input invalid", "WARC state requires a .warc or .warc.gz file", { source: input.path });
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".zim-warc-"));
  const mountInput = path.dirname(input.path);
  const inputRelative = `/input/${path.basename(input.path)}`;
  const image = configuredImage("zim website capture image", "ghcr.io/openzim/zimit", rememberFn);
  const name = safeArchiveName(target);
  const commandText = [
    "docker run --rm",
    "-v",
    shellArgument(`${mountInput}:/input:ro`),
    "-v",
    shellArgument(`${stage}:/output`),
    shellArgument(image),
    "warc2zim",
    shellArgument(inputRelative),
    "--output=/output",
    shellArgument(`--name=${name}`)
  ].join(" ");
  try {
    const result = await runCommand(sentence, commandText, "zim WARC writer", { rememberFn, runtimeContext });
    if (result?.be !== "command" || result?.mood !== "ya") return result;
    const generated = path.join(stage, `${name}.zim`);
    const stats = await fs.stat(generated).catch(() => null);
    if (!stats?.isFile() || stats.size === 0) fail(sentence, "cluster compress output missing", "warc2zim completed without creating a non-empty ZIM archive", { output: generated });
    await fs.rename(generated, target);
    return {
      mood: "ya",
      su: sentence?.su ?? { name: "cluster-compressed archive" },
      ob: { filename: target },
      from: { filename: input.path },
      to: { filename: target },
      be: "cluster-compress"
    };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function clusterCompress(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null
} = {}) {
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const targetInfo = await ensureTarget(sentence, sandbox);
  const target = targetInfo.targetPath;
  const targetState = stateValue(sentence?.tostate ?? sentence?.become);
  if (targetState && targetState !== "zim" && targetState !== "cluster-compress") {
    fail(sentence, "cluster compress target state invalid", `cluster-compress cannot produce ${targetState}`, { targetState });
  }
  const source = sentence?.from ?? sentence?.ob ?? {};
  const sourceState = stateValue(sentence?.fromstate) || await inferSourceState(sentence, source, sandbox);
  const metadata = resolveMetadata(sentence, rememberFn, target, sourceState);
  let result;
  if (sourceState === "text") {
    result = await writeTextSource(sentence, {
      source: { text: typeof source.text === "string" ? source.text : null, filename: source.filename },
      sandbox,
      target,
      metadata,
      rememberFn,
      runtimeContext
    });
  } else if (sourceState === "html" || sourceState === "html-folder" || sourceState === "html folder") {
    result = await writeHtmlFolder(sentence, { source, sandbox, target, metadata, rememberFn, runtimeContext });
  } else if (sourceState === "web") {
    return writeWebCapture(sentence, { source, sandbox, target, rememberFn, runtimeContext });
  } else if (sourceState === "warc") {
    result = await writeWarcSource(sentence, { source, sandbox, target, rememberFn, runtimeContext });
  } else {
    fail(sentence, "cluster compress source state invalid", `cluster-compress does not support source state ${sourceState || "(missing)"}`, {
      sourceState,
      supported: ["text", "html", "web", "warc"]
    });
  }
  if (result?.be !== "command" || result?.mood !== "ya") return result;
  const outputStats = await fs.stat(target).catch(() => null);
  if (!outputStats?.isFile() || outputStats.size === 0) {
    fail(sentence, "cluster compress output missing", "ZIM writer completed without creating a non-empty archive", {
      outputPath: target,
      commandOutput: result?.ob?.text ?? ""
    });
  }
  return {
    mood: "ya",
    su: sentence?.su ?? { name: "cluster-compressed archive" },
    ob: { filename: target },
    ...(source.filename ? { from: { filename: path.resolve(sandbox.cwd, source.filename) } } : {}),
    to: { filename: target },
    be: "cluster-compress"
  };
}

export async function writeClusterCompress(sentence, options = {}) {
  const source = sentence?.from ?? sentence?.ob ?? {};
  const sandbox = resolveSandboxSettings({ sentence, rememberFn: options.remember ?? remember });
  const sourceState = stateValue(sentence?.fromstate) || await inferSourceState(sentence, source, sandbox);
  return clusterCompress({
    ...sentence,
    from: source,
    fromstate: { wo: sourceState },
    tostate: { wo: "zim" }
  }, options);
}

async function resolveZimInput(sentence, rememberFn) {
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const filename = filenameFromSentence(sentence);
  if (!filename) fail(sentence, "zim archive missing", "ZIM read/search requires from filename or in filename");
  const input = await resolveInputFile(sentence, sandbox, filename);
  if (path.extname(input.path).toLowerCase() !== ".zim") fail(sentence, "zim archive invalid", "ZIM read/search input must use the .zim extension", { filename: input.path });
  return { sandbox, filename: input.path, relative: path.relative(sandbox.cwd, input.path) };
}

async function resolveZimSearchInputs(sentence, rememberFn) {
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const filename = filenameFromSentence(sentence);
  if (!filename) fail(sentence, "zim archive missing", "ZIM search requires from filename or in filename");
  const input = await resolveSandboxPath(filename, sandbox, { access: "read", kind: "any" });
  if (input.error) fail(sentence, "zim archive invalid", input.error, { filename, resolved: input.candidate });
  const stats = await fs.stat(input.path).catch(() => null);
  if (stats?.isFile()) {
    if (path.extname(input.path).toLowerCase() !== ".zim") {
      fail(sentence, "zim archive invalid", "ZIM search input file must use the .zim extension", { filename: input.path });
    }
    return {
      libraryPath: input.path,
      isCollection: false,
      archives: [{ filename: input.path, relative: path.relative(sandbox.cwd, input.path) }]
    };
  }
  if (!stats?.isDirectory()) {
    fail(sentence, "zim archive invalid", "ZIM search input must be an archive or a directory of archives", { filename: input.path });
  }
  const entries = await fs.readdir(input.path, { withFileTypes: true });
  const archives = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".zim") continue;
    const archivePath = path.join(input.path, entry.name);
    const resolved = await resolveInputFile(sentence, sandbox, archivePath);
    archives.push({ filename: resolved.path, relative: path.relative(sandbox.cwd, resolved.path) });
  }
  return { libraryPath: input.path, isCollection: true, archives };
}

export async function readZimArchive(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null
} = {}) {
  const { filename, relative } = await resolveZimInput(sentence, rememberFn);
  const requestedEntry = typeof sentence?.ob?.text === "string" ? sentence.ob.text.trim() : "";
  const tool = configuredTool("zim archive reader module", "zimdump", rememberFn);
  const commandText = requestedEntry
    ? [shellArgument(tool), "show", shellArgument(`--url=${requestedEntry}`), "--", shellArgument(relative)].join(" ")
    : [shellArgument(tool), "list", "--details", "--", shellArgument(relative)].join(" ");
  const result = await runCommand(sentence, commandText, "zim archive reader", { rememberFn, runtimeContext });
  if (result?.be !== "command" || result?.mood !== "ya") return result;
  return {
    mood: "ya",
    su: sentence?.to?.name ? { name: sentence.to.name } : (sentence?.su ?? { name: "ZIM archive contents" }),
    ob: { text: result?.ob?.text ?? "" },
    from: { filename },
    be: "read"
  };
}

export async function searchZimArchive(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null
} = {}) {
  const { libraryPath, isCollection, archives } = await resolveZimSearchInputs(sentence, rememberFn);
  const query = String(sentence?.ob?.text ?? rememberFn(sentence?.ob?.name)?.ob?.text ?? "").trim();
  if (!query) fail(sentence, "zim search query missing", "ZIM search requires ob text query");
  const tool = configuredTool("zim archive search module", "kiwix-search", rememberFn);
  const results = [];
  let singleArchiveOutput = "";
  for (const archive of archives) {
    const commandText = [shellArgument(tool), shellArgument(archive.relative), shellArgument(query)].join(" ");
    const result = await runCommand(sentence, commandText, "zim archive search", { rememberFn, runtimeContext });
    if (result?.be !== "command" || result?.mood !== "ya") return result;
    const text = String(result?.ob?.text ?? "");
    if (isCollection) {
      const trimmed = text.trim();
      if (trimmed) results.push(`${path.basename(archive.filename)}\n${trimmed}`);
    } else {
      singleArchiveOutput = text;
    }
  }
  let output = singleArchiveOutput;
  if (isCollection) {
    if (archives.length === 0) output = "No ZIM archives found in the selected directory.";
    else if (results.length === 0) output = `No results found across ${archives.length} ZIM archives.`;
    else output = results.join("\n");
  }
  return {
    mood: "ya",
    su: sentence?.to?.name ? { name: sentence.to.name } : (sentence?.su ?? { name: "ZIM search results" }),
    ob: { text: output },
    from: { filename: libraryPath },
    be: "search"
  };
}

export function isClusterCompressFormat(sentence) {
  return [sentence?.as, sentence?.become, sentence?.fromstate]
    .some((value) => ["cluster-compress", "zim"].includes(stateValue(value)));
}
