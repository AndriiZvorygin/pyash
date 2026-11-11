import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";

const inputRoot = path.resolve(process.argv[2] ?? "");
const outputRoot = path.resolve("sino-pyash/sources/asjp-v21");

if (!process.argv[2]) {
  throw new Error("Pass the extracted ASJP v21 dataset directory as the first argument.");
}

const selectedLists = new Map([
  ["MANDARIN", ["Sinitic baseline", "Mandarin provides the direct modern Sinitic comparison."]],
  ["TIBETAN_CENTRAL", ["Sino-Tibetan comparison", "Central Tibetan provides a regional spoken-language sample."]],
  ["TIBETAN_LHASA", ["Sino-Tibetan comparison", "Lhasa Tibetan provides a second spoken-language sample."]],
  ["TIBETAN_WRITTEN", ["Sino-Tibetan comparison", "Written Tibetan is retained separately from spoken Tibetan varieties."]],
  ["BURMESE", ["Sino-Tibetan comparison", "Burmese adds a second non-Sinitic Sino-Tibetan branch sample."]],
  ["EIGHTEENTH_CENTURY_KET", ["Yeniseian comparison", "An eighteenth-century Ket list is retained with its historical source label."]],
  ["KET", ["Yeniseian comparison", "A Ket list from a separate source is retained as a distinct record."]],
  ["KET_2", ["Yeniseian comparison", "Ket is the only surviving Yeniseian language; this is the dataset's broadest selected Ket list."]],
  ["YUGH", ["Yeniseian comparison", "Yugh adds a distinct, now-extinct Yeniseian variety."]],
  ["YUGH_RECENT", ["Yeniseian comparison", "A second Yugh source is retained separately to preserve its provenance."]],
  ["ARIN", ["Yeniseian comparison", "Arin is an extinct Yeniseian variety; the available list is incomplete."]],
  ["ASSAN", ["Yeniseian comparison", "Assan is an extinct Yeniseian variety; the available list is incomplete."]],
  ["KOTT", ["Yeniseian comparison", "Kott-Assan is an extinct Yeniseian variety; the available list is incomplete."]],
  ["PUMPOKOL", ["Yeniseian comparison", "Pumpokol is an extinct Yeniseian variety; the available list is incomplete."]],
  ["CHECHEN_2", ["North Caucasian comparison", "Chechen samples the Nakh branch of North Caucasian."]],
  ["ABKHAZ_2", ["North Caucasian comparison", "Abkhaz samples the Northwest Caucasian branch."]],
  ["LEZGIAN", ["North Caucasian comparison", "Lezgian samples a Daghestanian branch distinct from Nakh and Northwest Caucasian."]],
  ["BURUSHASKI_2", ["Dene-Caucasian proposal comparison", "Burushaski occurs in the expanded Dene-Caucasian proposal; its proposed relationship is disputed."]],
  ["BASQUE_2", ["Dene-Caucasian proposal comparison", "Basque occurs in the expanded Dene-Caucasian proposal; its proposed relationship is disputed."]],
  ["NAVAJO", ["Dene-Caucasian proposal comparison", "Navajo samples Na-Dene, included only in the expanded Dene-Caucasian proposal."]],
  ["EYAK", ["Dene-Caucasian proposal comparison", "Eyak samples Na-Dene, included only in the expanded Dene-Caucasian proposal."]],
  ["TLINGIT", ["Dene-Caucasian proposal comparison", "Tlingit samples Na-Dene, included only in the expanded Dene-Caucasian proposal."]],
  ["GEORGIAN_2", ["Kartvelian comparison control", "Kartvelian is a neighboring-family comparison and is excluded from Sino-Caucasian and Dene-Caucasian."]],
  ["FINNISH_2", ["Uralic comparison", "Finnish supplies a Uralic sample for the separate Borean/Sino-Uralic hypothesis discussion."]],
  ["HUNGARIAN_2", ["Uralic comparison", "Hungarian adds a second Uralic sample; it is not treated as a Chinese descendant."]],
]);

function parseCsvRecord(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote; expected one physical row per record.");
  fields.push(field);
  return fields;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(fields) {
  return `${fields.map(csvField).join(",")}\n`;
}

async function readCsvTable(filename) {
  const input = fs.readFileSync(path.join(inputRoot, "cldf", filename), "utf8");
  const lines = input.trimEnd().split(/\r?\n/);
  const headers = parseCsvRecord(lines.shift());
  return { headers, records: lines.map(line => parseCsvRecord(line)) };
}

function toObject(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

async function writeCsv(filename, headers, records) {
  const output = createWriteStream(path.join(outputRoot, filename));
  output.write(csvRow(headers));
  for (const record of records) output.write(csvRow(record));
  output.end();
  await once(output, "finish");
}

fs.mkdirSync(outputRoot, { recursive: true });

const languageTable = await readCsvTable("languages.csv");
const languageRows = languageTable.records
  .map(values => toObject(languageTable.headers, values))
  .filter(language => selectedLists.has(language.ID));
if (languageRows.length !== selectedLists.size) {
  const found = new Set(languageRows.map(language => language.ID));
  throw new Error(`Selected ASJP lists missing: ${[...selectedLists.keys()].filter(id => !found.has(id)).join(", ")}`);
}

const languageById = new Map(languageRows.map(language => [language.ID, language]));
const outputLanguageHeaders = [...languageTable.headers, "Comparison_group", "Selection_reason"];
await writeCsv("languages.csv", outputLanguageHeaders, languageRows.map(language => [
  ...languageTable.headers.map(header => language[header]),
  selectedLists.get(language.ID)[0],
  selectedLists.get(language.ID)[1],
]));

const parameterTable = await readCsvTable("parameters.csv");
const formsOutput = createWriteStream(path.join(outputRoot, "wordlists.csv"));
formsOutput.write(csvRow([
  ...["ID", "Local_ID", "Language_ID", "Parameter_ID", "Value", "Form", "Segments", "Comment", "Source", "Cognacy", "Loan", "Graphemes", "Profile", "gloss_in_source"],
  "Language_name", "ISO639P3code", "Family", "Comparison_group",
]));
const sourceIds = new Set();
const parameterIds = new Set();
const formsByLanguage = new Map();
const conceptsByLanguage = new Map();
let formCount = 0;
const formInput = readline.createInterface({
  input: createReadStream(path.join(inputRoot, "cldf", "forms.csv"), { encoding: "utf8" }),
  crlfDelay: Infinity,
});
let formHeaders;
for await (const line of formInput) {
  if (!formHeaders) {
    formHeaders = parseCsvRecord(line);
    continue;
  }
  const values = parseCsvRecord(line);
  const form = toObject(formHeaders, values);
  const language = languageById.get(form.Language_ID);
  if (!language) continue;
  for (const id of form.Source.split(/[;\s]+/).filter(Boolean)) sourceIds.add(id);
  parameterIds.add(form.Parameter_ID);
  formsByLanguage.set(form.Language_ID, (formsByLanguage.get(form.Language_ID) ?? 0) + 1);
  if (!conceptsByLanguage.has(form.Language_ID)) conceptsByLanguage.set(form.Language_ID, new Set());
  conceptsByLanguage.get(form.Language_ID).add(form.Parameter_ID);
  formsOutput.write(csvRow([
    ...formHeaders.map(header => form[header]),
    language.Glottolog_Name || language.Name,
    language.ISO639P3code,
    language.Family,
    selectedLists.get(language.ID)[0],
  ]));
  formCount += 1;
}
formsOutput.end();
await once(formsOutput, "finish");
if (parameterIds.size !== 100) throw new Error(`Expected all 100 concepts; found ${parameterIds.size}.`);
const emptyLists = [...selectedLists.keys()].filter(id => !formsByLanguage.has(id));
if (emptyLists.length) throw new Error(`Selected lists have no forms: ${emptyLists.join(", ")}`);

const parameterHeaders = parameterTable.headers;
const selectedParameters = parameterTable.records
  .map(values => toObject(parameterHeaders, values))
  .filter(parameter => parameterIds.has(parameter.ID));
await writeCsv("parameters.csv", parameterHeaders, selectedParameters.map(parameter => parameterHeaders.map(header => parameter[header])));

const bibText = fs.readFileSync(path.join(inputRoot, "cldf", "sources.bib"), "utf8");
const bibById = new Map();
const bibStarts = [...bibText.matchAll(/^@\w+\s*\{\s*([^,]+),/gm)];
for (let index = 0; index < bibStarts.length; index += 1) {
  const start = bibStarts[index].index;
  const end = bibStarts[index + 1]?.index ?? bibText.length;
  bibById.set(bibStarts[index][1].trim(), bibText.slice(start, end).trim());
}
const missingSources = [...sourceIds].filter(id => !bibById.has(id));
if (missingSources.length) throw new Error(`Missing bibliography entries: ${missingSources.join(", ")}`);
fs.writeFileSync(path.join(outputRoot, "sources.bib"), [...sourceIds].sort().map(id => bibById.get(id)).join("\n\n") + "\n");

fs.copyFileSync(path.join(inputRoot, "LICENSE"), path.join(outputRoot, "LICENSE"));
fs.copyFileSync(path.join(inputRoot, "README.md"), path.join(outputRoot, "UPSTREAM-README.md"));
fs.copyFileSync(path.join(inputRoot, "TRANSCRIPTION.md"), path.join(outputRoot, "TRANSCRIPTION.md"));
console.log(`Extracted ${languageRows.length} ASJP varieties, ${formCount} forms across ${parameterIds.size} concepts, and ${sourceIds.size} cited sources from ASJP v21.`);
for (const id of selectedLists.keys()) {
  console.log(`${id}: ${formsByLanguage.get(id)} forms, ${conceptsByLanguage.get(id).size} concepts`);
}
