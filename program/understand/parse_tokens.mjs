import {
  ROLE_KEYS,
  TYPE_TOKENS,
  CONTEXT_KEYS,
  AXIS_CONTEXT_TO_KEYWORD,
  MOODS,
  COMPOSITIONAL_ALIASES
} from "../library/grammar/keywords.mjs";
import { QUOTED_PLACEHOLDER, QUOTED_TEXT_PREFIX } from "./constants.mjs";
import { tokenize } from "./tokenize.mjs";
import { UNIT_TYPE_ALIASES, parseAllEnumeration, parseClause } from "./parse_tokens_helpers.mjs";

export function parseTokens(tokens, { allowMoodless = false, quotedText = null } = {}) {
  if (tokens.length === 0) return null;
  let mood = null;
  let words = tokens;
  let appendMoodToThen = true;
  if (allowMoodless) {
    const maybeMood = tokens.at(-1);
    if (MOODS.includes(maybeMood)) {
      mood = maybeMood;
      words = tokens.slice(0, -1);
    }
  } else {
    const last = tokens.at(-1);
    const hasThen = tokens.includes("then");
    if (last === "ret" && hasThen) {
      mood = "do";
      words = tokens;
      appendMoodToThen = false;
    } else {
      mood = last;
      words = tokens.slice(0, -1);
    }
  }

  if (!allowMoodless && mood) {
    const elseIndex = words.findIndex((token) => token === "else");
    if (elseIndex > 0) {
      const altStart = words[elseIndex + 1] === "if" ? elseIndex + 2 : elseIndex + 1;
      const mainTokens = [...words.slice(0, elseIndex), mood];
      const altTokens = [...words.slice(altStart), mood];
      if (mainTokens.length > 1 && altTokens.length > 1) {
        const primary = parseTokens(mainTokens, { allowMoodless: false, quotedText });
        const alternative = parseTokens(altTokens, { allowMoodless: false, quotedText });
        if (primary && alternative) {
          primary.alternative = alternative;
          return primary;
        }
      }
    }
  }

  const s = {};
  if (mood) s.mood = mood;
  let current = null;
  let slot = null;
  let vyahValues = null;
  const isQuotedTextToken = (token) => token.startsWith(QUOTED_TEXT_PREFIX);
  const decodeQuotedTextToken = (token) => token.slice(QUOTED_TEXT_PREFIX.length);
  const tokenValue = (token) => {
    if (isQuotedTextToken(token)) return decodeQuotedTextToken(token);
    if (token === QUOTED_PLACEHOLDER && quotedText !== null) return quotedText;
    return token;
  };

  const parseAllEnumerationBound = (startIdx) => parseAllEnumeration(words, startIdx, { ROLE_KEYS, CONTEXT_KEYS });
  const parseClauseBound = (startIdx) => parseClause(words, startIdx, { parseTokens, quotedText });
  const boundaryTokens = new Set([...ROLE_KEYS, ...CONTEXT_KEYS, "be", "then", "else", "ta", "ret"]);

  const parseGenitiveChain = (startIdx, { reverse = true } = {}) => {
    const next = words[startIdx + 1];
    if (next !== "of" && next !== "ti") return null;

    const readNode = (idx) => {
      const parts = [];
      let j = idx;
      while (j < words.length) {
        const tok = words[j];
        if (tok === "of" || tok === "ti") break;
        if (boundaryTokens.has(tok)) {
          if (parts.length === 0 && tok !== "be" && tok !== "then" && tok !== "ta" && tok !== "ret") {
            parts.push(tokenValue(tok));
            j += 1;
          }
          break;
        }
        parts.push(tokenValue(tok));
        j += 1;
      }
      if (parts.length === 0) return null;
      return { value: parts.join(" "), endIndex: j };
    };

    const chain = [tokenValue(words[startIdx])];
    let j = startIdx + 1;
    while (j < words.length && (words[j] === "of" || words[j] === "ti")) {
      const node = readNode(j + 1);
      if (!node) break;
      chain.push(node.value);
      j = node.endIndex;
    }

    if (chain.length <= 1) return null;
    const ordered = reverse ? chain.slice().reverse() : chain;
    return { chain: ordered, endIndex: j - 1 };
  };

  for (let i = 0; i < words.length; i++) {
    let t = words[i];
    if (COMPOSITIONAL_ALIASES[t]) {
      t = COMPOSITIONAL_ALIASES[t];
    }

    if (isQuotedTextToken(t)) {
      const value = decodeQuotedTextToken(t);
      if (current) {
        s[current].text = value;
      } else {
        s.text = value;
      }
      continue;
    }

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
      if (mood && appendMoodToThen) subTokens.push(mood);
      const subline = subTokens.join(" ");
      s.consequence = parse(subline);
      break;
    }

    if (t === "la") {
      const parsed = parseClauseBound(i);
      if (parsed) {
        const target = slot || (current ? s[current] : null);
        if (target) {
          target.la = parsed.clause;
        } else {
          s.la = parsed.clause;
        }
        i = parsed.endIndex;
        continue;
      }
    }

    if (t === "all") {
      const parsed = parseAllEnumerationBound(i);
      if (parsed) {
        s.ob = { genitive: { chain: parsed.chain } };
        i = parsed.endIndex - 1;
        continue;
      }
    }

    if (current === "vyah") {
      const isBoundary =
        ROLE_KEYS.includes(t) ||
        CONTEXT_KEYS.includes(t) ||
        t === "be" ||
        t === "then" ||
        t === "else" ||
        t === "ta" ||
        t === "ret";
      if (!isBoundary) {
        const value = tokenValue(t);
        vyahValues = vyahValues ?? [];
        vyahValues.push(value);
        if (s.vyah?.ve) s.vyah.ve.values = vyahValues;
        continue;
      }
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
      const nextNext = words[i + 2];
      const startsGenitive =
        nextNext && (nextNext === "of" || nextNext === "ti");
      if (
        next &&
        !ROLE_KEYS.includes(next) &&
        !["be", "then", "else", "ta"].includes(next) &&
        !TYPE_TOKENS.includes(next) &&
        !startsGenitive
      ) {
        slot.name = tokenValue(next);
        i++; // consume the name token
        if (t === "state" && slot.name === "beautiful") {
          const nextState = words[i + 1];
          if (
            nextState &&
            !ROLE_KEYS.includes(nextState) &&
            !["be", "then", "else", "ta"].includes(nextState) &&
            !TYPE_TOKENS.includes(nextState)
          ) {
            slot.text = slot.name;
            slot.name = tokenValue(nextState);
            i++; // consume the secondary state token
          }
        }
      }

      continue;
    }

    if (ROLE_KEYS.includes(t)) {
      const normalized =
        t === "su" || t === "subj" ? "su" :
        t === "ob" || t === "obj" ? "ob" :
        t;
      current = normalized;
      if (!s[current]) s[current] = {};
      slot = Array.isArray(s[current]) ? s[current][s[current].length - 1] : s[current];
      if (current === "vyah") {
        slot.ve = slot.ve ?? { type: "name", values: [] };
        vyahValues = slot.ve.values;
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
      const genitive = parseGenitiveChain(i);
      if (genitive) {
        slot.genitive = { chain: genitive.chain };
        i = genitive.endIndex;
        continue;
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
        !["be", "then", "else", "ta", "ret"].includes(words[j])
      ) {
        const token = tokenValue(words[j]);
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
      const genitive = parseGenitiveChain(i);
      if (genitive) {
        slot.genitive = { chain: genitive.chain };
        i = genitive.endIndex;
        continue;
      }

      const target = slot || (current ? s[current] : null);
      if (!target) continue;

      if (t === "name") {
        const nameTypeTokens = [
          "num",
          "number",
          "text",
          "filename",
          "vec",
          "ve",
          "bool",
          "boolean",
          "date",
          "map",
          "series"
        ];
        const parts = [];
        let j = i + 1;
        const nameTypeWords = [];

        const isBoundary = (token) =>
          ROLE_KEYS.includes(token) ||
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
          parts.push(tokenValue(look));
          j++;
        }
        const nameValue = parts.join(" ");
        if (nameValue) target.name = nameValue;
        if (nameTypeWords.length > 0) target.nameTypeWords = nameTypeWords;
        i = j - 1;
      } else if (t === "ord") {
        const raw = words[i + 1];
        const value = tokenValue(raw);
        const maybeNum = Number(value);
        const ordIndex = Number.isNaN(maybeNum) ? null : Math.max(0, Math.trunc(maybeNum) - 1);
        target.num = ordIndex ?? value;
        i++; // skip consumed value
      } else if (t === "bool" || t === "boolean") {
        const raw = words[i + 1];
        const value = tokenValue(raw);
        if (value === "truth" || value === "true" || value === "1") target.boolean = true;
        else if (value === "lie" || value === "false" || value === "0") target.boolean = false;
        else target.boolean = Boolean(value);
        i++; // skip the value we just consumed
      } else if (t === "date") {
        const raw = words[i + 1];
        const value = tokenValue(raw);
        target.date = value;
        i++;
      } else if (t === "month" || t === "months" || t === "second" || t === "seconds" || t === "minute" || t === "minutes" || t === "hour" || t === "hours" || t === "day" || t === "days" || t === "week" || t === "weeks" || t === "line" || t === "lines" || t === "byte" || t === "bytes") {
        const raw = words[i + 1];
        const value = tokenValue(raw);
        const unit = UNIT_TYPE_ALIASES[t] ?? t;
        const maybeNum = Number(value);
        target[unit] = Number.isNaN(maybeNum) ? value : maybeNum;
        i++;
      } else {
        if (t === "filename" && (words[i + 1] === "of" || words[i + 1] === "ti")) {
          const chain = [t];
          let j = i + 1;
          while (j < words.length && (words[j] === "of" || words[j] === "ti")) {
            const next = words[j + 1];
            if (!next) break;
            chain.push(next);
            j += 2;
          }
          const ordered = chain.slice().reverse();
          target.genitive = { chain: ordered };
          i = j - 1;
        } else if (t === "wo") {
          const parts = [];
          let j = i + 1;
          const isBoundary = (token) =>
          ROLE_KEYS.includes(token) ||
          CONTEXT_KEYS.includes(token) ||
          token === "be" ||
          token === "then" ||
          token === "else" ||
          token === "ta" ||
          token === "ret";
          while (j < words.length) {
            const look = words[j];
            if (isBoundary(look)) break;
            parts.push(tokenValue(look));
            j++;
          }
          const value = parts.join(" ");
          if (value) {
            target.text = value;
            target.wo = value;
          }
          i = j - 1;
        } else {
          const raw = words[i + 1];
          const value = tokenValue(raw);
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
      }

      continue;
    }

    // Forward root-first genitive starting with "this" (e.g., "this ti ob ti num")
    if (t === "this" && words[i + 1] === "ti") {
      const forward = parseGenitiveChain(i, { reverse: false });
      if (forward) {
        slot = slot || (current ? s[current] : null);
        if (slot) {
          slot.genitive = { chain: forward.chain };
          i = forward.endIndex;
          continue;
        }
      }
    }

    // --- bare value after a role defaults to name ---
    if (current) {
      const genitive = parseGenitiveChain(i);
      if (genitive) {
        slot = slot || (current ? s[current] : null);
        if (slot) {
          slot.genitive = { chain: genitive.chain };
          i = genitive.endIndex;
          continue;
        }
      }
    }

    if (current && slot && t === "unspecified") {
      slot.unspecified = true;
      continue;
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
          look === "else" ||
          look === "ta" ||
          look === "be"; // unlikely consecutive be, but stop
        if (isBoundary) break;
        parts.push(tokenValue(look));
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
  return parseTokens(tokens, { allowMoodless: false, quotedText });
}
