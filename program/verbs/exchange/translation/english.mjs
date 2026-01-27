function sentenceToEnglish(sentence) {
  const su = sentence.su?.name;
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "something";

  // Conditional
  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : ob.name ?? "lhs";
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : sentence.from?.name ?? "rhs";
    const consequence = sentenceToEnglish(sentence.consequence);
    return `if ${lhs} is ${beLabel} from ${rhs} then ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const verb = beLabel;
    const targetTo = sentence.to?.name;
    const targetFrom = sentence.from?.name;
    const targetWith = sentence.with?.name;
    const targetFilename = sentence.from?.filename;
    const targetRead = sentence.from?.name;
    const nameVal = sentence.ob?.name;
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `write "${textVal}" to ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `write "${textVal}".`;
    }
    if (verb === "write" && nameVal) {
      return `write ${nameVal}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `say "${textVal}".`;
    }
    if (verb === "read" && targetFilename) {
      return `read file ${targetFilename}.`;
    }
    if (verb === "read" && targetRead) {
      return `read ${targetRead}.`;
    }
    if (numVal !== undefined && targetTo) {
      return `do ${verb} ${numVal} to ${targetTo}.`;
    }
    if (numVal !== undefined && targetFrom) {
      return `do ${verb} ${numVal} from ${targetFrom}.`;
    }
    if (textVal !== undefined && targetTo) {
      return `do ${verb} "${textVal}" to ${targetTo}.`;
    }
    return `do ${verb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.num !== undefined) {
    return `${su} is ${beLabel} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    return `${su} is ${beLabel} "${ob.text}".`;
  }

  if (ob.ve !== undefined) {
    const values = Array.isArray(ob.ve.values) ? ob.ve.values : [];
    const type = ob.ve.type || "num";
    const rendered = values.map((value) => {
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "truth" : "lie";
      if (typeof value === "string") {
        if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
        return JSON.stringify(value);
      }
      return String(value);
    });
    return `${su} is vector ${["ve", type, ...rendered].join(" ")}.`;
  }

  return `${su} is ${beLabel}`;
}

function englishLineToSentence(line) {
  const trimmed = line.trim();

  // Conditional: "if 3 is tiny from 5 then do add 1 to total."
  const condMatch = trimmed.match(/^if\s+(.+?)\s+is\s+(tiny|giant|equally)\s+(?:from\s+)?(.+?)\s+then\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmp, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const consequence = englishLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp.toLowerCase(),
      ob,
      from,
      consequence
    };
  }

  // Imperative form (no "do"): "add 2 to collector"
  const addMatch = trimmed.match(/^(add|subtract)\s+([0-9.+-]+)\s+(to|from)\s+([A-Za-z0-9_]+)\.?$/i);
  if (addMatch) {
    const [, verb, numRaw, dir, target] = addMatch;
    const cleanNum = numRaw.replace(/\.$/, "");
    const n = Number(cleanNum);
    const ob = { num: Number.isNaN(n) ? cleanNum : n };
    const sentence = {
      mood: "do",
      be: verb.toLowerCase() === "add" ? "plus" : "subtract",
      ob,
    };
    if (dir.toLowerCase() === "to") {
      sentence.to = { name: target };
    } else {
      sentence.from = { name: target };
    }
    return sentence;
  }

  // Imperative form (no "do"): "multiply total by 2"
  const multiplyMatch = trimmed.match(/^(multiply|divide)\s+([A-Za-z0-9_]+)\s+by\s+([0-9.+-]+)\.?$/i);
  if (multiplyMatch) {
    const [, verb, target, numRaw] = multiplyMatch;
    const cleanNum = numRaw.replace(/\.$/, "");
    const n = Number(cleanNum);
    return {
      mood: "do",
      be: verb.toLowerCase(),
      ob: { num: Number.isNaN(n) ? cleanNum : n },
      with: { name: target }
    };
  }

  // Imperative form (no "do"): "remainder of 10 by 3 to rem"
  const remainsMatch = trimmed.match(/^remainder\s+of\s+([0-9.+-]+)\s+by\s+([0-9.+-]+)\s+to\s+([A-Za-z0-9_]+)\.?$/i);
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: target }
    };
  }

  // Imperative form (no "do"): "write \"hi\" to output"
  const writeTextMatch = trimmed.match(/^write\s+\"([^\"]*)\"\s+to\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: target }
    };
  }

  // Imperative form (no "do"): "write \"hi\""
  const writeTextSoloMatch = trimmed.match(/^write\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  // Imperative form (no "do"): "write output"
  const writeNameMatch = trimmed.match(/^write\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name }
    };
  }

  // Imperative form (no "do"): "say \"hi\""
  const sayMatch = trimmed.match(/^say\s+\"([^\"]*)\"\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  // Imperative form (no "do"): "read file path"
  const readFileMatch = trimmed.match(/^read\s+file\s+(.+?)\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  // Imperative form (no "do"): "read input"
  const readMatch = trimmed.match(/^read\s+([A-Za-z0-9_]+)\.?$/i);
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name }
    };
  }

  // Imperative form: "do subtract 2 from collector"
  const doMatch = trimmed.match(/^do ([A-Za-z0-9_]+) ([0-9.+-]+) (to|from) ([A-Za-z0-9_]+)\.?$/i);
  if (doMatch) {
    const [, verb, numRaw, dir, target] = doMatch;
    const cleanNum = numRaw.replace(/\.$/, "");
    const n = Number(cleanNum);
    const ob = { num: Number.isNaN(n) ? cleanNum : n };
    const sentence = {
      mood: "do",
      be: verb.toLowerCase(),
      ob,
    };
    if (dir.toLowerCase() === "to") {
      sentence.to = { name: target };
    } else {
      sentence.from = { name: target };
    }
    return sentence;
  }

  // Imperative form: "do write \"hi\" to output"
  const doWriteMatch = trimmed.match(/^do write \"([^\"]*)\" to ([A-Za-z0-9_]+)\.?$/i);
  if (doWriteMatch) {
    const [, text, target] = doWriteMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: target }
    };
  }

  // Expect format: "<name> is <be> <value>."
  const match = trimmed.match(/^([A-Za-z0-9_]+) is ([A-Za-z0-9_ ]+?)(?: "([^"]*)")?(?: ([0-9.+-]+))?\.?$/);
  if (!match) return null;

  const [, name, bePart, textVal, numVal] = match;
  const be = bePart.trim();
  const sentence = { mood: "ya", su: { name }, be };

  if (textVal !== undefined) {
    sentence.ob = { text: textVal };
  } else if (numVal !== undefined) {
    const clean = numVal.replace(/\.$/, "");
    const n = Number(clean);
    sentence.ob = { num: Number.isNaN(n) ? numVal : n };
  }

  return sentence;
}

export { sentenceToEnglish, englishLineToSentence };
