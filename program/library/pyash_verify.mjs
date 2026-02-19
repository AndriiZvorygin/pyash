import { parse as parseStrict } from "../understand/parse_tokens.mjs";
import { parse } from "../understand/index.mjs";
import { MOODS } from "./grammar/keywords.mjs";
import { splitSentencesWithLines } from "./sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

const ALLOWED_MOODS = new Set([...MOODS, "then"]);

function issue({ line, code, message }) {
  return {
    line: Number.isFinite(line) ? line : null,
    at: null,
    code: String(code || "verify_defective"),
    message: String(message || "verify defective")
  };
}

function normalizeSourceText(sourceText) {
  return String(sourceText ?? "").replace(/\r\n/g, "\n");
}

export function verifyPyashText(sourceText, { source = "" } = {}) {
  const text = normalizeSourceText(sourceText);
  const entries = splitSentencesWithLines(text, { includeThen: true });
  const issues = [];
  let sentenceCount = 0;

  for (const entry of entries) {
    const line = Number(entry?.line ?? 0) || null;
    const sentenceText = String(entry?.text ?? "").trim();
    if (!sentenceText || sentenceText.startsWith("#")) continue;
    sentenceCount += 1;

    let strictParsed = null;
    try {
      strictParsed = parseStrict(sentenceText);
    } catch (err) {
      issues.push(issue({
        line,
        code: "parse_strict_defective",
        message: `strict parse failed: ${err?.message ?? "unknown error"}`
      }));
      continue;
    }

    if (!strictParsed || !ALLOWED_MOODS.has(String(strictParsed.mood ?? ""))) {
      issues.push(issue({
        line,
        code: "mood_defective",
        message: "sentence must end with a valid mood token"
      }));
      continue;
    }

    let parsed = null;
    try {
      parsed = parse(sentenceText);
    } catch (err) {
      issues.push(issue({
        line,
        code: "parse_defective",
        message: `parse failed: ${err?.message ?? "unknown error"}`
      }));
      continue;
    }

    const strictCanonical = sentenceToPyash(strictParsed);
    const canonical = sentenceToPyash(parsed);
    if (strictCanonical !== canonical) {
      issues.push(issue({
        line,
        code: "portable_defective",
        message: "sentence is not portable canonical pyash"
      }));
      continue;
    }

    try {
      const roundTrip = parse(canonical);
      const roundTripCanonical = sentenceToPyash(roundTrip);
      if (roundTripCanonical !== canonical) {
        issues.push(issue({
          line,
          code: "roundtrip_defective",
          message: "sentence is not stable in canonical round-trip"
        }));
      }
    } catch (err) {
      issues.push(issue({
        line,
        code: "roundtrip_parse_defective",
        message: `canonical parse failed: ${err?.message ?? "unknown error"}`
      }));
    }
  }

  return {
    ok: issues.length === 0,
    source: String(source || ""),
    sentenceCount,
    issueCount: issues.length,
    issues
  };
}

export function buildVerifyOutcomeSeries(report, { inlineSource = "inline://text" } = {}) {
  const source = String(report?.source || "").trim() || inlineSource;
  const errors = (Array.isArray(report?.issues) ? report.issues : []).map((row) => {
    const sentence = {
      mood: "ya",
      su: { name: "verify defective" },
      ob: { text: `${String(row?.code ?? "verify_defective")}: ${String(row?.message ?? "verify defective")}` },
      from: { name: "verify" },
      be: "error"
    };
    if (Number.isFinite(row?.line)) sentence.by = { num: row.line };
    if (Number.isFinite(row?.at)) sentence.at = { num: row.at };
    return sentence;
  });
  return {
    mood: "ya",
    su: { name: "verify produce" },
    exactly: { num: Number(report?.issueCount ?? errors.length) || 0 },
    from: { filename: source },
    atmost: { num: Number(report?.sentenceCount ?? 0) || 0 },
    vyah: { ve: { type: "name", values: [report?.ok ? "success" : "fail"] } },
    be: "series",
    ob: { series: errors }
  };
}

export function renderVerifyOutcomeSeriesLines(seriesSentence) {
  const header = {
    ...seriesSentence,
    mood: "def"
  };
  delete header.ob;
  const lines = [sentenceToPyash(header)];
  const items = Array.isArray(seriesSentence?.ob?.series) ? seriesSentence.ob.series : [];
  for (const sentence of items) {
    lines.push(sentenceToPyash(sentence));
  }
  lines.push("prah");
  return lines;
}
