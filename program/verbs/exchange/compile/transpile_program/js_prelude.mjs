import { vectorFormatHelper } from "../../helpers_js.mjs";
import { mindHelperSource, mindHistorySource } from "../js/mind_runtime_helper.mjs";
import { mindToolHelperSource } from "../js/mind_tool_helper.mjs";
import { csvRuntimeHelper, exchangeRuntimeHelper, jsonRuntimeHelper, newspaperRuntimeHelper, yamlRuntimeHelper, yamlStringifyHelper } from "../js/runtime_helpers.mjs";
import { CSV_PARSE_RUNTIME_URL, YAML_RUNTIME_URL } from "../constants.mjs";
import { boolHelperSource } from "./js_helpers/bool_helper.mjs";
import { commandHelperSource } from "./js_helpers/command_helper.mjs";
import { csvMapHelperSource } from "./js_helpers/csv_map_helper.mjs";
import { dateHelperSource } from "./js_helpers/date_helper.mjs";
import { interpretHelperSource } from "./js_helpers/interpret_helper.mjs";
import { jsonMapHelperSource } from "./js_helpers/json_map_helper.mjs";
import { loopHelperSource } from "./js_helpers/loop_helper.mjs";
import { mapHelperSource } from "./js_helpers/map_helper.mjs";
import { rememberHelperSource } from "./js_helpers/remember_helper.mjs";
import { resolveHelperSource } from "./js_helpers/resolve_helper.mjs";

export function applyJsPrelude(lines, {
  jsHelpers,
  usesRememberShim,
  usesMapShim,
  mindShim,
  loopShim
} = {}) {
  const prelude = [lines[0]];
  if (jsHelpers.usesYamlRuntime) jsHelpers.usesJsonRuntime = true;
  if (mindShim?.used) {
    jsHelpers.usesVectorFormat = true;
    prelude.push("const mindConfigs = new Map();");
    prelude.push("const mindAnswerCounters = new Map();");
    prelude.push(mindHelperSource());
    prelude.push(mindHistorySource());
    prelude.push(mindToolHelperSource());
    if (!jsHelpers.usesExchange) {
      prelude.push(newspaperRuntimeHelper());
    }
  }
  if (jsHelpers.usesCommand) {
    prelude.push(commandHelperSource());
  }
  if (jsHelpers.usesInterpret) {
    prelude.push(interpretHelperSource());
  }
  if (usesRememberShim) {
    prelude.push(rememberHelperSource());
  }
  if (jsHelpers.usesResolveFilename) {
    prelude.push(resolveHelperSource());
  }
  if (jsHelpers.usesBoolHelper) {
    prelude.push(boolHelperSource());
  }
  if (jsHelpers.usesDateMath) {
    prelude.push(dateHelperSource());
  }
  if (usesMapShim) {
    prelude.push(mapHelperSource());
  }
  if (jsHelpers.usesExchange) {
    prelude.push(exchangeRuntimeHelper());
  }
  if (jsHelpers.usesVectorFormat) {
    prelude.push(vectorFormatHelper());
  }
  if (jsHelpers.usesJsonRuntime) {
    prelude.push(jsonRuntimeHelper());
  }
  if (jsHelpers.usesYamlRuntime) {
    prelude.push(yamlRuntimeHelper());
  }
  if (jsHelpers.usesYamlStringify) {
    prelude.push(yamlStringifyHelper());
  }
  if (jsHelpers.usesCsvRuntime) {
    prelude.push(csvRuntimeHelper());
  }
  if (jsHelpers.usesJsonMap) {
    prelude.push(jsonMapHelperSource());
  }
  if (jsHelpers.usesCsvMap) {
    prelude.push(csvMapHelperSource());
  }
  if (jsHelpers.usesFs) {
    prelude.splice(1, 0, "import fs from \"node:fs\";");
  }
  if (jsHelpers.usesOs) {
    prelude.splice(1, 0, "import os from \"node:os\";");
  }
  if (jsHelpers.usesCommand) {
    prelude.splice(1, 0, "import child_process from \"node:child_process\";");
  }
  if (jsHelpers.usesExchange) {
    prelude.splice(1, 0, "import crypto from \"node:crypto\";");
  }
  if (jsHelpers.usesExchange || jsHelpers.usesPath) {
    prelude.splice(1, 0, "import path from \"node:path\";");
  }
  if (jsHelpers.usesCsvRuntime) {
    prelude.splice(1, 0, `import { parse as parseCsv } from ${JSON.stringify(CSV_PARSE_RUNTIME_URL)};`);
  }
  if (jsHelpers.usesYamlRuntime) {
    prelude.splice(1, 0, `import YAML from ${JSON.stringify(YAML_RUNTIME_URL)};`);
  }
  if (loopShim?.used) {
    prelude.push(loopHelperSource());
  }
  let nextLines = prelude.concat(lines.slice(1));
  if (mindShim?.used) {
    const importLines = [];
    const bodyLines = [];
    for (const line of nextLines) {
      if (line.startsWith("import ")) {
        importLines.push(line);
      } else {
        bodyLines.push(line);
      }
    }
    nextLines = importLines.concat(["(async () => {", ...bodyLines, "})();"]);
  }
  return nextLines;
}
