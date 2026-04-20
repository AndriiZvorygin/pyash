import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED_KEYS = [
  "HOOK_SUBJECT",
  "EMOTION",
  "FRAMING",
  "BACKGROUND",
  "OVERLAY_TEXT",
  "COLOUR_CONTRAST",
  "STYLE",
  "CLARITY_RULES",
  "NEGATIVE_PROMPT"
];

const OPTIONAL_KEYS = [
  "PROFILE_KIND",
  "SUBJECT_POLICY",
  "FACE_REQUIRED",
  "TEXT_PROMINENCE",
  "SCENE_PRIORITY",
  "TARGET_WIDTH",
  "TARGET_HEIGHT"
];

const CORE_NEGATIVE_EXCLUSIONS = [
  "no clutter",
  "no tiny text",
  "no watermark",
  "no extra faces unless requested",
  "no blurry subject",
  "no low-contrast muddy lighting",
  "no crowded background"
];

const NEGATION_REWRITE_RULES = [
  { pattern: /\bno clutter\b/ig, replacement: "clean composition, minimal background detail" },
  { pattern: /\bno tiny text\b/ig, replacement: "large bold readable text only" },
  { pattern: /\bno blurry subject\b/ig, replacement: "sharp subject focus" },
  { pattern: /\bno blur\b/ig, replacement: "sharp subject focus" },
  { pattern: /\bno low-contrast muddy lighting\b/ig, replacement: "high contrast lighting" },
  { pattern: /\bno crowded background\b/ig, replacement: "clean composition, minimal background detail" },
  { pattern: /\bno crowd scenes\b/ig, replacement: "single clear subject" },
  { pattern: /\bno extra faces unless requested\b/ig, replacement: "single clear subject" },
  { pattern: /\bno third face\b/ig, replacement: "exactly two clear subjects" },
  { pattern: /\bwithout\b/ig, replacement: "with" },
  { pattern: /\bavoid\b/ig, replacement: "prefer" },
  { pattern: /\bno\b/ig, replacement: "with" }
];

const CLARITY_PRIORITY = [
  "subject_count",
  "mobile_readability",
  "clean_composition",
  "large_readable_text",
  "sharp_focus",
  "subject_background_separation",
  "contrast_lighting",
  "visible_sclera"
];

const CLARITY_VALUES = {
  subject_single: "single clear subject",
  subject_two: "exactly two clear subjects",
  mobile_readability: "mobile-first readability",
  clean_composition: "clean composition, minimal background detail",
  large_readable_text: "large bold readable text only",
  sharp_focus: "sharp subject focus",
  subject_background_separation: "strong subject-background separation",
  contrast_lighting: "high contrast lighting",
  visible_sclera: "white sclera and defined irises with clear expressive eyes for visible faces"
};

const ANCHOR_POOLS = {
  economic: [
    "budget report with highlighted deficit numbers",
    "grocery receipt with circled total",
    "utility bill with red overdue stamp",
    "rent notice with bold amount due",
    "rising price chart with red upward arrow"
  ],
  political: [
    "zoning map with highlighted parcel",
    "policy binder with marked page",
    "podium with municipal crest",
    "council agenda sheet with highlighted motion"
  ],
  conflict: [
    "two people facing each other across table",
    "finger pointed at document",
    "tense side-profile confrontation",
    "opposing gestures over map or contract"
  ],
  systems: [
    "simple structured diagram",
    "node and connection pattern",
    "layered circular structure",
    "expanding connected units",
    "minimal system map"
  ],
  generic: [
    "document with highlighted key clause",
    "symbolic marker with clean outline",
    "contract page with bold highlighted clause"
  ]
};

const SECONDARY_CUES = {
  economic: [
    "red upward arrow",
    "circled total",
    "highlighted overdue stamp",
    "line items marked in red"
  ],
  political: [
    "official seal visible"
  ],
  conflict: [
    "tense confrontation posture",
    "opposing hand gestures"
  ],
  systems: [
    "clean layered forms",
    "minimal symbolic system map"
  ]
};

const VISUAL_ANCHOR_TERMS = [
  "report", "budget", "sheet", "document", "folder", "file", "numbers", "chart", "arrow", "receipt", "total",
  "map", "podium", "policy", "deficit", "price", "tag", "symbol", "warning", "graph", "bill", "notice", "contract", "binder", "agenda", "parcel", "crest",
  "diagram", "node", "connection", "layered", "structure", "network", "unit", "progression", "system",
  "face", "eyes", "portrait", "figure"
];

const SYSTEMS_INTENT_TERMS = [
  "system", "systems", "scale", "scaling", "structure", "process", "evolution", "pattern", "growth",
  "transformation", "coordination", "network", "hierarchy", "layer", "layers", "progression"
];

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += String(chunk ?? "");
    });
    process.stdin.on("end", () => resolve(input));
    if (process.stdin.isTTY) process.stdin.emit("end");
  });
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableHash32(value) {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function deterministicPick(pool, seed, label) {
  if (!Array.isArray(pool) || pool.length === 0) return "";
  const idx = stableHash32(`${seed}|${label}`) % pool.length;
  return pool[idx];
}

function parseSchema(text) {
  const parsed = {};
  const duplicates = {};
  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    if (!line) continue;
    const match = line.match(/^([A-Z_]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)) continue;
    const value = normalizeSpaces(match[2]);
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      parsed[key] = value;
      duplicates[key] = [];
      continue;
    }
    duplicates[key].push(value);
  }
  return { parsed, duplicates };
}

function stripOverlayNoise(value) {
  let cleaned = normalizeSpaces(value)
    .replace(/^overlay\s*text\s*[:=-]?\s*/i, "")
    .replace(/^['"`]+|['"`]+$/g, "");
  cleaned = cleaned.replace(/[^A-Za-z0-9' -]/g, " ");
  return normalizeSpaces(cleaned);
}

function enforceOverlayText(rawValue, { uppercaseByDefault = true } = {}) {
  const cleaned = stripOverlayNoise(rawValue);
  const words = cleaned.split(" ").filter(Boolean);
  if (!words.length) return { value: "ACT NOW", repaired: true, reason: "overlay_empty" };

  let next = [...words];
  let repaired = false;
  const reasons = [];

  if (next.length === 1) {
    next = [next[0], "NOW"];
    repaired = true;
    reasons.push("overlay_one_word_expanded");
  }
  if (next.length > 5) {
    next = next.slice(0, 5);
    repaired = true;
    reasons.push("overlay_trimmed_to_five");
  }
  while (next.length < 2) {
    next.push("NOW");
    repaired = true;
    reasons.push("overlay_padded");
  }

  let value = next.join(" ");
  if (uppercaseByDefault) value = value.toUpperCase();
  return { value, repaired, reason: reasons.join(",") || "overlay_valid" };
}

function containsAny(value, patterns = []) {
  const hay = normalizeSpaces(value).toLowerCase();
  return patterns.some((pattern) => hay.includes(String(pattern).toLowerCase()));
}

function removeNoisePhrases(value, phrases = []) {
  let out = ` ${normalizeSpaces(value)} `;
  for (const phrase of phrases) {
    const escaped = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
  }
  return normalizeSpaces(out);
}

function rewriteNegationToPositive(value) {
  let out = normalizeSpaces(value);
  for (const rule of NEGATION_REWRITE_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s*;\s*;+/g, "; ")
    .replace(/\s{2,}/g, " ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
}

function assertNoNegation(value, fieldName) {
  if (/\bno\s+|\bwithout\s+|\bavoid\s+/i.test(value)) {
    throw new Error(`thumbnail prompt compose defective: unresolved negation in ${fieldName}`);
  }
}

function subjectImpliesCrowd(value) {
  const crowdWords = [
    "crowd", "group", "groups", "people", "protesters", "audience", "families", "citizens", "many", "multiple", "team"
  ];
  return containsAny(value, crowdWords);
}

function selectEconomicAnchor(text, seed) {
  if (/\bbudget|deficit\b/i.test(text)) return ANCHOR_POOLS.economic[0];
  if (/\bgrocery|price|cost|costs|inflation\b/i.test(text)) return ANCHOR_POOLS.economic[1];
  if (/\butility|bill|bills\b/i.test(text)) return ANCHOR_POOLS.economic[2];
  if (/\brent\b/i.test(text)) return ANCHOR_POOLS.economic[3];
  if (/\brising|climbing|surge|soar|increase\b/i.test(text)) return ANCHOR_POOLS.economic[4];
  return deterministicPick(ANCHOR_POOLS.economic, seed, "economic-primary");
}

function selectPoliticalAnchor(text, seed) {
  if (/\bzoning|parcel\b/i.test(text)) return ANCHOR_POOLS.political[0];
  if (/\bpolicy|binder\b/i.test(text)) return ANCHOR_POOLS.political[1];
  if (/\bmayor|podium|official\b/i.test(text)) return ANCHOR_POOLS.political[2];
  if (/\bcouncil|agenda|motion|committee\b/i.test(text)) return ANCHOR_POOLS.political[3];
  return deterministicPick(ANCHOR_POOLS.political, seed, "political-primary");
}

function selectConflictAnchor(text, seed) {
  if (/\bshowdown|clash|standoff\b/i.test(text)) return ANCHOR_POOLS.conflict[0];
  if (/\bpoint|finger\b/i.test(text)) return ANCHOR_POOLS.conflict[1];
  if (/\bconfront|battle|fight\b/i.test(text)) return ANCHOR_POOLS.conflict[2];
  if (/\bmap|contract\b/i.test(text)) return ANCHOR_POOLS.conflict[3];
  return deterministicPick(ANCHOR_POOLS.conflict, seed, "conflict-primary");
}

function selectSystemsAnchor(text, seed) {
  if (/\bprogress|evolution|transformation\b/i.test(text)) return ANCHOR_POOLS.systems[3];
  if (/\bnetwork|coordination\b/i.test(text)) return ANCHOR_POOLS.systems[1];
  if (/\blayer|hierarchy|structure\b/i.test(text)) return ANCHOR_POOLS.systems[2];
  if (/\bmap|system map\b/i.test(text)) return ANCHOR_POOLS.systems[4];
  return deterministicPick(ANCHOR_POOLS.systems, seed, "systems-primary");
}

function overlaySignals(overlayText, emotionText = "", hookSubject = "", backgroundText = "") {
  const text = normalizeSpaces(overlayText);
  const hook = normalizeSpaces(hookSubject);
  const background = normalizeSpaces(backgroundText);
  const lower = text.toLowerCase();
  const lowerContext = `${lower} ${hook.toLowerCase()} ${background.toLowerCase()}`.trim();
  const emotion = normalizeSpaces(emotionText).toLowerCase();
  const seed = `${lowerContext}|${normalizeSpaces(hookSubject).toLowerCase()}`;

  const has = (terms) => terms.some((t) => lowerContext.includes(t));

  const economic = has(["budget", "cost", "costs", "rent", "price", "prices", "tax", "fees", "deficit", "debt", "bills", "inflation", "grocery", "utility"]);
  const political = has(["vote", "council", "mayor", "policy", "zoning", "committee", "city", "election", "official", "agenda", "motion"]);
  const conflict = has(["showdown", "clash", "battle", "fight", "standoff", "vs", "confront"]);
  const rising = has(["climbing", "rising", "surge", "soar", "up", "increase"]);
  const cuts = has(["cuts", "cut", "slashes", "slash", "reduction", "reduced", "trim"]);
  const emotional = has(["fear", "panic", "angry", "shocking", "crisis", "urgent", "betrayal"]) || containsAny(emotion, ["fear", "panic", "angry", "urgent", "shocked"]);
  const systemsAbstract = has(SYSTEMS_INTENT_TERMS) || /\babstract|concept\b/i.test(lowerContext);

  let primaryAnchor = "";
  if (conflict) primaryAnchor = selectConflictAnchor(lowerContext, seed);
  else if (economic) primaryAnchor = selectEconomicAnchor(lowerContext, seed);
  else if (political) primaryAnchor = selectPoliticalAnchor(lowerContext, seed);
  else if (systemsAbstract) primaryAnchor = selectSystemsAnchor(lowerContext, seed);
  else primaryAnchor = deterministicPick(ANCHOR_POOLS.generic, seed, "generic-primary");

  let secondaryCue = "";
  if (conflict) secondaryCue = deterministicPick(SECONDARY_CUES.conflict, seed, "conflict-secondary");
  else if (economic && (rising || cuts)) secondaryCue = deterministicPick(SECONDARY_CUES.economic, seed, "economic-secondary");
  else if (political) secondaryCue = deterministicPick(SECONDARY_CUES.political, seed, "political-secondary");
  else if (systemsAbstract) secondaryCue = "";

  let backgroundCue = "";
  if (political) {
    backgroundCue = "official setting with podium and municipal context";
  }

  let colourCue = "";
  if (economic && rising) {
    colourCue = "warning red accents";
  }
  if (systemsAbstract && !economic) {
    colourCue = normalizeSpaces(`${colourCue}, clean high-contrast system lines`);
  }

  const emotionBoost = emotional ? "intense facial expression" : "";

  const intent = conflict ? "conflict" : economic ? "economic" : political ? "political" : systemsAbstract ? "systems" : "generic";

  return {
    intent,
    forceTwoSubjects: conflict,
    systemsAbstract,
    primaryAnchor: normalizeSpaces(primaryAnchor),
    secondaryCue: normalizeSpaces(secondaryCue),
    backgroundCue: normalizeSpaces(backgroundCue),
    colourCue: normalizeSpaces(colourCue),
    emotionBoost: normalizeSpaces(emotionBoost)
  };
}

function subjectHasVisualAnchor(subject) {
  const s = normalizeSpaces(subject).toLowerCase();
  return VISUAL_ANCHOR_TERMS.some((term) => s.includes(term));
}

function alignHookSubjectToOverlay(subject, overlayInfo) {
  let out = normalizeSpaces(subject);

  if (overlayInfo.primaryAnchor && !out.toLowerCase().includes(overlayInfo.primaryAnchor.toLowerCase())) {
    out = normalizeSpaces(`${out}, ${overlayInfo.primaryAnchor}`);
  }
  if (overlayInfo.secondaryCue && !out.toLowerCase().includes(overlayInfo.secondaryCue.toLowerCase())) {
    out = normalizeSpaces(`${out}, ${overlayInfo.secondaryCue}`);
  }

  if (!subjectHasVisualAnchor(out)) {
    const fallback = overlayInfo.primaryAnchor || (overlayInfo.systemsAbstract ? "simple structured diagram" : "document with highlighted key clause");
    out = normalizeSpaces(`${out}, ${fallback}`);
  }

  return out;
}

function explicitTwoSubjectAllowed(schema) {
  const joined = [schema.HOOK_SUBJECT, schema.FRAMING, schema.CLARITY_RULES, schema.BACKGROUND].join(" ");
  return /\b(exactly two|two subjects|2 subjects|two[- ]person|pair of|two people)\b/i.test(joined);
}

function detectOrientation(framingValue) {
  const framing = normalizeSpaces(framingValue).toLowerCase();
  const leftText = /\b(left-text|text on left|text-left|left side for text|left side reserved for text)\b/.test(framing);
  const rightText = /\b(right-text|text on right|text-right|right side for text|right side reserved for text)\b/.test(framing);
  if (leftText && !rightText) return { textSide: "left", subjectSide: "right", source: "left_text" };
  if (rightText && !leftText) return { textSide: "right", subjectSide: "left", source: "right_text" };
  return { textSide: "right", subjectSide: "left", source: "default" };
}

function ensureFraming(value, orientation, allowTwoSubjects) {
  const base = normalizeSpaces(value);
  const includes169 = /\b16:9\b|thumbnail/i.test(base);
  const hasDistance = /close-up|medium-close|medium-wide|wide shot|environment dominant|symbolic layout|centered face/i.test(base);
  const isCenteredFace = /close-up face dominates frame|centered face dominates frame|emotion-first|face-driven/i.test(base);
  const isSceneDriven = /medium-wide|wide shot|environment dominant|scene-driven/i.test(base);
  const isSymbolDriven = /symbolic layout|diagrammatic|symmetric symbolic|symbol-driven/i.test(base);

  const fragments = [];
  if (base) fragments.push(base);
  if (!includes169) fragments.push("16:9 thumbnail framing");
  if (!hasDistance && !isSymbolDriven) fragments.push("close-up or medium-close");

  if (isSymbolDriven) {
    fragments.push("centered symmetric symbolic layout");
    fragments.push("reserve lower third for text");
  } else if (isCenteredFace) {
    fragments.push("centered face dominates frame");
    fragments.push(`reserve ${orientation.textSide} side for text`);
  } else if (isSceneDriven) {
    fragments.push("medium-wide environmental framing");
    fragments.push("environment dominant, subject secondary");
    fragments.push(`reserve ${orientation.textSide} side for text`);
  } else if (allowTwoSubjects) {
    fragments.push("two subjects fill substantial frame");
    fragments.push(`subjects positioned ${orientation.subjectSide} of center`);
    fragments.push(`reserve ${orientation.textSide} side for text`);
  } else {
    fragments.push("subject fills substantial frame");
    fragments.push(`subject on ${orientation.subjectSide}`);
    fragments.push(`reserve ${orientation.textSide} side for text`);
    fragments.push("dramatic off-center composition");
  }

  return normalizeSpaces(fragments.join(", "));
}


function ensureNegativePrompt(value, allowTwoSubjects = false) {
  const items = [];
  const raw = normalizeSpaces(value).toLowerCase();
  if (raw) items.push(raw);
  for (const exclusion of CORE_NEGATIVE_EXCLUSIONS) {
    if (!raw.includes(exclusion)) items.push(exclusion);
  }
  items.push(allowTwoSubjects ? "no third face" : "no crowd scenes");
  return [...new Set(items.map((x) => normalizeSpaces(x)).filter(Boolean))].join(", ");
}

function mapNegativePromptToClarity(value) {
  const source = normalizeSpaces(value).toLowerCase();
  if (!source) return "";
  const mapped = [];
  if (source.includes("no clutter")) mapped.push("clean composition", "minimal background detail");
  if (source.includes("no tiny text")) mapped.push("large bold readable text only");
  if (source.includes("no blurry subject") || source.includes("no blur")) mapped.push("sharp subject focus");
  if (source.includes("no low-contrast muddy lighting")) mapped.push("high contrast lighting");
  if (source.includes("no crowded background")) mapped.push("clean composition", "minimal background detail");
  if (source.includes("no crowd scenes")) mapped.push("single clear subject");
  if (source.includes("no extra faces unless requested")) mapped.push("single clear subject");
  if (source.includes("no third face")) mapped.push("exactly two clear subjects");
  return [...new Set(mapped)].join(", ");
}

function sanitizeStyle(value) {
  const noise = [
    "cinematic filler",
    "movie poster",
    "poster art",
    "painterly blur",
    "atmospheric haze",
    "crowd-heavy",
    "busy environment",
    "sweeping environment",
    "cinematic",
    "epic",
    "ultra detailed"
  ];
  let cleaned = removeNoisePhrases(value, noise).replace(/\bfiller\b/ig, " ");
  cleaned = cleaned
    .split(",")
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
    .join(", ");
  cleaned = normalizeSpaces(cleaned);
  if (!cleaned) cleaned = "editorial illustration";
  return normalizeSpaces(
    `${cleaned}, clarity-first thumbnail style, expressive face readability, readable silhouettes, clean subject-background separation`
  );
}

function ensureBaseClarityRules(value, options = {}) {
  const faceRequired = options.faceRequired !== false;
  const base = normalizeSpaces(value);
  const parts = [];
  if (base) parts.push(base);
  parts.push("mobile-first readability");
  parts.push("clean composition, minimal background detail");
  parts.push("large bold readable text only");
  parts.push("sharp subject focus");
  parts.push("strong subject-background separation");
  parts.push("high contrast lighting");
  if (faceRequired) parts.push("white sclera and defined irises with clear expressive eyes for visible faces");
  return normalizeSpaces(parts.join(", "));
}

function canonicalClarityKey(phrase) {
  const p = normalizeSpaces(phrase).toLowerCase();
  if (!p) return "";
  if (/\bexactly two clear subjects\b|\bexactly two human subjects\b|\btwo clear subjects\b/.test(p)) return "subject_two";
  if (/\bsingle clear subject\b|\bone clear subject\b|\bone human focal subject\b|\bsingle focal subject\b/.test(p)) return "subject_single";
  if (/\bmobile[- ]first readability\b|\bsmall-size readability\b|\bphone readability\b/.test(p)) return "mobile_readability";
  if (/\bclean composition\b|\bminimal background\b|\bbackground detail\b|\bsimple background\b/.test(p)) return "clean_composition";
  if (/\blarge\b.*\breadable\b.*\btext\b|\bbold\b.*\btext\b/.test(p)) return "large_readable_text";
  if (/\bsharp\b.*\bfocus\b/.test(p)) return "sharp_focus";
  if (/\bsubject-background separation\b|\bsubject background separation\b/.test(p)) return "subject_background_separation";
  if (/\bhigh contrast lighting\b|\bstrong contrast lighting\b|\bhigh contrast\b/.test(p)) return "contrast_lighting";
  if (/\bsclera\b|\birises\b/.test(p)) return "visible_sclera";
  return p;
}

function strongestForKey(key, current, incoming) {
  if (!current) return incoming;
  const preferred = {
    clean_composition: CLARITY_VALUES.clean_composition,
    large_readable_text: CLARITY_VALUES.large_readable_text,
    sharp_focus: CLARITY_VALUES.sharp_focus,
    subject_background_separation: CLARITY_VALUES.subject_background_separation,
    contrast_lighting: CLARITY_VALUES.contrast_lighting,
    subject_single: CLARITY_VALUES.subject_single,
    subject_two: CLARITY_VALUES.subject_two,
    mobile_readability: CLARITY_VALUES.mobile_readability
  };
  if (preferred[key]) return preferred[key];
  return incoming.length > current.length ? incoming : current;
}

function compressClarityRules(rawClarity, allowTwoSubjects, options = {}) {
  const faceRequired = options.faceRequired !== false;
  const normalizedRaw = rewriteNegationToPositive(rawClarity);
  const fragments = normalizedRaw
    .split(/[;,]/)
    .map((part) => normalizeSpaces(part))
    .filter(Boolean);

  const bucket = new Map();
  for (const fragment of fragments) {
    const key = canonicalClarityKey(fragment);
    if (!key) continue;
    const current = bucket.get(key);
    bucket.set(key, strongestForKey(key, current, fragment));
  }

  if (allowTwoSubjects) {
    bucket.delete("subject_single");
    bucket.set("subject_two", CLARITY_VALUES.subject_two);
  } else {
    bucket.delete("subject_two");
    bucket.set("subject_single", CLARITY_VALUES.subject_single);
  }

  if (!bucket.has("mobile_readability")) bucket.set("mobile_readability", CLARITY_VALUES.mobile_readability);
  if (!bucket.has("large_readable_text")) bucket.set("large_readable_text", CLARITY_VALUES.large_readable_text);
  if (!bucket.has("contrast_lighting")) bucket.set("contrast_lighting", CLARITY_VALUES.contrast_lighting);
  if (!bucket.has("clean_composition")) bucket.set("clean_composition", CLARITY_VALUES.clean_composition);
  if (!bucket.has("sharp_focus")) bucket.set("sharp_focus", CLARITY_VALUES.sharp_focus);
  if (!bucket.has("subject_background_separation")) bucket.set("subject_background_separation", CLARITY_VALUES.subject_background_separation);
  if (faceRequired && !bucket.has("visible_sclera")) bucket.set("visible_sclera", CLARITY_VALUES.visible_sclera);
  if (!faceRequired) bucket.delete("visible_sclera");

  const ordered = [];
  for (const key of CLARITY_PRIORITY) {
    if (key === "subject_count") {
      if (allowTwoSubjects && bucket.has("subject_two")) ordered.push(bucket.get("subject_two"));
      if (!allowTwoSubjects && bucket.has("subject_single")) ordered.push(bucket.get("subject_single"));
      continue;
    }
    if (bucket.has(key)) ordered.push(bucket.get(key));
  }

  for (const [key, value] of bucket.entries()) {
    if (
      key !== "subject_single" && key !== "subject_two" &&
      !CLARITY_PRIORITY.includes(key) &&
      !ordered.includes(value)
    ) {
      ordered.push(value);
    }
  }

  return normalizeSpaces(ordered.slice(0, 8).join(", "));
}

function hasVisibleHumanSubject(hookSubject = "") {
  const text = normalizeSpaces(hookSubject).toLowerCase();
  return /\bhuman\b|\bperson\b|\bpeople\b|\bman\b|\bwoman\b|\belder\b|\bfigure\b|\bface\b|\bsubject\b/.test(text);
}

function enforceExpressiveEmotion(emotion = "", hookSubject = "") {
  const base = normalizeSpaces(emotion || "strong readable emotion");
  if (!hasVisibleHumanSubject(hookSubject)) return base;
  if (/eyes?.*brows?.*mouth|facial expression|expressive face|readable expression/.test(base.toLowerCase())) return base;
  return normalizeSpaces(base + ", visible emotion in eyes brows and mouth, readable facial expression at thumbnail size");
}

function parseTruthy(value) {
  const v = normalizeSpaces(value).toLowerCase();
  return /^(truth|true|yes|1|required)$/.test(v);
}

function normalizeSubjectPolicy(value) {
  return normalizeSpaces(value).toLowerCase();
}

function isHumanSubjectPolicy(value) {
  const v = normalizeSubjectPolicy(value);
  if (!v) return true;
  return /human|face|person|portrait/.test(v);
}

function lintAndRepair(schemaParsed, duplicates) {
  const schema = {};
  const repairs = [];

  for (const key of REQUIRED_KEYS) {
    const value = normalizeSpaces(schemaParsed[key] ?? "");
    if (!value) repairs.push({ type: "missing_key", key });
    schema[key] = value;
    const dupes = duplicates[key] || [];
    if (dupes.length > 0) repairs.push({ type: "duplicate_key", key, ignored: dupes.length });
  }

  if (Object.values(schema).every((v) => !v)) {
    throw new Error("thumbnail prompt compose defective: schema empty or missing required keyed lines");
  }

  const subjectPolicy = normalizeSubjectPolicy(schemaParsed.SUBJECT_POLICY || "");
  const preferHumanSubject = isHumanSubjectPolicy(subjectPolicy);
  const faceRequired = normalizeSpaces(schemaParsed.FACE_REQUIRED || "")
    ? parseTruthy(schemaParsed.FACE_REQUIRED)
    : preferHumanSubject;
  const textProminence = normalizeSpaces(schemaParsed.TEXT_PROMINENCE || "").toLowerCase();

  const preserveCase = /preserve overlay case|overlay_case_preserve/i.test(schema.CLARITY_RULES)
    || process.env.THUMBNAIL_OVERLAY_UPPERCASE === "0";
  const overlay = enforceOverlayText(schema.OVERLAY_TEXT, { uppercaseByDefault: !preserveCase });
  schema.OVERLAY_TEXT = overlay.value;
  repairs.push({ type: "overlay_text", repaired: overlay.repaired, reason: overlay.reason || "overlay_valid" });

  const overlayInfo = overlaySignals(schema.OVERLAY_TEXT, schema.EMOTION, schema.HOOK_SUBJECT, schema.BACKGROUND);
  const frameLower = normalizeSpaces(schema.FRAMING).toLowerCase();
  const variantFrameMode = /centered symmetric symbolic layout|symbol-driven/.test(frameLower)
    ? "symbol"
    : /medium-wide environmental framing|scene-driven|environment dominant/.test(frameLower)
      ? "scene"
      : /close-up face dominates frame|face-driven|centered composition/.test(frameLower)
        ? "face"
        : "default";

  let allowTwoSubjects = explicitTwoSubjectAllowed(schema) || overlayInfo.forceTwoSubjects;
  if (variantFrameMode === "face" || variantFrameMode === "symbol") {
    allowTwoSubjects = false;
  }

  if (!allowTwoSubjects && subjectImpliesCrowd(schema.HOOK_SUBJECT)) {
    schema.HOOK_SUBJECT = preferHumanSubject
      ? "one dominant human focal subject tied to source hook"
      : "one dominant focal subject tied to source hook";
    repairs.push({ type: "focal_subject_rewrite", mode: "single_subject_default" });
  }

  if (allowTwoSubjects) {
    schema.HOOK_SUBJECT = normalizeSpaces(`${schema.HOOK_SUBJECT || "two human subjects"}, exactly two human subjects`);
    repairs.push({ type: "focal_subject_mode", mode: "two_subject_allowed" });
  } else {
    schema.HOOK_SUBJECT = preferHumanSubject
      ? normalizeSpaces(`${schema.HOOK_SUBJECT || "one dominant human focal subject"}, exactly one human focal subject`)
      : normalizeSpaces(`${schema.HOOK_SUBJECT || "one dominant focal subject"}, exactly one dominant focal subject`);
    repairs.push({ type: "focal_subject_mode", mode: "single_subject_enforced" });
  }

  if (variantFrameMode === "face") {
    if (faceRequired) {
      schema.HOOK_SUBJECT = normalizeSpaces(`${stripKnownAnchors(schema.HOOK_SUBJECT)}, expressive human face with visible white sclera and defined irises, exactly one human focal subject`);
    } else {
      schema.HOOK_SUBJECT = normalizeSpaces(`${stripKnownAnchors(schema.HOOK_SUBJECT)}, close focal subject with clear silhouette, exactly one dominant focal subject`);
    }
  } else if (variantFrameMode === "symbol") {
    const symbolicAnchor = deterministicPick(ANCHOR_POOLS.systems, schema.OVERLAY_TEXT, "symbolic-anchor");
    schema.HOOK_SUBJECT = normalizeSpaces(`${stripKnownAnchors(schema.HOOK_SUBJECT)}, centered symbolic structure, ${symbolicAnchor}`);
  } else {
    schema.HOOK_SUBJECT = alignHookSubjectToOverlay(schema.HOOK_SUBJECT, overlayInfo);
    if (overlayInfo.backgroundCue) {
      schema.BACKGROUND = normalizeSpaces(`${schema.BACKGROUND}, ${overlayInfo.backgroundCue}`);
    }
    if (overlayInfo.colourCue) {
      schema.COLOUR_CONTRAST = normalizeSpaces(`${schema.COLOUR_CONTRAST}, ${overlayInfo.colourCue}`);
    }
  }
  if (overlayInfo.emotionBoost && !schema.EMOTION.toLowerCase().includes(overlayInfo.emotionBoost.toLowerCase())) {
    schema.EMOTION = normalizeSpaces(`${schema.EMOTION}, ${overlayInfo.emotionBoost}`);
  }
  repairs.push({ type: "overlay_subject_alignment", primary_anchor: overlayInfo.primaryAnchor, secondary_cue: overlayInfo.secondaryCue, variant_mode: variantFrameMode });

  const orientation = detectOrientation(schema.FRAMING);
  schema.FRAMING = ensureFraming(schema.FRAMING, orientation, allowTwoSubjects);
  repairs.push({ type: "orientation", text_side: orientation.textSide, subject_side: orientation.subjectSide, source: orientation.source, plural: allowTwoSubjects });

  schema.EMOTION = faceRequired
    ? enforceExpressiveEmotion(schema.EMOTION || "strong readable emotion", schema.HOOK_SUBJECT)
    : normalizeSpaces(schema.EMOTION || "clear readable mood");
  schema.BACKGROUND = normalizeSpaces(schema.BACKGROUND || "simple uncluttered background with soft depth separation");
  schema.COLOUR_CONTRAST = normalizeSpaces(schema.COLOUR_CONTRAST || "high contrast foreground/background separation for mobile readability");
  schema.STYLE = sanitizeStyle(schema.STYLE);
  schema.CLARITY_RULES = ensureBaseClarityRules(schema.CLARITY_RULES, { faceRequired });
  schema.NEGATIVE_PROMPT = ensureNegativePrompt(schema.NEGATIVE_PROMPT, allowTwoSubjects);

  const mappedFromNegative = mapNegativePromptToClarity(schema.NEGATIVE_PROMPT);
  if (mappedFromNegative) {
    schema.CLARITY_RULES = normalizeSpaces(`${schema.CLARITY_RULES}, ${mappedFromNegative}`);
    repairs.push({ type: "negative_to_positive", applied: true });
  }

  if (/high|prominent|headline/.test(textProminence)) {
    schema.FRAMING = normalizeSpaces(`${schema.FRAMING}, reserve about one third of frame for overlay text`);
    schema.CLARITY_RULES = normalizeSpaces(`${schema.CLARITY_RULES}, text block intentionally prominent`);
  }

  schema.HOOK_SUBJECT = rewriteNegationToPositive(schema.HOOK_SUBJECT);
  schema.EMOTION = rewriteNegationToPositive(schema.EMOTION);
  schema.FRAMING = rewriteNegationToPositive(schema.FRAMING);
  schema.BACKGROUND = rewriteNegationToPositive(schema.BACKGROUND);
  schema.COLOUR_CONTRAST = rewriteNegationToPositive(schema.COLOUR_CONTRAST);
  schema.STYLE = rewriteNegationToPositive(schema.STYLE);
  schema.CLARITY_RULES = compressClarityRules(schema.CLARITY_RULES, allowTwoSubjects, { faceRequired });

  if (!/\b16:9\b|thumbnail/i.test(schema.FRAMING)) {
    throw new Error("thumbnail prompt compose defective: framing missing thumbnail/16:9 intent");
  }

  assertNoNegation(schema.HOOK_SUBJECT, "HOOK_SUBJECT");
  assertNoNegation(schema.EMOTION, "EMOTION");
  assertNoNegation(schema.FRAMING, "FRAMING");
  assertNoNegation(schema.BACKGROUND, "BACKGROUND");
  assertNoNegation(schema.COLOUR_CONTRAST, "COLOUR_CONTRAST");
  assertNoNegation(schema.STYLE, "STYLE");
  assertNoNegation(schema.CLARITY_RULES, "CLARITY_RULES");

  if (!/\bmobile-first readability\b/i.test(schema.CLARITY_RULES)) {
    throw new Error("thumbnail prompt compose defective: clarity rules missing readability rule");
  }
  if (!/\blarge bold readable text only\b/i.test(schema.CLARITY_RULES)) {
    throw new Error("thumbnail prompt compose defective: clarity rules missing text readability rule");
  }
  if (!/\bhigh contrast lighting\b/i.test(schema.CLARITY_RULES)) {
    throw new Error("thumbnail prompt compose defective: clarity rules missing contrast rule");
  }
  if (allowTwoSubjects) {
    if (!/\bexactly two clear subjects\b/i.test(schema.CLARITY_RULES)) {
      throw new Error("thumbnail prompt compose defective: clarity rules missing two-subject rule");
    }
  } else if (!/\bsingle clear subject\b/i.test(schema.CLARITY_RULES)) {
    throw new Error("thumbnail prompt compose defective: clarity rules missing single-subject rule");
  }

  if (!subjectHasVisualAnchor(schema.HOOK_SUBJECT)) {
    throw new Error("thumbnail prompt compose defective: subject missing visual anchor tied to overlay");
  }

  return { schema, repairs, orientation };
}

function composePrompt(schema) {
  return normalizeSpaces(
    `${schema.HOOK_SUBJECT}; ${schema.EMOTION}; ${schema.FRAMING}; ${schema.BACKGROUND}; overlay text "${schema.OVERLAY_TEXT}" bold and large in reserved negative space; ${schema.COLOUR_CONTRAST}; ${schema.STYLE}; ${schema.CLARITY_RULES}.`
  );
}

const VARIANT_EMOTION = {
  A: "high-intensity emotional facial expression, visible emotion in eyes brows and mouth",
  B: "situational tension with visibly expressive face, visible emotion in eyes brows and mouth",
  C: "calm analytical conceptual tone"
};

const VARIANT_LABELS = ["A", "B", "C"];

const VARIANT_MODE_TEXT = {
  A: "face-driven",
  B: "scene-driven",
  C: "symbol-driven"
};

const VARIANT_COMPOSITION_KIND = {
  A: "face",
  B: "scene",
  C: "symbol"
};

const VARIANT_ANCHOR_KIND = {
  A: "human_emotion",
  B: "environment_scale",
  C: "abstract_symbol"
};

const VARIANT_STYLE = {
  A: "portrait editorial illustration, ink-and-gouache texture, expressive facial rendering, crisp contour linework",
  B: "environmental narrative illustration, storyboard scene depth, directional lighting contrast, layered perspective",
  C: "diagrammatic symbolic illustration, geometric icon forms, flat color planes, precise shape language"
};

const OVERLAY_STOP_WORDS = new Set([
  "THE", "AND", "FOR", "WITH", "FROM", "THIS", "THAT", "YOUR", "ABOUT", "INTO", "ONTO", "THERE", "THEIR", "THEM", "WHAT", "WHEN", "WHERE"
]);

function parseVariantModeFromArgs(argv = process.argv.slice(2)) {
  const envMode = normalizeSpaces(process.env.THUMBNAIL_VARIANT_MODE || "").toLowerCase();
  if (["triple", "multi", "variants", "three"].includes(envMode)) return "triple";

  const args = Array.isArray(argv) ? argv : [];
  if (args.includes("--multi-variants")) return "triple";
  const variantsIndex = args.indexOf("--variants");
  if (variantsIndex >= 0 && String(args[variantsIndex + 1] || "") === "3") return "triple";
  const byEquals = args.find((a) => /^--variants=/.test(String(a || "")));
  if (byEquals && byEquals.split("=")[1] === "3") return "triple";
  const modeIndex = args.indexOf("--variant-mode");
  if (modeIndex >= 0 && /triple|multi|variants|three/i.test(String(args[modeIndex + 1] || ""))) return "triple";
  return "single";
}

function parseVariantLabelFromArgs(argv = process.argv.slice(2)) {
  const envLabel = normalizeSpaces(process.env.THUMBNAIL_VARIANT_LABEL || "").toUpperCase();
  if (VARIANT_LABELS.includes(envLabel)) return envLabel;

  const args = Array.isArray(argv) ? argv : [];
  const labelIndex = args.indexOf("--variant-label");
  if (labelIndex >= 0) {
    const value = normalizeSpaces(args[labelIndex + 1] || "").toUpperCase();
    if (VARIANT_LABELS.includes(value)) return value;
  }
  const byEquals = args.find((a) => /^--variant-label=/.test(String(a || "")));
  if (byEquals) {
    const value = normalizeSpaces(byEquals.split("=")[1] || "").toUpperCase();
    if (VARIANT_LABELS.includes(value)) return value;
  }
  return "";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripKnownAnchors(value) {
  let out = normalizeSpaces(value);
  const known = [
    ...Object.values(ANCHOR_POOLS).flat(),
    ...Object.values(SECONDARY_CUES).flat(),
    "expressive human face with visible white sclera and defined irises",
    "small human figure within dominant environment",
    "centered symbolic structure"
  ]
    .map((x) => normalizeSpaces(x))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const phrase of known) {
    const re = new RegExp(`(^|[,;]\\s*)${escapeRegex(phrase)}(?=$|[,;])`, "ig");
    out = out.replace(re, "$1");
  }

  out = out
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return out;
}

function extractOverlayKeywords(schema) {
  const text = [schema.OVERLAY_TEXT, schema.HOOK_SUBJECT, schema.BACKGROUND]
    .map((x) => normalizeSpaces(x))
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ");
  const words = text.split(/\s+/).filter(Boolean);
  const picked = [];
  for (const w of words) {
    if (w.length < 4) continue;
    if (OVERLAY_STOP_WORDS.has(w)) continue;
    if (!picked.includes(w)) picked.push(w);
    if (picked.length >= 5) break;
  }
  return picked;
}

function buildVariantOverlayValues(schema) {
  const keywords = extractOverlayKeywords(schema);
  const k1 = keywords[0] || "SYSTEM";
  const k2 = keywords[1] || "SHIFT";

  const A = enforceOverlayText(schema.OVERLAY_TEXT, { uppercaseByDefault: true }).value;

  const aWords = String(A || "").toUpperCase().split(/\s+/).filter(Boolean);
  const a1 = aWords[0] || k1;
  const a2 = aWords[1] || k2;

  const B = enforceOverlayText(`${a1} ${a2} WHAT NEXT`, { uppercaseByDefault: true }).value;
  const C = enforceOverlayText(`${a1} ${a2} CORE IDEA`, { uppercaseByDefault: true }).value;

  const overlays = { A, B, C };
  if (overlays.B === overlays.A) overlays.B = enforceOverlayText(`${a1} OPEN LOOP`, { uppercaseByDefault: true }).value;
  if (overlays.C === overlays.A || overlays.C === overlays.B) {
    overlays.C = enforceOverlayText(`${a1} ${a2} CORE`, { uppercaseByDefault: true }).value;
  }
  return overlays;
}
function pickDifferentAnchor(pool, seed, label, excluded = []) {
  const uniq = [...new Set((pool || []).map((x) => normalizeSpaces(x)).filter(Boolean))];
  const available = uniq.filter((x) => !excluded.includes(x));
  const target = available.length > 0 ? available : uniq;
  if (target.length === 0) return "";
  return deterministicPick(target, seed, label);
}

function intentPool(intent) {
  if (intent === "economic") return ANCHOR_POOLS.economic;
  if (intent === "political") return ANCHOR_POOLS.political;
  if (intent === "conflict") return ANCHOR_POOLS.conflict;
  if (intent === "systems") return ANCHOR_POOLS.systems;
  return ANCHOR_POOLS.generic;
}

function buildVariantSchemaForLabel(label, baseSchema, context = {}, attempt = 0) {
  const seed = `${baseSchema.OVERLAY_TEXT}|${baseSchema.HOOK_SUBJECT}|${baseSchema.BACKGROUND}|${label}|${attempt}`;
  const overlays = buildVariantOverlayValues(baseSchema);
  const baseIntent = context?.overlayInfo?.intent || "generic";
  const subjectCoreRaw = stripKnownAnchors(baseSchema.HOOK_SUBJECT);
  const subjectCore = normalizeSpaces(subjectCoreRaw || "one dominant human focal subject tied to source hook");

  const spec = {
    label,
    mode: VARIANT_MODE_TEXT[label],
    composition_kind: VARIANT_COMPOSITION_KIND[label],
    anchor_kind: VARIANT_ANCHOR_KIND[label],
    schema: { ...baseSchema }
  };

  spec.schema.OVERLAY_TEXT = overlays[label];
  spec.schema.EMOTION = VARIANT_EMOTION[label];

  if (label === "A") {
    const anchor = "expressive human face with visible white sclera and defined irises";
    spec.anchor = anchor;
    spec.schema.HOOK_SUBJECT = normalizeSpaces(`${subjectCore}, ${anchor}, exactly one human focal subject`);
    spec.schema.FRAMING = "close-up face dominates frame, centered composition, 16:9 thumbnail framing, reserve right side for text";
    spec.schema.BACKGROUND = "minimal soft gradient background with low detail";
    spec.schema.STYLE = normalizeSpaces(VARIANT_STYLE.A);
    return spec;
  }

  if (label === "B") {
    const primaryPool = intentPool(baseIntent);
    const anchor = pickDifferentAnchor(primaryPool, seed, "variant-b-scene-anchor", []) || pickDifferentAnchor(ANCHOR_POOLS.generic, seed, "variant-b-scene-fallback", []);
    spec.anchor = anchor;
    spec.schema.HOOK_SUBJECT = normalizeSpaces(`small human figure within dominant environment, ${anchor}, exactly one human focal subject`);
    spec.schema.FRAMING = "medium-wide environmental framing, environment dominant, subject secondary, 16:9 thumbnail framing, reserve left side for text";
    spec.schema.BACKGROUND = normalizeSpaces(`${baseSchema.BACKGROUND}, high-contrast environmental context with clear depth`);
    spec.schema.STYLE = normalizeSpaces(VARIANT_STYLE.B);
    return spec;
  }

  const anchor = pickDifferentAnchor(ANCHOR_POOLS.systems, seed, "variant-c-symbol-anchor", []) || "minimal system map";
  spec.anchor = anchor;
  spec.schema.HOOK_SUBJECT = normalizeSpaces(`centered symbolic structure, ${anchor}`);
  spec.schema.FRAMING = "centered symmetric symbolic layout, 16:9 thumbnail framing, reserve lower third for text";
  spec.schema.BACKGROUND = "clean low-detail backdrop supporting one symbolic focal structure";
  spec.schema.STYLE = normalizeSpaces(VARIANT_STYLE.C);
  return spec;
}

function buildVariantSchemas(baseSchema, context = {}, attemptsByLabel = {}) {
  return VARIANT_LABELS.map((label) => buildVariantSchemaForLabel(label, baseSchema, context, attemptsByLabel[label] || 0));
}

function validateVariantDivergence(variantOutputs = []) {
  const issues = [];
  const byLabel = new Map(variantOutputs.map((v) => [v.label, v]));

  for (const label of VARIANT_LABELS) {
    const variant = byLabel.get(label);
    if (!variant) {
      issues.push({ label, reason: "missing_variant" });
      continue;
    }
    const framing = normalizeSpaces(variant.schema?.FRAMING || "").toLowerCase();

    if (label === "A") {
      if (!/close-up face dominates frame|centered face dominates frame/.test(framing)) {
        issues.push({ label, reason: "face_variant_missing_close_face" });
      }
      if (/medium-wide|wide shot|environment dominant/.test(framing)) {
        issues.push({ label, reason: "face_variant_used_scene_framing" });
      }
    }

    if (label === "B") {
      if (!/medium-wide|environment dominant/.test(framing)) {
        issues.push({ label, reason: "scene_variant_missing_environment_framing" });
      }
      if (/close-up face dominates frame|centered face dominates frame/.test(framing)) {
        issues.push({ label, reason: "scene_variant_used_face_framing" });
      }
    }

    if (label === "C") {
      if (!/symbolic layout|symmetric symbolic|diagrammatic/.test(framing)) {
        issues.push({ label, reason: "symbol_variant_missing_symbolic_layout" });
      }
      if (/close-up face dominates frame|medium-wide|environment dominant/.test(framing)) {
        issues.push({ label, reason: "symbol_variant_reused_face_or_scene_framing" });
      }
    }

    const style = normalizeSpaces(variant.schema?.STYLE || "").toLowerCase();
    if (label === "A" && !/portrait/.test(style)) {
      issues.push({ label, reason: "face_variant_missing_portrait_style" });
    }
    if (label === "B" && !/environmental narrative|storyboard/.test(style)) {
      issues.push({ label, reason: "scene_variant_missing_environment_style" });
    }
    if (label === "C" && !/diagrammatic symbolic|geometric icon/.test(style)) {
      issues.push({ label, reason: "symbol_variant_missing_diagram_style" });
    }
  }

  const compositionKinds = new Set(variantOutputs.map((v) => v.composition_kind));
  if (compositionKinds.size !== 3) {
    for (const v of variantOutputs) issues.push({ label: v.label, reason: "composition_not_unique" });
  }

  const anchorKinds = new Set(variantOutputs.map((v) => v.anchor_kind));
  if (anchorKinds.size !== 3) {
    for (const v of variantOutputs) issues.push({ label: v.label, reason: "anchor_not_unique" });
  }

  const framingKinds = new Set(variantOutputs.map((v) => normalizeSpaces(v.schema?.FRAMING || "").toLowerCase()));
  if (framingKinds.size !== 3) {
    for (const v of variantOutputs) issues.push({ label: v.label, reason: "framing_not_unique" });
  }

  const styleKinds = new Set(variantOutputs.map((v) => normalizeSpaces(v.schema?.STYLE || "").toLowerCase()));
  if (styleKinds.size !== 3) {
    for (const v of variantOutputs) issues.push({ label: v.label, reason: "style_not_unique" });
  }

  return issues;
}

function composeVariantOutput(variants = []) {
  return variants
    .map((v) => `Variant ${v.label} (${v.mode}): ${composePrompt(v.schema)}`)
    .join("\n");
}


async function writeDebugArtifact(payload) {
  const verbose = process.env.PYA_RUN_VERBOSE === "1";
  const explicitPath = normalizeSpaces(process.env.THUMBNAIL_PROMPT_DEBUG_PATH || "");
  if (!verbose && !explicitPath) return;

  let outPath = explicitPath;
  if (!outPath) {
    const runId = normalizeSpaces(process.env.PYA_RUN_ID || "manual");
    outPath = path.join(process.cwd(), "artifacts", runId, "newspaper", "thumbnail-prompt-debug.json");
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseComposeOverridesFromArgs(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? argv : [];
  const read = (name) => {
    const idx = args.indexOf(name);
    if (idx >= 0) return normalizeSpaces(args[idx + 1] || "");
    const byEq = args.find((a) => String(a || "").startsWith(name + "="));
    if (byEq) return normalizeSpaces(String(byEq).slice(name.length + 1));
    return "";
  };
  const out = {};
  const profile = read("--profile-kind");
  const subjectPolicy = read("--subject-policy");
  const faceRequired = read("--face-required");
  const textProminence = read("--text-prominence");
  const targetWidth = read("--target-width");
  const targetHeight = read("--target-height");
  if (profile) out.PROFILE_KIND = profile;
  if (subjectPolicy) out.SUBJECT_POLICY = subjectPolicy;
  if (faceRequired) out.FACE_REQUIRED = faceRequired;
  if (textProminence) out.TEXT_PROMINENCE = textProminence;
  if (targetWidth) out.TARGET_WIDTH = targetWidth;
  if (targetHeight) out.TARGET_HEIGHT = targetHeight;
  return out;
}

const input = await readStdin();
const { parsed, duplicates } = parseSchema(input);
const composeOverrides = parseComposeOverridesFromArgs(process.argv.slice(2));
for (const [k, v] of Object.entries(composeOverrides)) parsed[k] = v;
const variantMode = parseVariantModeFromArgs(process.argv.slice(2));
const variantLabel = parseVariantLabelFromArgs(process.argv.slice(2));
const { schema, repairs, orientation } = lintAndRepair(parsed, duplicates);
const overlayInfo = overlaySignals(schema.OVERLAY_TEXT, schema.EMOTION, schema.HOOK_SUBJECT, schema.BACKGROUND);

const shouldBuildVariants = variantMode === "triple" || Boolean(variantLabel);

if (shouldBuildVariants) {
  const attemptsByLabel = { A: 0, B: 0, C: 0 };
  let variantSpecs = [];
  let variantOutputs = [];
  let divergenceIssues = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    variantSpecs = buildVariantSchemas(schema, { overlayInfo }, attemptsByLabel);
    variantOutputs = variantSpecs.map((spec) => {
      const linted = lintAndRepair(spec.schema, {});
      return {
        label: spec.label,
        mode: spec.mode,
        anchor: spec.anchor,
        anchor_kind: spec.anchor_kind,
        composition_kind: spec.composition_kind,
        schema: linted.schema,
        repairs: linted.repairs,
        orientation: linted.orientation,
        prompt: composePrompt(linted.schema)
      };
    });

    divergenceIssues = validateVariantDivergence(variantOutputs);
    if (divergenceIssues.length === 0) break;

    const labelsToRegenerate = [...new Set(divergenceIssues.map((issue) => issue.label).filter((label) => VARIANT_LABELS.includes(label)))];
    if (labelsToRegenerate.length === 0) break;
    for (const label of labelsToRegenerate) attemptsByLabel[label] = (attemptsByLabel[label] || 0) + 1;
  }

  if (divergenceIssues.length > 0) {
    throw new Error(`thumbnail prompt compose defective: variant divergence failed: ${divergenceIssues.map((x) => `${x.label}:${x.reason}`).join(', ')}`);
  }

  const selected = variantLabel
    ? (variantOutputs.find((v) => v.label === variantLabel) || variantOutputs[0])
    : null;

  const finalText = selected
    ? selected.prompt
    : composeVariantOutput(variantOutputs);

  await writeDebugArtifact({
    parsed_schema: parsed,
    duplicates,
    variant_mode: variantMode,
    variant_label: variantLabel || "",
    variant_selected: selected ? selected.label : "",
    base_repaired_schema: schema,
    base_repairs: repairs,
    base_orientation: orientation,
    variants: variantOutputs.map((v) => ({
      label: v.label,
      mode: v.mode,
      anchor: v.anchor,
      overlay_text: v.schema.OVERLAY_TEXT,
      hook_subject: v.schema.HOOK_SUBJECT,
      repairs: v.repairs,
      orientation: v.orientation,
      final_prompt: v.prompt
    })),
    final_prompt: finalText
  });

  process.stdout.write(`${finalText}\n`);
} else {
  const finalPrompt = composePrompt(schema);
  await writeDebugArtifact({
    parsed_schema: parsed,
    duplicates,
    variant_mode: variantMode,
    variant_label: variantLabel || "",
    repaired_schema: schema,
    repairs,
    orientation,
    final_prompt: finalPrompt
  });
  process.stdout.write(`${finalPrompt}\n`);
}
