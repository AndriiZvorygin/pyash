import { translateNameToRussian, translateTokenToRussian } from "./isv.mjs";

export function sentenceToRussian(sentence) {
  const su = translateNameToRussian(sentence.su?.name);
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "что-то";

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : translateNameToRussian(ob.name ?? "lhs");
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : translateNameToRussian(sentence.from?.name ?? "rhs");
    const consequence = sentenceToRussian(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "меньше"
      : beLabel === "giant"
        ? "больше"
        : "равно";
    return `если ${lhs} ${cmpLabel} ${rhs}, то ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const targetTo = translateNameToRussian(sentence.to?.name);
    const targetFrom = translateNameToRussian(sentence.from?.name);
    const targetWith = translateNameToRussian(sentence.with?.name);
    const verb = beLabel;
    const translatedVerb = translateTokenToRussian(beLabel);

    if (verb === "plus" && numVal !== undefined && targetTo) {
      return `прибавь ${numVal} к ${targetTo}.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `вычти ${numVal} из ${targetFrom}.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `умножь ${targetWith} на ${numVal}.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `раздели ${targetWith} на ${numVal}.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `остаток от ${numVal} по ${sentence.from.num} в ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `запиши \"${textVal}\" в ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `запиши \"${textVal}\".`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `запиши ${translateNameToRussian(sentence.ob.name)}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `скажи \"${textVal}\".`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `прочитай файл ${sentence.from.filename}.`;
    }
    if (verb === "read" && targetFrom) {
      return `прочитай ${targetFrom}.`;
    }
    return `сделай ${translatedVerb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} есть ${value ? "истина" : "ложь"}.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} есть число ${ob.num}.`;
    return `${su} есть ${beLabel} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} есть текст \"${ob.text}\".`;
    return `${su} есть ${beLabel} \"${ob.text}\".`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} есть дата ${ob.date}.`;
    return `${su} есть ${beLabel} ${ob.date}.`;
  }

  if (ob.ve !== undefined) {
    const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} есть вектор ${vecText}.` : `${su} есть вектор.`;
    return vecText ? `${su} есть ${beLabel} ${vecText}.` : `${su} есть ${beLabel}.`;
  }

  return `${su} есть ${beLabel}`;
}

export function renderVectorGloss(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
  const typeGloss = type === "text" ? "текст" : type === "bool" ? "булево" : "число";
  const values = Array.isArray(vec.values) ? vec.values : [];
  const rendered = values.map((value) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "truth" : "lie";
    if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
      return JSON.stringify(value);
    }
    return String(value);
  });
  return ["ве", typeGloss, ...rendered].join(" ");
}
