import { CJSON_HEADER, CJSON_SOURCE } from "../constants.mjs";
import { TEXT_HELPER, VECTOR_PRINT_HELPER, VECTOR_TYPE_DECL, MAP_TYPE_DECL, MAP_HELPER, JSON_PYASH_HELPER, CSV_RUNTIME_HELPER, YAML_STRINGIFY_HELPER, YAML_RUNTIME_HELPER, EXCHANGE_HELPER, TOOL_CAPTURE_HELPER, MIND_RUNTIME_HELPER, COMMAND_HELPER, CEREMONY_VALUE_HELPER, FILESYSTEM_HELPER, LIST_PRINT_HELPER, DATE_MATH_HELPER } from "../c/helpers_c.mjs";

export function applyCPrelude(lines, { cHelpers, mainLines, cState } = {}) {
  if (!cHelpers) return lines;
  if (cHelpers.usesExchange) {
    cHelpers.usesTextHelper = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesPrintf = true;
  }
  const needsCsvRuntime = cHelpers.usesCsvRuntime
    && [...lines, ...mainLines].some((line) => typeof line === "string" && /\bpya_csv_/.test(line));
  const needsYamlRuntime = cHelpers.usesYamlRuntime;
  const needsYamlStringify = cHelpers.usesYamlStringify && !needsYamlRuntime;
  const needsDirentHeader = Boolean(cHelpers.usesDirent || cHelpers.usesFilesystem);
  const needsCtypeHeader = Boolean(
    cHelpers.usesCtype
    || cHelpers.usesMap
    || cHelpers.usesMapPrinter
    || cHelpers.usesVectorPrinter
    || cHelpers.usesJsonRuntime
    || needsCsvRuntime
  );
  const headers = [];
  headers.push("#if defined(__GNUC__)");
  headers.push("#pragma GCC diagnostic push");
  headers.push("#pragma GCC diagnostic ignored \"-Wformat-truncation\"");
  headers.push("#pragma GCC diagnostic ignored \"-Wformat-overflow\"");
  headers.push("#endif");
  if (cHelpers.usesCommand || cHelpers.usesExchange) {
    headers.push("#define _POSIX_C_SOURCE 200809L");
  }
  if (cHelpers.usesPrintf) headers.push("#include <stdio.h>");
  if (cHelpers.usesString) headers.push("#include <string.h>");
  if (cHelpers.usesStdlib) headers.push("#include <stdlib.h>");
  if (needsCtypeHeader) headers.push("#include <ctype.h>");
  if (cHelpers.usesExchange) headers.push("#include <stdint.h>");
  if (cHelpers.usesExchange) headers.push("#include <unistd.h>");
  if (cHelpers.usesExchange) headers.push("#include <sys/stat.h>");
  if (cHelpers.usesExchange) headers.push("#include <errno.h>");
  if (cHelpers.usesExchange || cHelpers.usesDateMath) headers.push("#include <time.h>");
  if (needsDirentHeader) headers.push("#include <dirent.h>");
  if (cHelpers.usesSysStat) headers.push("#include <sys/stat.h>");
  if (cHelpers.usesErrno) headers.push("#include <errno.h>");
  if (cHelpers.usesFilesystem) headers.push("#include <unistd.h>");
  if (needsYamlRuntime) headers.push("#include <strings.h>");
  if (needsYamlRuntime) headers.push("#include <yaml.h>");
  if (needsCsvRuntime) {
    headers.push("#include <zsv.h>");
  }
  if (cHelpers.usesMindRuntime) {
    headers.push("#include <curl/curl.h>");
  }
  if (cHelpers.usesCommand) {
    headers.push("#include <unistd.h>");
    headers.push("#include <sys/types.h>");
    headers.push("#include <sys/wait.h>");
  }
  if (lines.some(l => typeof l === "string" && l.includes("fmod(")) || cHelpers.usesJsonRuntime) headers.push("#include <math.h>");
  const needsLoopGlobals =
    [...lines, ...mainLines].some(l => typeof l === "string" && /\b(fromindex|toindex|atindex|by)\b/.test(l));
  if (needsLoopGlobals) {
    headers.push("double fromindex = 0;");
    headers.push("double toindex = 0;");
    headers.push("double atindex = 0;");
    headers.push("double by = 0;");
  }
  if (cHelpers.usesMapGlobals) {
    headers.push("double pya_ob_num = 0;");
    headers.push("double pya_from_num = 0;");
    headers.push("const char *pya_ob_text = 0;");
    headers.push("int pya_ob_bool = 0;");
    headers.push("double pya_to_num = 0;");
    headers.push("char *pya_to_text = 0;");
    headers.push("int pya_to_bool = 0;");
  }
  if (headers.length) lines.unshift(...headers);
  const cPrelude = [];
  if (cHelpers.usesTextHelper) cPrelude.push(TEXT_HELPER);
  if (cHelpers.usesExchange) cPrelude.push(EXCHANGE_HELPER);
  if (cHelpers.usesCeremonyValue) cPrelude.push(CEREMONY_VALUE_HELPER);
  if (cHelpers.usesJsonRuntime) {
    cPrelude.push(CJSON_HEADER);
    cPrelude.push(CJSON_SOURCE);
    cPrelude.push(JSON_PYASH_HELPER);
  }
  if (cHelpers.usesVectorType) cPrelude.push(VECTOR_TYPE_DECL);
  if (cHelpers.usesVectorPrinter) cPrelude.push(VECTOR_PRINT_HELPER);
  if (cHelpers.usesListPrinter) cPrelude.push(LIST_PRINT_HELPER);
  if (cHelpers.usesFilesystem) cPrelude.push(FILESYSTEM_HELPER);
  if (cHelpers.usesDateMath) cPrelude.push(DATE_MATH_HELPER);
  if (cHelpers.usesMap) cPrelude.push(MAP_TYPE_DECL);
  if (cHelpers.usesMap || cHelpers.usesMapPrinter) cPrelude.push(MAP_HELPER);
  if (cHelpers.usesToolCapture) cPrelude.push(TOOL_CAPTURE_HELPER);
  if (cHelpers.usesMindRuntime) cPrelude.push(MIND_RUNTIME_HELPER);
  if (cHelpers.usesCommand) cPrelude.push(COMMAND_HELPER);
  if (needsYamlRuntime) cPrelude.push(YAML_RUNTIME_HELPER);
  if (needsYamlStringify) cPrelude.push(YAML_STRINGIFY_HELPER);
  if (needsCsvRuntime) cPrelude.push(CSV_RUNTIME_HELPER);
  if (cPrelude.length) lines.splice(headers.length, 0, ...cPrelude);
  if (cState?.preMain?.length) lines.push(...cState.preMain);
  const body = mainLines.map(l => `  ${l}`).join("\n");
  lines.push("int main(void) {");
  lines.push(body || "  return 0;");
  lines.push("  return 0;");
  lines.push("}");
  lines.push("#if defined(__GNUC__)");
  lines.push("#pragma GCC diagnostic pop");
  lines.push("#endif");
  return lines;
}
