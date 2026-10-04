import { spawn } from "node:child_process";

function rounded(value) { return Math.round((Number(value) || 0) * 1e6) / 1e6; }

export function printSettingsFromArgs(args = []) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    let value = "";
    if (args[index] === "-o") value = String(args[++index] || "");
    else if (String(args[index]).startsWith("-o")) value = String(args[index]).slice(2);
    else continue;
    const equal = value.indexOf("=");
    options[(equal < 0 ? value : value.slice(0, equal)).toLowerCase()] = equal < 0 ? "true" : value.slice(equal + 1);
  }
  return {
    media: options.media || options.pagesize || "Letter",
    sides: options.sides || "one-sided",
    numberUp: Math.max(1, Number.parseInt(options["number-up"] || "1", 10) || 1),
    colorMode: options["print-color-mode"] || options.colormodel || options.ink || "color"
  };
}

export function calculatePrintMetrics({ documentPages = 0, copies = 1, numberUp = 1, sides = "one-sided" } = {}) {
  const pages = Math.max(0, Number.parseInt(documentPages, 10) || 0);
  const count = Math.max(1, Number.parseInt(copies, 10) || 1);
  const up = Math.max(1, Number.parseInt(numberUp, 10) || 1);
  const impressionsPerCopy = pages ? Math.ceil(pages / up) : 0;
  const duplex = String(sides).startsWith("two-sided");
  const sheetsPerCopy = impressionsPerCopy ? Math.ceil(impressionsPerCopy / (duplex ? 2 : 1)) : 0;
  return {
    document_pages: pages,
    copies: count,
    number_up: up,
    sides: String(sides),
    impressions_per_copy: impressionsPerCopy,
    sheets_per_copy: sheetsPerCopy,
    printed_impressions_requested: impressionsPerCopy * count,
    physical_sheets_requested: sheetsPerCopy * count
  };
}

export function createCostSnapshot(profile, { media = "Letter", colorMode = "color" } = {}) {
  if (!profile) return null;
  const papers = profile.paper_profiles || {};
  const key = Object.keys(papers).find((name) => name === media || (papers[name].media || []).includes(media))
    || profile.default_paper_profile || Object.keys(papers)[0] || "unknown";
  const paper = papers[key] || { cost_per_sheet: 0 };
  const monochrome = /mono|gray|grey|black/iu.test(colorMode);
  const bottles = (profile.ink_bottles || []).filter((bottle) => !monochrome || /black|bk/iu.test(bottle.colour || bottle.name || ""));
  return {
    printer_profile: profile.id || "unknown",
    printer_profile_version: String(profile.version || "unknown"),
    effective_date: profile.effective_date || "",
    owner: profile.owner || "",
    printer_make_model: profile.printer_make_model || "",
    ink_family: profile.ink_family || "",
    ink_bottles: bottles,
    paper_profile: key,
    paper_type: paper.paper_type || key,
    paper_cost_per_sheet: Number(paper.cost_per_sheet) || 0,
    maintenance_cost_per_sheet: Number(profile.allowances?.maintenance_cost_per_sheet) || 0,
    electricity_cost_per_sheet: Number(profile.allowances?.electricity_cost_per_sheet) || 0,
    equipment_use_cost_per_sheet: Number(profile.allowances?.equipment_use_cost_per_sheet) || 0,
    color_mode: colorMode
  };
}

export function calculatePrintCost(snapshot, { impressions = 0, sheets = 0, basis = "requested" } = {}) {
  if (!snapshot) return { cost_basis: basis };
  const inkPerImpression = (snapshot.ink_bottles || []).reduce((total, bottle) => {
    const yieldPages = Number(bottle.rated_yield_pages) || 0;
    return total + (yieldPages ? (Number(bottle.price) || 0) / yieldPages : 0);
  }, 0);
  const paperCost = sheets * (Number(snapshot.paper_cost_per_sheet) || 0);
  const inkCost = impressions * inkPerImpression;
  const maintenanceCost = sheets * (Number(snapshot.maintenance_cost_per_sheet) || 0);
  const electricityCost = sheets * (Number(snapshot.electricity_cost_per_sheet) || 0);
  const equipmentCost = sheets * (Number(snapshot.equipment_use_cost_per_sheet) || 0);
  return {
    paper_profile: snapshot.paper_profile || "unknown",
    paper_cost: rounded(paperCost),
    estimated_ink_cost: rounded(inkCost),
    maintenance_cost: rounded(maintenanceCost),
    electricity_cost: rounded(electricityCost),
    equipment_use_cost: rounded(equipmentCost),
    estimated_total_cost: rounded(paperCost + inkCost + maintenanceCost + electricityCost + equipmentCost),
    cost_basis: basis
  };
}

export function pdfPageCount(filePath, pdfinfoBinary = "/usr/bin/pdfinfo") {
  if (!filePath || !/\.pdf$/iu.test(filePath)) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn(pdfinfoBinary, [filePath], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => resolve(0));
    child.on("close", () => resolve(Number.parseInt(output.match(/^Pages:\s*(\d+)/mu)?.[1] || "0", 10) || 0));
  });
}
