#!/usr/bin/env node
// Harvest Wiktionary definitions for Pyac concepts WordNet does not index.
//
// Wiktionary is the second reference dataset, alongside WordNet. It is already
// mounted on the Kiwix host, so citing it costs the repository no bytes: an
// entry is identified by its page name and the snapshot release, and the URL is
// derived from those two. That keeps the volume free of downloaded corpora
// while still giving every term a resolvable citation.
//
//   https://zim.zvorygin.ca/content/wiktionary_en_all_nopic_2026-08/<entry>
//
// The definition is the part-of-speech line Wiktionary tags with the domain
// (`(grammar)`, `(linguistics)`, `(computing)`). Untagged senses are prose about
// the word, not a definition of the concept, so they are skipped.

import { execFileSync } from "node:child_process";

export const WIKTIONARY_RELEASE = "en_all_nopic_2026-08";
export const WIKTIONARY_ARCHIVE = `wiktionary_${WIKTIONARY_RELEASE}.zim`;
export const WIKTIONARY_SITE = "https://zim.zvorygin.ca";

const DOMAIN = /^\((grammar|linguistics|computing|programming|morphology|phonetics|phonology|syntax)\)/i;

/** The page URL for a Wiktionary entry name. */
export function wiktionaryUrl(entry) {
  return `${WIKTIONARY_SITE}/content/wiktionary_${WIKTIONARY_RELEASE}/${entry}`;
}

/**
 * Read one entry's raw article text from the mounted archive.
 *
 * Runs over ssh because the archive lives on the Kiwix host, not in this
 * checkout. Returns null when the host or tool is unavailable, so a build on a
 * machine without the library degrades to "no Wiktionary links" rather than
 * failing.
 */
function readArticle(entry, { host = "zvorygin", timeout = 60_000 } = {}) {
  const script = [
    "cd /srv/search/archive",
    `zimdump show --url=${entry} ${WIKTIONARY_ARCHIVE} 2>/dev/null`,
  ].join(" && ");
  try {
    return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, script], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** Strip markup and keep the domain-tagged definition line. */
export function extractDefinition(article) {
  if (typeof article !== "string" || !article.trim()) return null;
  const stripped = article
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(mw-parser-output|https?:\/\/|\.?[#@{}]|\*)/.test(line));
  for (const line of stripped) {
    if (!DOMAIN.test(line)) continue;
    const text = line.replace(/^\([^)]*\)\s*:?\s*/i, "").trim();
    if (text) return text;
  }
  return null;
}

/**
 * Definitions for a list of entry names.
 *
 * Returns `{ entry, definition, url }` for the entries that resolve. A miss is
 * recorded as `{ entry, definition: null }` so the caller can report coverage
 * rather than silently dropping terms.
 */
export function harvestWiktionary(entries, options = {}) {
  return entries.map((entry) => {
    const article = readArticle(entry, options);
    const definition = extractDefinition(article);
    return {
      entry,
      definition,
      url: definition ? wiktionaryUrl(entry) : null,
    };
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const entries = process.argv.slice(2);
  if (!entries.length) {
    console.error("Usage: node command/wiktionary_harvest.mjs <entry> [entry ...]");
    process.exit(1);
  }
  const rows = harvestWiktionary(entries);
  const found = rows.filter((row) => row.definition).length;
  for (const row of rows) {
    console.log(`${row.definition ? "hit " : "miss"} ${row.entry}`);
    if (row.definition) console.log(`     ${row.definition}`);
  }
  console.error(`${found}/${rows.length} entries have a domain definition`);
}
