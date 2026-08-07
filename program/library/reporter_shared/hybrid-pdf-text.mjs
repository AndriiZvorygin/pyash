import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MODEL = "qwen3.5:9b";

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
      "-f", String(page), "-l", String(page), "-singlefile", "-r", String(180 + ((attempt - 1) * 40)), "-png", pdfPath, imageStem,
    ], { encoding: "utf8", timeout: 120_000 });
    if (rendered.status !== 0 || !fs.existsSync(imagePath)) {
      throw new Error(`pdftoppm page ${page} failed with exit ${rendered.status}`);
    }
    const image = fs.readFileSync(imagePath).toString("base64");
    const host = String(ollamaHost || process.env.OLLAMA_HOST || "http://mriczo:11434").replace(/\/+$/u, "");
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: false,
        keep_alive: 300,
        options: { num_predict: 4000, temperature: 0 },
        messages: [{
          role: "user",
          content: [
            "Transcribe every visible word on this document page exactly.",
            "Preserve headings, numbered clauses, bullets, names, dates, and resolution wording.",
            "Do not summarize, explain, correct, or invent text.",
            "Return plain text only. If the page contains no readable words, return exactly [[BLANK PAGE]].",
            attempt > 1
              ? "A previous transcription attempt was empty or unusable. Inspect the complete page again at this higher resolution, including faint text, headers, footers, stamps, and rotated text."
              : "",
          ].filter(Boolean).join(" "),
          images: [image],
        }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`qwen PDF OCR HTTP ${response.status}`);
    const payload = await response.json();
    return String(payload?.message?.content || "").trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Extract a PDF page-by-page, retaining native text and using qwen3.5:9b only
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
    let transcribed = "";
    let lastError = "";
    let shortNativeAgreements = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        transcribed = await qwenTranscribePage({ pdfPath, page, ollamaHost, timeoutMs, attempt });
        if (normalize(transcribed) === "[[BLANK PAGE]]") break;
        if (wordCount(transcribed) >= 4) break;
        if (nativeText
          && normalize(transcribed).toLowerCase() === normalize(nativeText).toLowerCase()) {
          shortNativeAgreements += 1;
          if (shortNativeAgreements >= 2) break;
        }
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
      pages.push(nativeText);
      verifiedShortNativePages.push(page);
      continue;
    }
    if (wordCount(transcribed) < 4) {
      throw new Error(
        `qwen3.5:9b returned no usable transcription for scanned PDF page ${page} of ${totalPages}`
        + (lastError ? ` after 3 attempts (${lastError})` : " after 3 attempts"),
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
    model: ocrPages.length ? MODEL : "native_text",
  };
}
