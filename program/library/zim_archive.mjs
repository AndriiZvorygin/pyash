import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remember } from "../remember/index.mjs";
import {
  resolveConfigBool,
  resolveConfigMapNum,
  resolveConfigMapSeries,
  resolveConfigMapText,
  resolveConfigText
} from "../configure/env.mjs";
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

async function isConfiguredZimStorage(candidate, real, sandbox, rememberFn) {
  const librarySetting = resolveConfigText("zim archive library directory", { rememberFn }) ?? "world/library/archive";
  const storageSetting = resolveConfigText("zim archive service directory", { rememberFn });
  if (!storageSetting) return false;
  const libraryAlias = path.resolve(sandbox.cwd, librarySetting);
  const storageRoot = path.resolve(sandbox.cwd, storageSetting);
  return isWithin(libraryAlias, candidate) && isWithin(storageRoot, real);
}

async function resolveSandboxPath(raw, sandbox, {
  access = "read",
  kind = "file",
  rememberFn = remember
} = {}) {
  const candidate = path.resolve(sandbox.cwd, String(raw ?? ""));
  const cwdReal = await fs.realpath(sandbox.cwd).catch(() => null);
  if (!cwdReal || !isWithin(cwdReal, candidate)) {
    return { error: "path must remain under the command working directory", candidate };
  }
  const real = await fs.realpath(candidate).catch(() => null);
  const roots = access === "write" ? sandbox.writableRoots : sandbox.commandRoots;
  const withinCommandRoots = real && isWithin(cwdReal, real) && await isWithinAny(roots, real);
  const configuredZimStorage = real && await isConfiguredZimStorage(candidate, real, sandbox, rememberFn);
  if (!real || (!withinCommandRoots && !configuredZimStorage)) {
    return { error: `path is outside ${access === "write" ? "writable" : "command"} roots`, candidate };
  }
  const stat = await fs.stat(real).catch(() => null);
  if (kind === "file" && !stat?.isFile()) return { error: "path must be a regular file", candidate: real };
  if (kind === "directory" && !stat?.isDirectory()) return { error: "path must be a directory", candidate: real };
  return { path: configuredZimStorage ? candidate : real, cwd: cwdReal };
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

function captureConfigText(key, sentence, rememberFn) {
  const value = String(resolveConfigMapText("web archive configure", key, { rememberFn }) ?? "").trim();
  if (!value) fail(sentence, "cluster compress configuration invalid", `missing Zimit setting: ${key}`, { setting: key });
  return value;
}

function captureConfigPositiveInteger(key, sentence, rememberFn) {
  const value = resolveConfigMapNum("web archive configure", key, { rememberFn });
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(sentence, "cluster compress configuration invalid", `Zimit setting must be a positive integer: ${key}`, { setting: key, value });
  }
  return value;
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

async function ensureTarget(sentence, sandbox, rememberFn) {
  const rawTarget = outputFromSentence(sentence);
  if (!rawTarget) fail(sentence, "cluster compress output missing", "ZIM conversion requires to filename");
  if (path.extname(rawTarget).toLowerCase() !== ".zim") {
    fail(sentence, "cluster compress output invalid", "ZIM output filename must use the .zim extension", { target: rawTarget });
  }
  const target = path.resolve(sandbox.cwd, rawTarget);
  const parent = await resolveSandboxPath(path.dirname(target), sandbox, {
    access: "write",
    kind: "directory",
    rememberFn
  });
  if (parent.error) fail(sentence, "cluster compress sandbox defective", parent.error, { target: rawTarget, path: parent.candidate });
  const targetPath = path.join(parent.path, path.basename(target));
  const exists = await fs.lstat(targetPath).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    fail(sentence, "cluster compress output invalid", "cannot inspect ZIM output path", { targetPath, error: error?.message });
  });
  if (exists) fail(sentence, "cluster compress output exists", `cluster-compress refuses to overwrite ${targetPath}`, { targetPath });
  return { targetPath, parent: parent.path, relativeTarget: path.relative(parent.cwd, targetPath) };
}

async function resolveInputFile(sentence, sandbox, rawPath, rememberFn) {
  const resolved = await resolveSandboxPath(rawPath, sandbox, {
    access: "read",
    kind: "file",
    rememberFn
  });
  if (resolved.error) fail(sentence, "cluster compress input invalid", resolved.error, { path: rawPath, resolved: resolved.candidate });
  return resolved;
}

async function resolveInputDirectory(sentence, sandbox, rawPath, rememberFn) {
  const resolved = await resolveSandboxPath(rawPath, sandbox, {
    access: "read",
    kind: "directory",
    rememberFn
  });
  if (resolved.error) fail(sentence, "cluster compress input invalid", resolved.error, { path: rawPath, resolved: resolved.candidate });
  await assertNoSymlinks(resolved.path, sentence);
  return resolved;
}

async function inferSourceState(sentence, source, sandbox, rememberFn) {
  if (typeof source?.text === "string") return "text";
  if (!source?.filename) return "";
  if (/\.warc(?:\.gz)?$/iu.test(source.filename)) return "warc";
  const resolved = await resolveSandboxPath(source.filename, sandbox, {
    access: "read",
    kind: "any",
    rememberFn
  });
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
    const input = await resolveInputFile(sentence, sandbox, source.filename, rememberFn);
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
  const input = await resolveInputDirectory(sentence, sandbox, source.filename, rememberFn);
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
  const networkEnabled = resolveConfigBool("web archive network", { rememberFn })
    ?? sandbox.networkAllowed;
  if (networkEnabled !== true) {
    fail(sentence, "cluster compress network disabled", "web-to-ZIM capture requires enabled network permission", { url: url.href });
  }
  const name = safeArchiveName(target);
  const scopeType = captureConfigText("web archive prefix", sentence, rememberFn);
  if (!["page", "page-spa", "prefix", "host", "domain", "any", "custom"].includes(scopeType)) {
    fail(sentence, "cluster compress configuration invalid", `unsupported Zimit scope type: ${scopeType}`, { scopeType });
  }
  const scopeIncludes = resolveConfigMapSeries("web archive configure", "web archive page include", { rememberFn }) ?? [];
  if (!Array.isArray(scopeIncludes) || scopeIncludes.some((rule) => !String(rule).trim())) {
    fail(sentence, "cluster compress configuration invalid", "Zimit page include rules must be non-empty text values", { scopeIncludes });
  }
  if (scopeType === "custom" && scopeIncludes.length === 0) {
    fail(sentence, "cluster compress configuration invalid", "custom Zimit scope requires at least one page include rule");
  }
  const pageLimit = captureConfigPositiveInteger("web archive page maximum", sentence, rememberFn);
  const pageTimeoutSeconds = captureConfigPositiveInteger("web archive page timeout seconds", sentence, rememberFn);
  const pageIntervalSeconds = captureConfigPositiveInteger("web archive page interval seconds", sentence, rememberFn);
  const hardTimeLimitSeconds = captureConfigPositiveInteger("web archive duration maximum seconds", sentence, rememberFn);
  const hardSizeLimitBytes = captureConfigPositiveInteger("web archive size maximum bytes", sentence, rememberFn);
  const workers = captureConfigPositiveInteger("web archive workers", sentence, rememberFn);
  const behaviors = resolveConfigMapText("web archive configure", "web archive behavior", { rememberFn });
  const blockRules = resolveConfigMapSeries("web archive configure", "photograph filter", { rememberFn });
  if (!blockRules) {
    fail(sentence, "cluster compress configuration invalid", "missing Zimit photograph filter rules", { setting: "photograph filter" });
  }
  if (!Array.isArray(blockRules) || blockRules.some((rule) => !String(rule).trim())) {
    fail(sentence, "cluster compress configuration invalid", "photograph filter patterns must be non-empty text values", { blockRules });
  }
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".zim-web-"));
  const image = configuredImage("zim website capture image", "ghcr.io/openzim/zimit", rememberFn);
  const tool = configuredTool("zim website capture module", "zimit", rememberFn);
  const owner = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const commandText = [
    "docker run --rm",
    "-v",
    shellArgument(`${stage}:/output`),
    shellArgument(image),
    shellArgument(tool),
    shellArgument(`--seeds=${url.href}`),
    shellArgument(`--name=${name}`),
    shellArgument(`--scopeType=${scopeType}`),
    ...scopeIncludes.map((rule) => shellArgument(`--scopeIncludeRx=${rule}`)),
    shellArgument(`--pageLimit=${pageLimit}`),
    shellArgument(`--pageLoadTimeout=${pageTimeoutSeconds}`),
    shellArgument(`--pageExtraDelay=${pageIntervalSeconds}`),
    shellArgument(`--timeHardLimit=${hardTimeLimitSeconds}`),
    shellArgument(`--sizeHardLimit=${hardSizeLimitBytes}`),
    shellArgument(`--workers=${workers}`),
    ...(behaviors ? [shellArgument(`--behaviors=${behaviors}`)] : []),
    ...blockRules.map((rule) => shellArgument(`--blockRules=${rule}`)),
    "--output=/output",
    "--keep"
  ].join(" ");
  const ownershipCommand = [
    "docker run --rm --entrypoint=chown",
    "-v",
    shellArgument(`${stage}:/output`),
    shellArgument(image),
    "-R",
    owner,
    "/output"
  ].join(" ");
  let retainedCapture = false;
  try {
    const commandResult = await runCommand(sentence, commandText, "zim website capture", { rememberFn, runtimeContext });
    if (commandResult?.be !== "command" || commandResult?.mood !== "ya") return commandResult;
    const ownershipResult = await runCommand(sentence, ownershipCommand, "zim capture ownership", { rememberFn, runtimeContext });
    if (ownershipResult?.be !== "command" || ownershipResult?.mood !== "ya") return ownershipResult;
    const stagedFiles = await listFilesRecursively(stage);
    const zimFiles = stagedFiles.filter((filename) => /\.zim$/iu.test(filename));
    const generated = zimFiles.length === 1 ? zimFiles[0] : null;
    const stats = generated ? await fs.stat(generated).catch(() => null) : null;
    if (!stats?.isFile() || stats.size === 0) {
      fail(sentence, "cluster compress output missing", "Zimit must create exactly one non-empty ZIM archive", { outputs: zimFiles, outputText: commandResult?.ob?.text ?? "" });
    }
    const warcs = stagedFiles.filter((filename) => /\.warc(?:\.gz)?$/iu.test(filename));
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
  const input = await resolveInputFile(sentence, sandbox, source.filename, rememberFn);
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
  const targetInfo = await ensureTarget(sentence, sandbox, rememberFn);
  const target = targetInfo.targetPath;
  const targetState = stateValue(sentence?.tostate ?? sentence?.become);
  if (targetState && targetState !== "zim" && targetState !== "cluster-compress") {
    fail(sentence, "cluster compress target state invalid", `cluster-compress cannot produce ${targetState}`, { targetState });
  }
  const source = sentence?.from ?? sentence?.ob ?? {};
  const sourceState = stateValue(sentence?.fromstate) || await inferSourceState(sentence, source, sandbox, rememberFn);
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
  const sourceState = stateValue(sentence?.fromstate) || await inferSourceState(
    sentence,
    source,
    sandbox,
    options.remember ?? remember
  );
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
  const input = await resolveInputFile(sentence, sandbox, filename, rememberFn);
  if (path.extname(input.path).toLowerCase() !== ".zim") fail(sentence, "zim archive invalid", "ZIM read/search input must use the .zim extension", { filename: input.path });
  return { sandbox, filename: input.path, relative: path.relative(sandbox.cwd, input.path) };
}

async function resolveZimSearchInputs(sentence, rememberFn) {
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const filename = filenameFromSentence(sentence);
  if (!filename) fail(sentence, "zim archive missing", "ZIM search requires from filename or in filename");
  const input = await resolveSandboxPath(filename, sandbox, {
    access: "read",
    kind: "any",
    rememberFn
  });
  if (input.error) fail(sentence, "zim archive invalid", input.error, { filename, resolved: input.candidate });
  const stats = await fs.stat(input.path).catch(() => null);
  if (stats?.isFile()) {
    if (path.extname(input.path).toLowerCase() !== ".zim") {
      fail(sentence, "zim archive invalid", "ZIM search input file must use the .zim extension", { filename: input.path });
    }
    return {
      sandbox,
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
    const resolved = await resolveInputFile(sentence, sandbox, archivePath, rememberFn);
    archives.push({ filename: resolved.path, relative: path.relative(sandbox.cwd, resolved.path) });
  }
  return { sandbox, libraryPath: input.path, isCollection: true, archives };
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
  const { sandbox, libraryPath, isCollection, archives } = await resolveZimSearchInputs(sentence, rememberFn);
  const query = String(sentence?.ob?.text ?? rememberFn(sentence?.ob?.name)?.ob?.text ?? "").trim();
  if (!query) fail(sentence, "zim search query missing", "ZIM search requires ob text query");
  const configuredLibrary = resolveConfigText("zim archive library directory", { rememberFn }) ?? "world/library/archive";
  const sharedLibraryPath = path.resolve(sandbox.cwd, configuredLibrary);
  const isSharedLibrary = isCollection && sharedLibraryPath === libraryPath;
  const isSharedArchive = !isCollection && sharedLibraryPath === path.dirname(libraryPath);
  if (isSharedLibrary || isSharedArchive) {
    const archiveFilter = isSharedArchive
      ? path.basename(libraryPath, path.extname(libraryPath)).toLowerCase()
      : null;
    return searchZimLibraryServer(sentence, { query, archives, archiveFilter, rememberFn });
  }
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

function decodeXmlText(value = "") {
  return String(value)
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([\da-f]+);/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&amp;/giu, "&");
}

function xmlTagText(source, tag) {
  const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(source).match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, "iu"));
  return match?.[1] ?? "";
}

function originalPageUrl(entry) {
  const value = String(entry ?? "");
  const separator = value.indexOf("/");
  if (separator < 0) return "";
  const host = value.slice(0, separator);
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/iu.test(host)) return "";
  try {
    return new URL(`https://${value}`).toString();
  } catch {
    return "";
  }
}

export function parseKiwixSearchResults(xml, { endpoint, archives = [], archiveFilter = null } = {}) {
  const archiveByName = new Map(archives.map((archive) => [
    path.basename(archive.filename, path.extname(archive.filename)).toLowerCase(), archive.relative
  ]));
  const items = [...String(xml ?? "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)];
  return items.map(([, item]) => {
    const title = decodeXmlText(xmlTagText(item, "title")).trim();
    const rawLink = decodeXmlText(xmlTagText(item, "link")).trim();
    const description = decodeXmlText(xmlTagText(item, "description"))
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const link = rawLink && endpoint ? new URL(rawLink, endpoint) : null;
    const parts = link?.pathname.match(/^\/content\/([^/]+)\/(.+)$/u);
    const archiveId = parts?.[1] ? decodeURIComponent(parts[1]) : "";
    const entry = parts?.[2] ? decodeURIComponent(parts[2]) : "";
    const bookTitle = decodeXmlText(xmlTagText(xmlTagText(item, "book"), "title")).trim();
    return {
      title,
      link: link?.toString() ?? rawLink,
      archiveId,
      archivePath: archiveByName.get(archiveId.toLowerCase()) ?? "",
      bookTitle,
      entry,
      originalUrl: originalPageUrl(entry),
      snippet: description
    };
  }).filter((result) => (result.title || result.snippet || result.link)
    && (!archiveFilter || result.archiveId.toLowerCase() === archiveFilter));
}

async function searchZimLibraryServer(sentence, { query, archives, archiveFilter = null, rememberFn }) {
  const base = resolveConfigText("zim archive search server", { rememberFn });
  if (!base) fail(sentence, "zim search server missing", "shared ZIM library search requires zim archive search server configuration");
  let endpoint;
  try {
    endpoint = new URL("/search", base);
  } catch (error) {
    fail(sentence, "zim search server invalid", "zim archive search server must be a valid HTTP URL", { endpoint: base, error: error.message });
  }
  endpoint.searchParams.set("pattern", query);
  endpoint.searchParams.set("format", "xml");
  let response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    fail(sentence, "zim search server unavailable", `cannot query the shared ZIM library search server: ${error.message}`, { endpoint: base });
  }
  if (!response.ok) {
    fail(sentence, "zim search server defective", `shared ZIM library search returned HTTP ${response.status}`, { endpoint: endpoint.toString() });
  }
  const xml = await response.text();
  const results = parseKiwixSearchResults(xml, { endpoint: base, archives, archiveFilter });
  const output = results.length === 0
    ? "No results found in the shared ZIM archive library."
    : results.map((result) => {
      return [
        `archive: ${result.archivePath || result.bookTitle || result.archiveId}`,
        `title: ${result.title}`,
        `entry: ${result.entry || result.link}`,
        ...(result.originalUrl ? [`original: ${result.originalUrl}`] : []),
        `snippet: ${result.snippet}`
      ].join("\n");
    }).join("\n\n");
  return {
    mood: "ya",
    su: sentence?.to?.name ? { name: sentence.to.name } : (sentence?.su ?? { name: "ZIM search results" }),
    ob: { text: output },
    from: { filename: archives[0]?.filename ? path.dirname(archives[0].filename) : "world/library/archive" },
    be: "search"
  };
}

export function isClusterCompressFormat(sentence) {
  return [sentence?.as, sentence?.become, sentence?.fromstate]
    .some((value) => ["cluster-compress", "zim"].includes(stateValue(value)));
}
