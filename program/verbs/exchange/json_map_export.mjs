import { throwErrorSentence } from "../../error.mjs";

export function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

export function jsonValueFromObj(ob, { remember, seen, sourceName, allowHollowVector = false } = {}) {
  if (!ob || (typeof ob === "object" && Object.keys(ob).length === 0)) return undefined;
  if (ob.unspecified) return undefined;
  if (ob.hollow) return null;
  if (ob.text !== undefined) return ob.text;
  if (ob.num !== undefined) return ob.num;
  if (ob.boolean !== undefined) return ob.boolean;
  if (ob.ve) {
    const type = ob.ve.type || "num";
    if (type === "hollow") {
      if (allowHollowVector) return [];
      throwErrorSentence({
        name: "json map contents defective",
        message: "json map contents defective: unsupported vector type hollow",
        from: { name: sourceName },
        raw: { type }
      });
    }
    if (type === "name") {
      return ob.ve.values.map((name) => jsonObjectFromMapName(name, { remember, seen, sourceName, allowHollowVector }));
    }
    if (type === "bool" || type === "boolean") {
      return ob.ve.values.map((value) => value === "truth" || value === true || value === 1);
    }
    if (type === "num" || type === "number" || type === "text") return ob.ve.values;
    throwErrorSentence({
      name: "json map contents defective",
      message: `json map contents defective: unsupported vector type ${type}`,
      from: { name: sourceName },
      raw: { type }
    });
  }
  if (ob.name) return jsonObjectFromMapName(ob.name, { remember, seen, sourceName, allowHollowVector });
  throwErrorSentence({
    name: "json map contents defective",
    message: "json map contents defective: unsupported contents",
    from: { name: sourceName },
    raw: ob
  });
  return undefined;
}

export function jsonObjectFromMapName(name, { remember, seen, sourceName, allowHollowVector = false } = {}) {
  const fact = remember ? remember(name) : null;
  if (!fact || fact.be !== "json map") {
    throwErrorSentence({
      name: "json map referential defective",
      message: `json map referential defective: ${name}`,
      from: { name: sourceName },
      raw: { name }
    });
  }
  return jsonObjectFromMapSentence(fact, { remember, seen, sourceName, allowHollowVector });
}

export function jsonObjectFromMapSentence(mapSentence, { remember, seen, sourceName, allowHollowVector = false } = {}) {
  const mapName = mapSentence?.su?.name ?? "<map>";
  if (seen.has(mapName)) {
    throwErrorSentence({
      name: "json map export self referential",
      message: "json map export self referential",
      from: { name: sourceName },
      raw: { name: mapName }
    });
  }
  seen.add(mapName);
  const entries = mapSentence?.ob?.map ?? {};
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const jsonValue = jsonValueFromObj(value, { remember, seen, sourceName, allowHollowVector });
    if (jsonValue === undefined) continue;
    out[key] = jsonValue;
  }
  seen.delete(mapName);
  return out;
}
