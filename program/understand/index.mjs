// parser.mjs
const QUOTED_PLACEHOLDER = "__QUOTED_BLOCK__";
const ROLE_KEYS = ["su", "subj", "ob", "obj", "to", "from", "fromstate", "with", "via", "times", "by", "per", "at", "fromindex", "atindex", "toindex"];
const TYPE_TOKENS = ["name", "num", "number", "text", "filename", "bool", "boolean", "ord"];
const CONTEXT_KEYS = ["space", "interior", "surface", "under", "time", "state", "person", "social", "discourse", "quantity", "sequence"];
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
  quantity: { source: "times", way: "by", destination: "per" },
  sequence: { source: "fromindex", way: "atindex", destination: "toindex" }
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

    if (t === "exists") {
      s.exists = true;
      if (slot) slot.exists = true;
      continue;
    }

    // --- topic sugar: "ta loop_head be topic ya" ---
    // sugar for: su name loop_head be topic ya
    if (t === "ta") {
      const name = words[++i];
      s.su = { name };
      continue;
    }

    if (t === "then") {
      // (currently unused because 'then' is the mood word,
      //  but we can keep this for future nested clauses)
      const subTokens = words.slice(i + 1);
      // Re-attach the mood token so nested clauses retain their own mood word
      if (mood) subTokens.push(mood);
      const subline = subTokens.join(" ");
      s.consequence = parse(subline);
      break;
    }

    if (ROLE_KEYS.includes(t)) {
      const normalized =
        t === "su" || t === "subj" ? "su" :
        t === "ob" || t === "obj" ? "ob" :
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
          const origValue = s[origRole];
          if (origValue && Object.keys(origValue).length === 0) {
            delete s[origRole];
          }
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
        if (t === "state" && slot.name === "beautiful") {
          const nextState = words[i + 1];
          if (
            nextState &&
            !ROLE_KEYS.includes(nextState) &&
            !["be", "then", "ta"].includes(nextState) &&
            !TYPE_TOKENS.includes(nextState)
          ) {
            slot.text = slot.name;
            slot.name = nextState;
            i++; // consume the secondary state token
          }
        }
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
    // "ob what que" ⇒ ob: { name: "what" }
    if (t === "what" && current === "ob") {
      s.ob = { name: "what" };
      continue;
    }

    // ret target, e.g., "this ob name acc ret"
    if (mood === "ret" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      current = "ret";
      s.ret = { role: words[i + 1] };
      slot = s.ret;
      i++; // consume role token
      continue;
    }

    // this reference inside a role, e.g., "ob this ob ..."
    if (current === "ob" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      slot.thisRef = words[i + 1];
      i++; // consume role token
      continue;
    }

    if (t === "ve" || t === "vec") {
      if (words[i + 1] === "of" || words[i + 1] === "ti") {
        const chain = [t];
        let j = i + 1;
        while (j < words.length && (words[j] === "of" || words[j] === "ti")) {
          const next = words[j + 1];
          if (!next) break;
          chain.push(next);
          j += 2;
        }
        if (chain.length > 1) {
          const ordered = chain.slice().reverse(); // store root-first
          slot.genitive = { chain: ordered };
          i = j - 1;
          continue;
        }
      }

      const elemType = words[i + 1];
      if (!elemType) continue;
      const vector = { type: elemType, values: [] };
      if (elemType === "hollow") {
        const target = slot || (current ? s[current] : null);
        if (target) {
          target.ve = vector;
        }
        i = i + 1;
        continue;
      }
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
        } else if (elemType === "bool" || elemType === "boolean") {
          if (token === "truth" || token === "true" || token === "1") vector.values.push("truth");
          else if (token === "lie" || token === "false" || token === "0") vector.values.push("lie");
          else vector.values.push(token);
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
      // Genitive chains:
      //   backward: "num of ob of this"   => chain ["this","ob","num"]
      //   forward:  "num ti ob ti this"   => chain ["this","ob","num"]
      if (words[i + 1] === "of" || words[i + 1] === "ti") {
        const chain = [t];
        let j = i + 1;
        while (j < words.length && (words[j] === "of" || words[j] === "ti")) {
          const next = words[j + 1];
          if (!next) break;
          chain.push(next);
          j += 2;
        }
        if (chain.length > 1) {
          const ordered = chain.slice().reverse(); // store root-first
          slot.genitive = { chain: ordered };
          i = j - 1;
          continue;
        }
      }

      const target = slot || (current ? s[current] : null);
      if (!target) continue;

      if (t === "name") {
        const nameTypeTokens = ["num", "number", "text", "filename", "vec", "ve", "bool", "boolean"];
        const parts = [];
        let j = i + 1;
        const nameTypeWords = [];

        const isBoundary = (token) =>
          ROLE_KEYS.includes(token) ||
          CONTEXT_KEYS.includes(token) ||
          token === "be" ||
          token === "then" ||
          token === "ta" ||
          token === "ret";

        if (nameTypeTokens.includes(words[j])) {
          let k = j;
          const temp = [];
          let token = words[k];
          if (token === "number") token = "num";
          if (token === "boolean") token = "bool";
          if (token === "vec" || token === "ve") {
            temp.push("vec");
            k += 1;
            const elem = words[k];
            if (elem && (elem === "num" || elem === "number" || elem === "text" || elem === "bool" || elem === "boolean")) {
              temp.push(elem === "number" ? "num" : (elem === "boolean" ? "bool" : elem));
              k += 1;
            }
          } else {
            temp.push(token);
            k += 1;
          }
          if (k < words.length && !isBoundary(words[k])) {
            nameTypeWords.push(...temp);
            j = k;
          }
        }
        while (j < words.length) {
          const look = words[j];
          if (isBoundary(look)) break;
          parts.push(look === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : look);
          j++;
        }
        const nameValue = parts.join(" ");
        if (nameValue) target.name = nameValue;
        if (nameTypeWords.length > 0) target.nameTypeWords = nameTypeWords;
        i = j - 1;
      } else if (t === "ord") {
        const raw = words[i + 1];
        const value = raw === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : raw;
        const maybeNum = Number(value);
        const ordIndex = Number.isNaN(maybeNum) ? null : Math.max(0, Math.trunc(maybeNum) - 1);
        target.num = ordIndex ?? value;
        i++; // skip consumed value
      } else if (t === "bool" || t === "boolean") {
        const raw = words[i + 1];
        const value = raw === QUOTED_PLACEHOLDER && quotedText !== null ? quotedText : raw;
        if (value === "truth" || value === "true" || value === "1") target.boolean = true;
        else if (value === "lie" || value === "false" || value === "0") target.boolean = false;
        else target.boolean = Boolean(value);
        i++; // skip the value we just consumed
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

    // Forward root-first genitive starting with "this" (e.g., "this ti ob ti num")
    if (t === "this" && words[i + 1] === "ti") {
      const chain = [t];
      let j = i + 1;
      while (j < words.length && words[j] === "ti") {
        const next = words[j + 1];
        if (!next) break;
        chain.push(next);
        j += 2;
      }
      if (chain.length > 1) {
        slot = slot || (current ? s[current] : null);
        if (slot) {
          slot.genitive = { chain };
          i = j - 1;
          continue;
        }
      }
    }

    // --- bare value after a role defaults to name ---
    if (current && (words[i + 1] === "of" || words[i + 1] === "ti")) {
      const chain = [t];
      let j = i + 1;
      while (j < words.length && (words[j] === "of" || words[j] === "ti")) {
        const next = words[j + 1];
        if (!next) break;
        chain.push(next);
        j += 2;
      }
      if (chain.length > 1) {
        slot = slot || (current ? s[current] : null);
        if (slot) {
          slot.genitive = { chain: chain.slice().reverse() };
          i = j - 1;
          continue;
        }
      }
    }

    if (current && slot && t === "hollow") {
      slot.hollow = true;
      continue;
    }

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

    // Track this-reference inside ob context, e.g., "ob this ob ..."
    if (current === "ob" && t === "this" && words[i + 1] && ROLE_KEYS.includes(words[i + 1])) {
      slot.thisRef = words[i + 1];
      i++; // consume role token
      continue;
    }
  }

  return s;
}
