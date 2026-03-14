#!/usr/bin/env node
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

function usage() {
  return "usage: node command/extract_readability.mjs <input-html> [output] --kind <html|text>";
}

function parseArgs(argv) {
  const args = [...argv];
  const input = args.shift();
  if (!input) throw new Error(usage());
  let output = null;
  let kind = "html";
  while (args.length) {
    const part = args.shift();
    if (part === "--kind") {
      kind = String(args.shift() ?? "").trim().toLowerCase();
      continue;
    }
    if (!output) {
      output = part;
      continue;
    }
    throw new Error(usage());
  }
  if (kind !== "html" && kind !== "text") {
    throw new Error(`unsupported kind: ${kind}`);
  }
  return { input, output, kind };
}

function extractArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document.cloneNode(true);
  const article = new Readability(doc).parse();
  if (!article) {
    throw new Error("readability defective: no article extracted");
  }
  const text = String(article.textContent ?? "").replace(/\r\n?/gu, "\n").trim();
  const contentHtml = String(article.content ?? "").replace(/\r\n?/gu, "\n").trim();
  if (!text) {
    throw new Error("readability defective: empty article text");
  }
  return {
    title: article.title ?? "",
    byline: article.byline ?? "",
    excerpt: article.excerpt ?? "",
    length: Number(article.length ?? text.length ?? 0),
    contentHtml,
    text
  };
}

async function main() {
  const { input, output, kind } = parseArgs(process.argv.slice(2));
  const html = await fs.readFile(input, "utf8");
  const article = extractArticle(html, pathToFileURL(input).href);
  const rendered = kind === "text" ? article.text : article.contentHtml;
  if (output) {
    await fs.writeFile(output, rendered, "utf8");
    return;
  }
  process.stdout.write(rendered);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message ?? err ?? "readability defective")}\n`);
  process.exit(1);
});
