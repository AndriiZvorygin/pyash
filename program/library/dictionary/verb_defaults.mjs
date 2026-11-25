// Deterministic default spelling for verb surfaces that `pyashWords.json` does
// not carry. A `.pya` sentence must round-trip to `.pyac` deterministically, so
// each surface resolves to exactly one chosen sense: the one the implementation
// uses. Other senses are written as explicit compounds at the call site rather
// than by making this table ambiguous.
//
// The reference volume is the vocabulary authority; this table only selects
// which existing sense is the default for a surface the older encoding table
// happens to be missing. Each row records the sense it came from. A surface
// with no defensible implementation sense is absent on purpose: it needs a new
// word (WordNet sense selection and generation), not a preference here.
export const DEFAULT_VERB_SPELLING = new Map([
  ["verify", ["tras", "drot"]], // SUMO Investigating; control/verify
  ["loop", ["dret", "fwin"]], // SUMO ComputerProgram; repeated iterations
  ["concatenate", ["hl6n", "jren"]], // SUMO Attaching; join in sequence
  ["ratify", ["ksap", "pfis"]], // SUMO SigningADocument; approve and assent
  ["cut", ["krot"]], // SUMO Cutting; cutting (atom)
  ["evoke", ["hvik"]], // Process; evoke or provoke to appear
  ["search", ["tsoc"]], // Investigating; searching (atom)
  ["stop", ["hzot", "tsit"]], // Keeping; cause to end
  ["divide", ["syap", "krot"]], // Calculating; perform a division
  ["export", ["hfat", "sroc"]], // Exporting; transfer data out of a document
  ["exists", ["psit", "hlaf"]], // cooccur; state or fact of existing
  ["status", ["hmac", "ksac"]], // Attribute; state at a particular time
  ["wait", ["tyuc"]], // Motion; act of waiting
  ["depart", ["cwas", "bxan"]], // Leaving; depart for someplace
  ["continue", ["pwic", "hxac"]], // Process; continue after an interruption
  ["android", ["hjat", "ryop"]], // Machine; automaton resembling a human
  ["glide", ["kyoc", "gvet"]], // Motion; move silently and smoothly
  ["scroll", ["hvap"]], // HorizontalWindowScrolling; move through a document
  ["identify", ["krip", "hdif"]], // Classifying; identifying characteristics
  ["observe", ["hzi7n", "tcen"]], // Looking; watch attentively
  ["send", ["kcap", "hfat"]], // Directing; cause something to go
  ["crescent", ["hre2c"]], // ShapeAttribute; resembling the new moon
  ["headquarters", ["drok"]] // Organization; installation a commander uses
]);

/** The chosen spelling sequence for a verb surface, or null when unspecified. */
export function defaultVerbSpelling(surface) {
  const key = String(surface ?? "").trim().toLowerCase();
  if (!key) return null;
  return DEFAULT_VERB_SPELLING.get(key) ?? null;
}
