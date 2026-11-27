/**
 * The headings a teaching card carries.
 *
 * The full card is the house's teaching artifact: ten headings, every one of
 * them meant to be read by a learner. The radio card is a different thing —
 * it carries only the headings a song actually uses, so the card costs half
 * as much to write and the hymn has less to carry.
 *
 * The radio keeps: what the teaching is, the one line that can be sung back,
 * how it unfolds, what follows from what, the pictures it draws, and the short
 * phrases that can become a refrain.
 */
export const SCHEMA_HEADINGS = [
  "SEED CONCEPT",
  "CARDINAL TRAINING SENTENCE",
  "TEACHING PROGRESSION",
  "ORTHOGONAL FEATURES",
  "SURPRISES AND MISUNDERSTANDINGS",
  "AFFAIRS OR ACTIVITIES",
  "CAUSATIVE AND CONSEQUENCE",
  "CARDINAL SCENES AND IDIOMS",
  "BRIEF MEMORY PHRASES",
  "CONCEPT RELATIONS"
];

export const RADIO_HEADINGS = [
  "SEED CONCEPT",
  "CARDINAL TRAINING SENTENCE",
  "TEACHING PROGRESSION",
  "CAUSATIVE AND CONSEQUENCE",
  "CARDINAL SCENES AND IDIOMS",
  "BRIEF MEMORY PHRASES"
];

/**
 * The card depths the house knows. The depth names the headings a card
 * carries, so a caller can ask for the card a song needs without spelling
 * every heading out.
 */
export const CARD_DEPTHS = new Map([
  ["full", SCHEMA_HEADINGS],
  ["schema", SCHEMA_HEADINGS],
  ["radio", RADIO_HEADINGS]
]);

export const DEFAULT_CARD_DEPTH = "full";

/**
 * The headings of a card depth. An unknown depth is the full schema: the
 * house's own teaching card is the one that is always safe to write.
 */
export function headingsForDepth(depth) {
  const key = String(depth ?? "").trim().toLowerCase();
  const headings = CARD_DEPTHS.get(key);
  return headings ? [...headings] : [...SCHEMA_HEADINGS];
}

/**
 * The headings a command should work with. A `--headings` argument names
 * them: either a depth the house knows ("radio", "full") or the headings
 * themselves, comma separated. A heading the schema does not know is a
 * mistake, so an argument that names one falls back to the full schema
 * rather than quietly asking for a card that can never be written.
 */
export function headingsFromValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [...SCHEMA_HEADINGS];
  const profile = CARD_DEPTHS.get(raw.toLowerCase());
  if (profile) return [...profile];
  const headings = raw
    .split(",")
    .map((heading) => heading.trim().toUpperCase())
    .filter(Boolean);
  if (!headings.length) return [...SCHEMA_HEADINGS];
  if (headings.some((heading) => !SCHEMA_HEADINGS.includes(heading))) return [...SCHEMA_HEADINGS];
  return headings;
}

export function headingsFromArgument(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const index = args.findIndex((entry) => String(entry ?? "").trim() === "--headings");
  if (index < 0) return SCHEMA_HEADINGS;
  return headingsFromValue(args[index + 1] ?? "");
}

/**
 * The headings a card text carries, in the order they appear.
 */
export function headingsInText(text) {
  const found = [];
  for (const line of String(text ?? "").split("\n")) {
    const heading = line.trim().toUpperCase();
    if (SCHEMA_HEADINGS.includes(heading) && !found.includes(heading)) found.push(heading);
  }
  return found;
}

/**
 * Whether a card text is the card of a depth: it carries the depth's headings
 * and nothing else. A card of another depth is not the card that was asked
 * for, so it is not kept.
 */
export function cardMatchesDepth(text, depth) {
  const wanted = headingsForDepth(depth);
  const found = headingsInText(text);
  if (found.length !== wanted.length) return false;
  return wanted.every((heading) => found.includes(heading));
}

/**
 * The depth a set of headings belongs to, or nothing when the headings are
 * a set of their own.
 */
export function depthFromHeadings(headings = []) {
  const list = Array.isArray(headings) ? headings : [];
  for (const [depth, profile] of CARD_DEPTHS) {
    if (profile.length === list.length && profile.every((heading) => list.includes(heading))) {
      return depth;
    }
  }
  return "";
}
