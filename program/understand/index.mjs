// parser.mjs
const QUOTED_PLACEHOLDER = "__QUOTED_BLOCK__";
const ROLE_KEYS = ["subj", "su", "obj", "ob", "to", "from", "fromstate", "with", "via", "tloh", "until", "by", "per"];
const TYPE_TOKENS = ["name", "num", "number", "text", "filename"];
const CONTEXT_KEYS = ["space", "interior", "surface", "under", "time", "state", "person", "social", "discourse", "quantity"];
const AXIS_CONTEXT_TO_KEYWORD = {
  space: { source: "from", way: "at", destination: "to" },
  interior: { source: "outof", way: "inside", destination: "into" },
  surface: { source: "offof", way: "along", destination: "onto" },
  under: { source: "fromunder", way: "under", destination: "beneath" },
  time: { source: "since", way: "during", destination: "until" },
  state: { source: "fromstate", way: "as", destination: "become" },
  person: { source: "fromperson", way: "with", destination: "for" },
  social: { source: "fromgroup", way: "among", destination: "intogroup" },
  discourse: { source: "fromtext", way: "accordingto", destination: "totext" },
  quantity: { source: "tloh", way: "by", destination: "per" }
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
        s[current] = s[current] ?? {};
        slot = s[current];
        if (origRole !== current) {
          delete s[origRole];
        }
      } else {
        // Fallback: keep original role if no keyword found
        s[current] = s[current] ?? {};
        slot = s[current];
      }

      const next = words[i + 1];
      if (
        next &&
        !ROLE_KEYS.includes(next) &&
        !["be", "then", "ta"].includes(next) &&
        !TYPE_TOKENS.includes(next)
      ) {
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

    // ret target, e.g., "this obj name acc ret"
    if (mood === "ret" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      current = "ret";
      s.ret = { role: words[i + 1] };
      slot = s.ret;
      i++; // consume role token
      continue;
    }

    // this reference inside a role, e.g., "obj this obj ..."
    if (current === "obj" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      slot.thisRef = words[i + 1];
      i++; // consume role token
      continue;
    }

    if (t === "ve" || t === "vec") {
      const elemType = words[i + 1];
      if (!elemType) continue;
      const vector = { type: elemType, values: [] };
      let j = i + 2;
      while (
        j < words.length &&
        !ROLE_KEYS.includes(words[j]) &&
        !CONTEXT_KEYS.includes(words[j]) &&
        !["be", "then", "ta", "ret"].includes(words[j])
      ) {
        const token = words[j];
        if (elemType === "num" || elemType === "number") {
          const num = Number(token);
          vector.values.push(Number.isNaN(num) ? token : num);
        } else {
          vector.values.push(token);
        }
        j++;
      }

      const target = slot || (current ? s[current] : null);
      if (target) {
        target.ve = vector;
      }

      i = j - 1;
      continue;
    }

    // --- type tokens: name / num / number / text / filename ---
    if (TYPE_TOKENS.includes(t)) {
      const target = slot || (current ? s[current] : null);
      if (!target) continue;

      if (t === "name") {
        const parts = [];
        let j = i + 1;
        while (j < words.length) {
          const look = words[j];
          const isBoundary =
            ROLE_KEYS.includes(look) ||
            CONTEXT_KEYS.includes(look) ||
            look === "be" ||
            look === "then" ||
            look === "ta" ||
            look === "ret";
          if (isBoundary) break;
          parts.push(look === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : look);
          j++;
        }
        const nameValue = parts.join(" ");
        if (nameValue) target.name = nameValue;
        i = j - 1;
      } else {
        const raw = words[i + 1];
        const value = raw === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : raw;
        const maybeNum = Number(value);
        if (t === "text") {
          target.text = value;
        } else if (t === "filename") {
          target.filename = value;
        } else {
          // num / number → numeric
          target.num = isNaN(maybeNum) ? value : maybeNum;
        }
        i++; // skip the value we just consumed
      }

      continue;
    }

    // --- bare value after a role defaults to name ---
    if (current && slot && Object.keys(slot).length === 0) {
      slot.name = t;
      continue;
    }

    if (t === "be") {
      const parts = [];
      let j = i + 1;
      while (j < words.length) {
        const look = words[j];
        const isBoundary =
          ROLE_KEYS.includes(look) ||
          CONTEXT_KEYS.includes(look) ||
          look === "then" ||
          look === "ta" ||
          look === "be"; // unlikely consecutive be, but stop
        if (isBoundary) break;
        parts.push(look === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : look);
        j++;
      }
      s.be = parts.join(" ");
      i = j - 1; // skip consumed tokens
      continue;
    }

    // Track this-reference inside obj context, e.g., "obj this obj ..."
    if (current === "obj" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      slot.thisRef = words[i + 1];
      i++; // consume role token
      continue;
    }
  }

  return s;
}
