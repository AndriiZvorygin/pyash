import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CJSON_HEADER = fsSync.readFileSync(new URL("../../../../caterer/cjson/cJSON.h", import.meta.url), "utf8");
const CJSON_SOURCE = fsSync.readFileSync(new URL("../../../../caterer/cjson/cJSON.c", import.meta.url), "utf8")
  .replace(/#include\s+\"cJSON\.h\"\s*/g, "");
const CSV_PARSE_RUNTIME_URL = pathToFileURL(
  path.resolve(process.cwd(), "node_modules/csv-parse/dist/esm/sync.js")
).href;
const YAML_RUNTIME_URL = pathToFileURL(
  path.resolve(process.cwd(), "node_modules/yaml/dist/index.js")
).href;

export { CJSON_HEADER, CJSON_SOURCE, CSV_PARSE_RUNTIME_URL, YAML_RUNTIME_URL };
