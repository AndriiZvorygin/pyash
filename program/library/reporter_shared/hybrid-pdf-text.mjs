import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { requestManagedOllamaChat } from "../../runtime/gpu/managed-ollama.mjs";
import { resolveTextModel } from "../../runtime/gpu/text-model.mjs";


function normalize(value = "") {
  return String(value).replace(/[\u00a0\u2007\u202f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function wordCount(value = "") {
  return normalize(value).split(/\s+/u).filter(Boolean).length;
}

export function isPaginationOnlyPageText(value = "", page = 0, totalPages = 0) {
  const text = normalize(value);
  if (!text || !Number.isInteger(page) || page < 1) return false;
  const total = Number.isInteger(totalPages) && totalPages >= page ? totalPages : 0;
  return text === String(page)
    || text.toLowerCase() === `page ${page}`
    || (total > 0 && (
      text.toLowerCase() === `${page} of ${total}`
      || text.toLowerCase() === `page ${page} of ${total}`
    ));
}

function pageCount(pdfPath) {
  const result = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) return 0;
  return Number.parseInt(String(result.stdout || "").match(/^Pages:\s+(\d+)/mu)?.[1] || "0", 10) || 0;
}

function nativePageText(pdfPath, page) {
  const result = spawnSync("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`pdftotext page ${page} failed with exit ${result.status}`);
  return String(result.stdout || "").replace(/\f/gu, "").trim();
}

function renderedPageIsBlank(pdfPath, page) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-pdf-blank-"));
  const imageStem = path.join(tempDir, `page-${page}`);
  try {
    const rendered = spawnSync("pdftoppm", [
      "-f", String(page), "-l", String(page), "-singlefile", "-r", "72", "-gray", pdfPath, imageStem,
    ], { encoding: "utf8", timeout: 60_000 });
    const imagePath = `${imageStem}.pgm`;
    if (rendered.status !== 0 || !fs.existsSync(imagePath)) return false;
    const bytes = fs.readFileSync(imagePath);
    let offset = 0;
    const nextToken = () => {
      while (offset < bytes.length && /\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
      if (bytes[offset] === 35) {
        while (offset < bytes.length && bytes[offset] !== 10) offset += 1;
        return nextToken();
      }
      const start = offset;
      while (offset < bytes.length && !/\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
      return bytes.subarray(start, offset).toString("ascii");
    };
    if (nextToken() !== "P5") return false;
    const width = Number(nextToken());
    const height = Number(nextToken());
    const maxValue = Number(nextToken());
    while (offset < bytes.length && /\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
    if (!width || !height || !maxValue || offset >= bytes.length) return false;
    const samples = bytes.subarray(offset, offset + width * height);
    if (!samples.length) return false;
    let ink = 0;
    for (const sample of samples) if (sample < Math.min(245, maxValue - 5)) ink += 1;
    return ink / samples.length < 0.0005;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function qwenTranscribePage({ pdfPath, page, ollamaHost, timeoutMs, attempt = 1 }) {
  const fixture = String(process.env.PDF_OCR_QWEN_FIXTURE || "");
  if (fixture) {
    const parsed = JSON.parse(fixture);
    const pageFixture = parsed?.[page] ?? parsed?.[String(page)] ?? "";
    const responses = pageFixture && typeof pageFixture === "object" && Array.isArray(pageFixture.responses)
      ? pageFixture.responses
      : null;
    return String(responses ? responses[attempt - 1] ?? responses.at(-1) ?? "" : pageFixture).trim();
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-pdf-ocr-"));
  const imageStem = path.join(tempDir, `page-${page}`);
  const imagePath = `${imageStem}.png`;
  try {
    const rendered = spawnSync("pdftoppm", [
      "-f", String(page), "-l", String(page), "-singlefile", "-scale-to-x", "2200", "-scale-to-y", "-1", "-png", pdfPath, imageStem,
    ], { encoding: "utf8", timeout: 120_000 });
    if (rendered.status !== 0 || !fs.existsSync(imagePath)) {
      throw new Error(`pdftoppm page ${page} failed with exit ${rendered.status}`);
    }
    const image = fs.readFileSync(imagePath).toString("base64");
    const host = String(ollamaHost || process.env.OLLAMA_HOST || "http://mriczo:11434").replace(/\/+$/u, "");
    const response = await requestManagedOllamaChat({
      ollamaUrl: host,
      managerUrl: process.env.PYA_GPU_HOUSEKEEPER_URL || "",
      think: false,
      keepAlive: 300,
      options: { num_predict: 1200, temperature: 0 },
      messages: [{
          role: "user",
          content: [
            "Transcribe every visible word on this document page exactly.",
            "Preserve headings, numbered clauses, bullets, names, dates, and resolution wording.",
            "Do not summarize, explain, correct, or invent text.",
            "For a page that is mostly a photograph, return only legible captions, labels, or words printed in the image; do not describe the photograph.",
            "Return plain text only. If the page contains no readable words, return exactly [[BLANK PAGE]].",
            attempt > 1
              ? attempt % 2 === 0
                ? "A previous transcription attempt was empty or unusable. Reinspect the complete page at this higher resolution, including faint text, headers, footers, stamps, rotated text, and text embedded inside images."
                : "The prior visual result was rejected as incomplete. Start a fresh page transcription, checking the entire image for labels, captions, questions, and small text before returning."
              : "",
          ].filter(Boolean).join(" "),
          images: [image],
        }],
      timeoutMs,
    });
    return String(response?.message?.content || response?.response || "").trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Extract a PDF page-by-page, retaining native text and using the configured
 * text model only
 * for pages whose text layer is absent. A failed scanned-page transcription is
 * fatal so an attachment can never be silently published with trailing pages cut off.
 */
export async function extractHybridPdfText({
  pdfPath,
  textPath = "",
  ollamaHost = "",
  timeoutMs = 300_000,
  minimumNativeWords = 8,
} = {}) {
  const totalPages = pageCount(pdfPath);
  if (!totalPages) throw new Error(`could not determine PDF page count for ${pdfPath}`);

  const pages = [];
  const ocrPages = [];
  const blankPages = [];
  const paginationOnlyPages = [];
  const verifiedShortNativePages = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const nativeText = nativePageText(pdfPath, page);
    if (wordCount(nativeText) >= minimumNativeWords) {
      pages.push(nativeText);
      continue;
    }
    if (isPaginationOnlyPageText(nativeText, page, totalPages)) {
      paginationOnlyPages.push(page);
      continue;
    }
    // Test fixtures intentionally emulate OCR text on otherwise synthetic
    // blank pages (for example, a scan-only page whose pixels are supplied by
    // the fixture). Let those fixtures exercise the retry/validation path;
    // production blank pages still avoid an unnecessary model call.
    if (renderedPageIsBlank(pdfPath, page) && !process.env.PDF_OCR_QWEN_FIXTURE) {
      blankPages.push(page);
      continue;
    }
    let transcribed = "";
    let lastError = "";
    let shortNativeAgreements = 0;
    let shortNativeCandidate = "";
    let shortNativeVerifiedText = "";
    const maxAttempts = Math.max(
      3,
      Number.parseInt(String(process.env.PDF_OCR_QWEN_ATTEMPTS || "6"), 10) || 6,
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1 && !process.env.PDF_OCR_QWEN_FIXTURE) {
        const retryDelayMs = Math.max(
          250,
          Number.parseInt(String(process.env.PDF_OCR_QWEN_RETRY_DELAY_MS || "1500"), 10) || 1500,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      try {
        transcribed = await qwenTranscribePage({ pdfPath, page, ollamaHost, timeoutMs, attempt });
        if (normalize(transcribed) === "[[BLANK PAGE]]") break;
        if (wordCount(transcribed) >= 4) break;
        const normalizedNative = normalize(nativeText).toLowerCase();
        const normalizedTranscribed = normalize(transcribed).toLowerCase();
        const agreesWithNative = nativeText && (
          normalizedTranscribed === normalizedNative
          || normalizedTranscribed.startsWith(`${normalizedNative} `)
        );
        if (agreesWithNative && normalizedTranscribed === shortNativeCandidate) {
          shortNativeAgreements += 1;
          if (shortNativeAgreements >= 2) {
            shortNativeVerifiedText = transcribed;
            break;
          }
        }
        if (agreesWithNative) shortNativeCandidate = normalizedTranscribed;
        lastError = "empty or shorter than four words";
      } catch (error) {
        lastError = String(error?.message || error);
        transcribed = "";
      }
    }
    if (normalize(transcribed) === "[[BLANK PAGE]]") {
      blankPages.push(page);
      continue;
    }
    if (shortNativeAgreements >= 2) {
      pages.push(shortNativeVerifiedText || nativeText);
      verifiedShortNativePages.push(page);
      continue;
    }
    if (wordCount(transcribed) < 4) {
      throw new Error(
        `configured text model returned no usable transcription for scanned PDF page ${page} of ${totalPages}`
        + (lastError ? ` after ${maxAttempts} attempts (${lastError})` : ` after ${maxAttempts} attempts`),
      );
    }
    pages.push(transcribed);
    ocrPages.push(page);
  }

  const text = pages.join("\n\n\f\n\n").trim();
  if (textPath) fs.writeFileSync(textPath, text ? `${text}\n` : "", "utf8");
  return {
    text,
    totalPages,
    ocrPages,
    blankPages,
    paginationOnlyPages,
    verifiedShortNativePages,
    model: ocrPages.length ? resolveTextModel() : "native_text",
  };
}
