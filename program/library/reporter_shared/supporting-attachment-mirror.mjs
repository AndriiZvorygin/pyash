import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ATTACHMENT_ENDPOINT = "https://helpos.ca/api/helpos/v1/attachment-publish";

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return fallback;
  }
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function itemPrefix(item = "", index = 0) {
  return `${String(item || "").replace(/\./gu, "-")}-${Number(index) + 1}-`;
}

function contentTypeForFile(filePath = "") {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const byExtension = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv": "text/csv",
    ".txt": "text/plain",
  };
  return byExtension[ext] || "application/octet-stream";
}

function extForMeetingSourceUrl(url = "") {
  const clean = String(url || "").split("?")[0];
  if (/filestream\.ashx$/iu.test(clean)) return ".pdf";
  const ext = path.extname(path.basename(clean)).toLowerCase();
  return ext || ".bin";
}

function retainedMeetingSourceAttachments({ payloadDir, sourceAttachments = [] } = {}) {
  const explicit = Array.isArray(sourceAttachments) ? sourceAttachments : [];
  if (explicit.length) return explicit;
  const meetingDir = path.resolve(payloadDir || process.cwd(), "..");
  const meetingPath = path.join(meetingDir, "meeting.json");
  if (!fs.existsSync(meetingPath)) return [];
  const meeting = safeJsonParse(fs.readFileSync(meetingPath, "utf8"), {});
  const payload = meeting?.payload || {};
  const rows = [
    ...(Array.isArray(payload?.agenda_cover)
      ? payload.agenda_cover.map((url, index) => ({ kind: "agenda-cover", url, index }))
      : []),
    ...(Array.isArray(payload?.agenda)
      ? payload.agenda.map((url, index) => ({ kind: "agenda", url, index }))
      : []),
  ];
  return rows
    .filter((row) => /\/filestream\.ashx(?:[?#]|$)/iu.test(String(row.url || "")))
    .map((row) => ({
      item: "agenda-source",
      label: row.kind === "agenda-cover" ? "Official agenda cover" : "Official agenda package",
      url: row.url,
      local_file: path.join(
        meetingDir,
        "source",
        `${row.kind}-${String(row.index + 1).padStart(2, "0")}${extForMeetingSourceUrl(row.url)}`,
      ),
    }));
}

function attachmentDirectoryCandidates(indexPath, index = {}) {
  const indexDir = path.dirname(indexPath);
  const fromItems = (Array.isArray(index?.items) ? index.items : [])
    .map((item) => String(item?.file || "").trim())
    .filter(Boolean)
    .map((file) => path.join(path.dirname(file), "_attachments"));
  return [...new Set([
    ...fromItems,
    path.join(indexDir, "subreports", "_attachments"),
    path.join(indexDir, "_attachments"),
  ].map((value) => path.resolve(value)))];
}

function findRetainedAttachment({
  diagnostic = {},
  attachmentDirs = [],
  item = "",
  index = 0,
}) {
  const explicit = String(diagnostic?.local_file || diagnostic?.local_path || "").trim();
  if (explicit && fs.existsSync(path.resolve(explicit)) && fs.statSync(path.resolve(explicit)).isFile()) {
    return path.resolve(explicit);
  }
  const prefix = itemPrefix(item, index);
  for (const dir of attachmentDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const match = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && !entry.name.endsWith(".txt"))
      .map((entry) => path.join(dir, entry.name))
      .sort()[0];
    if (match) return match;
  }
  return "";
}

export function findSupportingAttachmentIndex({
  payloadDir,
  attachmentIndexPath = "",
} = {}) {
  const explicit = String(attachmentIndexPath || "").trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) throw new Error(`supporting attachment index not found: ${resolved}`);
    return resolved;
  }
  const base = path.resolve(payloadDir || process.cwd());
  const candidates = [
    path.join(base, "subreports.index.json"),
    path.join(base, "..", "converted", "subreports.index.json"),
    path.join(base, "..", "subreports.index.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

export function buildSupportingAttachmentMirrorPlan({
  payloadDir,
  attachmentIndexPath = "",
  sourceAttachments = [],
} = {}) {
  const indexPath = findSupportingAttachmentIndex({ payloadDir, attachmentIndexPath });
  if (!indexPath) return [];
  const index = safeJsonParse(fs.readFileSync(indexPath, "utf8"), {});
  const legacyDiagnostics = new Map(
    (Array.isArray(index?.attachment_extraction_diagnostics) ? index.attachment_extraction_diagnostics : [])
      .map((row) => [String(row?.item || ""), Array.isArray(row?.attachments) ? row.attachments : []]),
  );
  const items = Array.isArray(index?.items)
    ? index.items
    : (Array.isArray(index?.attachments_from_html) ? index.attachments_from_html : [])
      .map((row) => ({
        ...row,
        attachment_diagnostics: legacyDiagnostics.get(String(row?.item || "")) || [],
      }));
  const attachmentDirs = attachmentDirectoryCandidates(indexPath, index);
  const plan = [];
  const seenUrls = new Set();

  for (const item of items) {
    const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
    const diagnostics = Array.isArray(item?.attachment_diagnostics) ? item.attachment_diagnostics : [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index] || {};
      const sourceUrl = String(attachment?.url || "").trim();
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
      const localPath = findRetainedAttachment({
        diagnostic: diagnostics[index] || {},
        attachmentDirs,
        item: item?.item,
        index,
      });
      if (!localPath) {
        throw new Error(
          `supporting attachment has no retained local copy: item=${String(item?.item || "")} url=${sourceUrl}`,
        );
      }
      const bytes = fs.readFileSync(localPath);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      plan.push({
        item: String(item?.item || ""),
        label: normalizeText(attachment?.label || path.basename(localPath)),
        sourceUrl,
        localPath,
        filename: path.basename(localPath),
        contentType: contentTypeForFile(localPath),
        sizeBytes: bytes.length,
        sha256,
      });
      seenUrls.add(sourceUrl);
    }
  }
  for (const source of retainedMeetingSourceAttachments({ payloadDir, sourceAttachments })) {
    const sourceUrl = String(source?.sourceUrl || source?.url || "").trim();
    if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
    const localPath = path.resolve(String(source?.localPath || source?.local_file || ""));
    if (!localPath || !fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
      throw new Error(`agenda source document has no retained local copy: url=${sourceUrl}`);
    }
    const bytes = fs.readFileSync(localPath);
    plan.push({
      item: String(source?.item || "agenda-source"),
      label: normalizeText(source?.label || path.basename(localPath)),
      sourceUrl,
      localPath,
      filename: path.basename(localPath),
      contentType: contentTypeForFile(localPath),
      sizeBytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
    seenUrls.add(sourceUrl);
  }
  return plan;
}

export function rewriteSupportingAttachmentUrls(text = "", mapping = new Map()) {
  let output = String(text || "");
  const entries = mapping instanceof Map ? [...mapping.entries()] : Object.entries(mapping || {});
  for (const [sourceUrl, mirrorUrl] of entries) {
    const source = String(sourceUrl || "").trim();
    const mirror = String(mirrorUrl || "").trim();
    if (!source || !mirror) continue;
    output = output.split(source).join(mirror);
    output = output.split(source.replace(/&/gu, "&amp;")).join(mirror.replace(/&/gu, "&amp;"));
  }
  return output;
}

export function findUnmirroredSupportingAttachmentUrls(...texts) {
  const urls = new Set();
  for (const text of texts.flat()) {
    const normalized = String(text || "").replace(/&amp;/gu, "&");
    for (const match of normalized.matchAll(/https?:\/\/[^\s<>"')\]]+/giu)) {
      const url = String(match[0] || "").replace(/[.,;:!?]+$/gu, "");
      if (/\/filestream\.ashx(?:[?#]|$)/iu.test(url)) urls.add(url);
    }
  }
  return [...urls].sort();
}

function mirrorUrlFromResponse(parsed = {}) {
  return String(
    parsed?.mirror_url
    || parsed?.attachment_url
    || parsed?.url
    || parsed?.attachment?.url
    || "",
  ).trim();
}

export async function mirrorSupportingAttachments({
  payloadDir,
  attachmentIndexPath = "",
  sourceAttachments = [],
  endpoint = DEFAULT_ATTACHMENT_ENDPOINT,
  token = "",
  jurisdiction = "",
  body = "",
  dateIso = "",
  responsePath = "",
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  const plan = buildSupportingAttachmentMirrorPlan({ payloadDir, attachmentIndexPath, sourceAttachments });
  if (!plan.length) return { plan, mapping: new Map(), responses: [] };
  if (!String(token || "").trim()) throw new Error("attachment mirror auth token is required");

  const resolvedResponsePath = responsePath
    ? path.resolve(responsePath)
    : path.join(path.resolve(payloadDir), "supporting-attachments.mirror.response.json");
  const cached = fs.existsSync(resolvedResponsePath)
    ? safeJsonParse(fs.readFileSync(resolvedResponsePath, "utf8"), {})
    : {};
  const cachedRows = Array.isArray(cached?.attachments) ? cached.attachments : [];
  const cachedByHash = new Map(
    cachedRows
      .filter((row) => row?.sha256 && row?.mirror_url)
      .map((row) => [String(row.sha256), row]),
  );
  const responses = [];
  const mapping = new Map();

  for (const entry of plan) {
    const cachedRow = cachedByHash.get(entry.sha256);
    if (cachedRow) {
      mapping.set(entry.sourceUrl, String(cachedRow.mirror_url));
      responses.push({ ...entry, mirror_url: String(cachedRow.mirror_url), cached: true });
      continue;
    }
    const metadata = {
      jurisdiction: String(jurisdiction || ""),
      body: String(body || ""),
      date_iso: String(dateIso || ""),
      item: entry.item,
      label: entry.label,
      original_url: entry.sourceUrl,
      filename: entry.filename,
      content_type: entry.contentType,
      size_bytes: entry.sizeBytes,
      sha256: entry.sha256,
      idempotency_key: `attachment-${entry.sha256}`,
    };
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append(
      "attachment",
      new Blob([fs.readFileSync(entry.localPath)], { type: entry.contentType }),
      entry.filename,
    );
    log(`[attachment-mirror] uploading item=${entry.item} sha256=${entry.sha256.slice(0, 12)} file=${entry.filename}`);
    const response = await fetchImpl(String(endpoint || DEFAULT_ATTACHMENT_ENDPOINT), {
      method: "POST",
      headers: { Authorization: `Bearer ${String(token).trim()}` },
      body: form,
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    const raw = await response.text();
    const parsed = safeJsonParse(raw, null);
    if (!response.ok) {
      throw new Error(
        `attachment mirror failed (${response.status}) for ${entry.filename}: ${String(raw).slice(0, 600)}`,
      );
    }
    const mirrorUrl = mirrorUrlFromResponse(parsed || {});
    if (!mirrorUrl) {
      throw new Error(`attachment mirror response missing mirror_url for ${entry.filename}`);
    }
    mapping.set(entry.sourceUrl, mirrorUrl);
    responses.push({ ...entry, mirror_url: mirrorUrl, cached: false });
    fs.mkdirSync(path.dirname(resolvedResponsePath), { recursive: true });
    fs.writeFileSync(
      resolvedResponsePath,
      `${JSON.stringify({ schema_version: "supporting_attachment_mirror_v1", attachments: responses }, null, 2)}\n`,
      "utf8",
    );
  }
  if (mapping.size !== plan.length) {
    throw new Error(`attachment mirror incomplete: mirrored=${mapping.size} planned=${plan.length}`);
  }
  return { plan, mapping, responses, responsePath: resolvedResponsePath };
}

export { DEFAULT_ATTACHMENT_ENDPOINT };
