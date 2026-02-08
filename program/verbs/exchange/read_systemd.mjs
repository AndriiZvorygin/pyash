import fs from "node:fs/promises";

import { throwErrorSentence } from "../../error.mjs";
import { doRemember } from "../../remember/index.mjs";
import { parseSystemdIniToSections } from "../../agent/service_definition.mjs";

function textValue(values = []) {
  const arr = Array.isArray(values) ? values : [values];
  const clean = arr.map(value => String(value ?? ""));
  if (clean.length <= 1) return { text: clean[0] ?? "" };
  return { ve: { type: "text", values: clean } };
}

function sectionMapFromIniSection(section = {}) {
  const map = {};
  for (const [key, values] of Object.entries(section)) {
    map[key] = textValue(values);
  }
  return map;
}

export async function read_fromstate_systemd(sentence) {
  const source = "read systemd";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;

  if (sourceFilename) {
    try {
      sourceText = await fs.readFile(sourceFilename, "utf8");
    } catch (err) {
      throwErrorSentence({
        name: "systemd lost",
        message: "systemd lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "systemd defective",
      message: "systemd defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "systemd";
  const unitName = `${targetName} unit`;
  const serviceName = `${targetName} service`;
  const installName = `${targetName} install`;
  const sections = parseSystemdIniToSections(sourceText);

  doRemember({
    mood: "ya",
    su: { name: unitName },
    be: "json map",
    ob: { map: sectionMapFromIniSection(sections.Unit ?? {}) }
  });
  doRemember({
    mood: "ya",
    su: { name: serviceName },
    be: "json map",
    ob: { map: sectionMapFromIniSection(sections.Service ?? {}) }
  });
  doRemember({
    mood: "ya",
    su: { name: installName },
    be: "json map",
    ob: { map: sectionMapFromIniSection(sections.Install ?? {}) }
  });

  const wrapperMap = {
    unit: { mood: "ya", su: { name: "unit" }, ob: { name: unitName }, be: "json map" },
    service: { mood: "ya", su: { name: "service" }, ob: { name: serviceName }, be: "json map" },
    install: { mood: "ya", su: { name: "install" }, ob: { name: installName }, be: "json map" }
  };

  const wrapper = {
    mood: "ya",
    su: { name: targetName },
    be: "map",
    ob: { map: wrapperMap }
  };
  doRemember(wrapper);
  return { ob: { map: wrapperMap }, be: "map" };
}

