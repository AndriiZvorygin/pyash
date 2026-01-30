import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

function normalizeLinesFromText(text) {
  return splitSentences(text, { includeThen: true })
    .map(line => line.trim())
    .filter(Boolean);
}

function mapDefLines(name, entries) {
  const lines = [];
  lines.push(sentenceToPyash({ su: { name }, be: "json map", mood: "def" }));
  for (const entry of entries) {
    lines.push(sentenceToPyash(entry));
  }
  lines.push(sentenceToPyash({ su: { name }, mood: "prah" }));
  return lines;
}

function labelFromMapName(name) {
  const match = /^(.*)\s+(request|response|empty-response|error)\s+(\d+)$/.exec(name);
  if (!match) return null;
  return { mind: match[1], label: match[2], count: Number(match[3]) };
}

function parseSentence(line) {
  try {
    return parse(line);
  } catch {
    return null;
  }
}

function pickToolName(sentence) {
  const evoked = sentence?.ob?.la;
  if (evoked?.be) return evoked.be;
  if (evoked?.su?.name) return evoked.su.name;
  return sentence?.su?.name ?? "tool";
}

function artifactKindFromLocator(locator) {
  if (!locator) return "file";
  const ext = path.extname(locator);
  if (!ext) return "file";
  return ext.replace(/^\./, "");
}

function originSentenceFromName(name) {
  if (!name) return null;
  return { su: { name }, be: "sentence", mood: "ya" };
}

export async function extractReport({ runId = "run", runRoot, lines } = {}) {
  let runText = "";
  let parsedLines = null;

  if (Array.isArray(lines)) {
    parsedLines = lines.map(line => String(line ?? "")).filter(Boolean);
  } else if (typeof lines === "string") {
    parsedLines = normalizeLinesFromText(lines);
  } else {
    const resolvedRoot = runRoot ? path.resolve(runRoot) : process.cwd();
    const newspaperPath = path.resolve(resolvedRoot, "newspaper", `${runId}.pya`);
    runText = await fs.readFile(newspaperPath, "utf8");
    parsedLines = normalizeLinesFromText(runText);
  }

  const platformDefs = new Map();
  const platformOutcomes = [];
  const mindCalls = [];
  const toolCalls = [];
  const failures = [];
  const artifacts = [];
  let runTime = "";
  let runRootValue = "";
  let runIdValue = runId;

  let platformOrder = 0;
  let mindOrder = 0;
  let toolOrder = 0;
  let failureOrder = 0;
  let artifactOrder = 0;

  for (const line of parsedLines) {
    const sentence = parseSentence(line);
    if (!sentence) continue;

    if (sentence.be === "run" && sentence.su?.name) {
      runIdValue = sentence.su.name;
      runTime = sentence.since?.name ?? sentence.since?.text ?? runTime;
      continue;
    }

    if (sentence.be === "run root" && sentence.ob?.filename) {
      runRootValue = sentence.ob.filename;
      continue;
    }

    if (sentence.be === "platform" && sentence.mood === "ya") {
      const platformName = sentence.su?.name;
      const action = sentence.ob?.la;
      if (platformName && action) platformDefs.set(platformName, action);
      continue;
    }

    if (sentence.be === "checkpoint" && sentence.mood === "ya") {
      const platformName = sentence.su?.name;
      const resultSentence = sentence.to?.la ?? null;
      if (!platformName || !resultSentence) continue;
      platformOrder += 1;
      platformOutcomes.push({
        platformName,
        order: platformOrder,
        resultSentence,
        status: resultSentence?.be === "error" && resultSentence?.mood === "ya" ? "error" : "ok"
      });
      continue;
    }

    if (sentence.be === "json map" && sentence.mood === "def" && sentence.su?.name) {
      const info = labelFromMapName(sentence.su.name);
      if (info) {
        mindOrder += 1;
        mindCalls.push({
          mindName: info.mind,
          label: info.label,
          mapName: sentence.su.name,
          order: mindOrder
        });
      }
      continue;
    }

    if (sentence.be === "tool" && sentence.mood === "ya") {
      toolOrder += 1;
      toolCalls.push({
        toolName: pickToolName(sentence),
        order: toolOrder,
        eventSentence: sentence
      });
      continue;
    }

    if (sentence.be === "error" && sentence.mood === "ya") {
      failureOrder += 1;
      failures.push({
        errorName: sentence.su?.name ?? "error",
        order: failureOrder,
        errorSentence: sentence
      });
      continue;
    }

    if (sentence.be === "artifact" && sentence.mood === "ya") {
      artifactOrder += 1;
      const locator = sentence.to?.filename ?? sentence.ob?.text ?? "";
      artifacts.push({
        id: sentence.fromtext?.text ?? sentence.su?.name ?? "",
        kind: artifactKindFromLocator(locator),
        order: artifactOrder,
        origin: originSentenceFromName(sentence.ob?.name)
      });
      continue;
    }
  }

  platformOutcomes.sort((a, b) => {
    if (a.platformName === b.platformName) return a.order - b.order;
    return a.platformName.localeCompare(b.platformName);
  });

  const reportLines = [];

  reportLines.push(...mapDefLines("report header", [
    { su: { name: "run id" }, ob: { text: String(runIdValue ?? "") }, mood: "ya" },
    { su: { name: "run time" }, ob: { text: String(runTime ?? "") }, mood: "ya" },
    { su: { name: "run root" }, ob: { filename: String(runRootValue ?? "") }, mood: "ya" }
  ]));

  for (let i = 0; i < platformOutcomes.length; i += 1) {
    const entry = platformOutcomes[i];
    const action = platformDefs.get(entry.platformName) ?? entry.resultSentence;
    reportLines.push(...mapDefLines(`platform outcome ${i + 1}`, [
      { su: { name: "platform name" }, ob: { name: entry.platformName }, mood: "ya" },
      { su: { name: "platform order" }, ob: { num: entry.order }, mood: "ya" },
      { su: { name: "platform activity" }, ob: { la: action }, mood: "ya" },
      { su: { name: "platform result" }, ob: { la: entry.resultSentence }, mood: "ya" },
      { su: { name: "platform status" }, ob: { text: entry.status }, mood: "ya" }
    ]));
  }

  for (let i = 0; i < mindCalls.length; i += 1) {
    const entry = mindCalls[i];
    reportLines.push(...mapDefLines(`mind call ${i + 1}`, [
      { su: { name: "mind name" }, ob: { name: entry.mindName }, mood: "ya" },
      { su: { name: "mind label" }, ob: { text: entry.label }, mood: "ya" },
      { su: { name: "mind map" }, ob: { name: entry.mapName }, mood: "ya" },
      { su: { name: "mind order" }, ob: { num: entry.order }, mood: "ya" }
    ]));
  }

  for (let i = 0; i < toolCalls.length; i += 1) {
    const entry = toolCalls[i];
    reportLines.push(...mapDefLines(`tool call ${i + 1}`, [
      { su: { name: "tool name" }, ob: { name: entry.toolName }, mood: "ya" },
      { su: { name: "tool order" }, ob: { num: entry.order }, mood: "ya" },
      { su: { name: "tool event" }, ob: { la: entry.eventSentence }, mood: "ya" }
    ]));
  }

  for (let i = 0; i < failures.length; i += 1) {
    const entry = failures[i];
    reportLines.push(...mapDefLines(`failure ${i + 1}`, [
      { su: { name: "error name" }, ob: { name: entry.errorName }, mood: "ya" },
      { su: { name: "error sentence" }, ob: { la: entry.errorSentence }, mood: "ya" },
      { su: { name: "error order" }, ob: { num: entry.order }, mood: "ya" }
    ]));
  }

  for (let i = 0; i < artifacts.length; i += 1) {
    const entry = artifacts[i];
    const lines = [
      { su: { name: "artifact id" }, ob: { text: entry.id }, mood: "ya" },
      { su: { name: "artifact kind" }, ob: { text: entry.kind }, mood: "ya" },
      { su: { name: "artifact order" }, ob: { num: entry.order }, mood: "ya" }
    ];
    if (entry.origin) {
      lines.splice(2, 0, { su: { name: "artifact origin" }, ob: { la: entry.origin }, mood: "ya" });
    }
    reportLines.push(...mapDefLines(`artifact entry ${i + 1}`, lines));
  }

  reportLines.push(sentenceToPyash({ su: { name: "report end" }, be: "report", mood: "ya" }));
  return `${reportLines.join("\n")}\n`;
}
