// parser.mjs
const QUOTED_PLACEHOLDER = "__QUOTED_BLOCK__";
const ROLE_KEYS = ["subj", "su", "obj", "ob", "to", "from", "with", "via"];
const CONTEXT_KEYS = ["space", "interior", "surface", "under", "time", "state", "person", "social", "discourse"];
const AXIS_CONTEXT_TO_KEYWORD = {
  space: { source: "from", way: "at", destination: "to" },
  interior: { source: "outof", way: "inside", destination: "into" },
  surface: { source: "offof", way: "along", destination: "onto" },
  under: { source: "fromunder", way: "under", destination: "beneath" },
  time: { source: "since", way: "during", destination: "until" },
  state: { source: "fromstate", way: "via", destination: "become" },
  person: { source: "fromperson", way: "with", destination: "for" },
  social: { source: "fromgroup", way: "among", destination: "intogroup" },
  discourse: { source: "fromtext", way: "accordingto", destination: "astext" }
};
function tokenize(line) {
  const tokens = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuote) {
      if (ch === "\\" && i + 1 < line.length) {
        // allow escapes for quotes/backslashes inside text tokens
        const next = line[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i++;
          continue;
        }
      }

      if (ch === '"') {
        tokens.push(current);
        current = "";
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (current) {
        tokens.push(current);
        current = "";
      }
      inQuote = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function parse(line) {
  let quotedText = null;
  let working = line;

  const blockMatch = working.match(/quoted\.([^.]+)\.(?:contents\s*)?([\s\S]*?)\.\1\.quoted/);
  if (blockMatch) {
    quotedText = blockMatch[2];
    working = working.replace(blockMatch[0], ` ${QUOTED_PLACEHOLDER} `);
  }

  const tokens = tokenize(working.trim());
  if (tokens.length === 0) return null;

  const mood = tokens.at(-1);
  const words = tokens.slice(0, -1);
  const s = { mood };
  let current = null;
  let slot = null;

  for (let i = 0; i < words.length; i++) {
    const t = words[i];

    // --- topic sugar: "ta loop_head be topic ya" ---
    // sugar for: subj name loop_head be topic ya
    if (t === "ta") {
      const name = words[++i];
      s.subj = { name };
      continue;
    }

    if (t === "then") {
      // (currently unused because 'then' is the mood word,
      //  but we can keep this for future nested clauses)
      const subline = words.slice(i + 1).join(" ");
      s.consequence = parse(subline);
      break;
    }

    if (ROLE_KEYS.includes(t)) {
      const normalized =
        t === "su" ? "subj" :
        t === "ob" ? "obj" :
        t;
      current = normalized;
      if (!s[current]) s[current] = {};
      slot = Array.isArray(s[current]) ? s[current][s[current].length - 1] : s[current];
      continue;
    }

    // --- compositional context tokens, e.g., "from state draft" ---
    if (current && CONTEXT_KEYS.includes(t)) {
      const origRole = current;
      const axis =
        current === "from" ? "source" :
        current === "to" ? "destination" :
        (current === "via" || current === "with") ? "way" :
        null;

      const keyword = axis ? AXIS_CONTEXT_TO_KEYWORD[t]?.[axis] : null;

      if (keyword) {
        current = keyword;
        if (!s[current]) s[current] = {};
        slot = s[current];
        if (origRole !== current) {
          delete s[origRole];
        }
      } else {
        if (slot && slot.context && !Array.isArray(s[current])) {
          s[current] = [slot];
        }

        if (Array.isArray(s[current])) {
          slot = {};
          s[current].push(slot);
        } else {
          slot = s[current];
        }

        slot.context = t;
      }

      const next = words[i + 1];
      if (next && !ROLE_KEYS.includes(next) && !["be", "then", "ta"].includes(next)) {
        slot.name = next;
        i++; // consume the name token
      }

      continue;
    }

    if (t === QUOTED_PLACEHOLDER && quotedText !== null) {
      if (current) {
        s[current].text = quotedText;
      } else {
        s.text = quotedText;
      }
      continue;
    }

    // --- interrogative pronoun sugar ---
    // "obj what que" ⇒ obj: { name: "what" }
    if (t === "what" && current === "obj") {
      s.obj = { name: "what" };
      continue;
    }

    // --- type tokens: name / num / number / text / filename ---
    if (["name", "num", "number", "text", "filename"].includes(t)) {
      const raw = words[i + 1];
      const value = raw === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : raw;
      const maybeNum = Number(value);
      const target = slot || (current ? s[current] : null);
      if (!target) continue;

      if (t === "name") {
        target.name = value;
      } else if (t === "text") {
        target.text = value;
      } else if (t === "filename") {
        target.filename = value;
      } else {
        // num / number → numeric
        target.num = isNaN(maybeNum) ? value : maybeNum;
      }

      i++; // skip the value we just consumed
      continue;
    }

    // --- bare value after a role defaults to name ---
    if (current && slot && Object.keys(slot).length === 0) {
      slot.name = t;
      continue;
    }

    if (t === "be") {
      s.be = words[i + 1];
      i++; // skip verb; mood already taken from last token
      continue;
    }
  }

  return s;
}
