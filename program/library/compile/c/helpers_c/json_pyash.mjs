import { JSON_PYASH_PART_01 } from "./json_pyash/part_01.mjs";
import { JSON_PYASH_PART_02 } from "./json_pyash/part_02.mjs";
import { JSON_PYASH_PART_03 } from "./json_pyash/part_03.mjs";
import { JSON_PYASH_PART_04 } from "./json_pyash/part_04.mjs";
import { JSON_PYASH_PART_05 } from "./json_pyash/part_05.mjs";
import { JSON_PYASH_PART_06 } from "./json_pyash/part_06.mjs";

export const JSON_PYASH_HELPER = [
  ...JSON_PYASH_PART_01,
  ...JSON_PYASH_PART_02,
  ...JSON_PYASH_PART_03,
  ...JSON_PYASH_PART_04,
  ...JSON_PYASH_PART_05,
  ...JSON_PYASH_PART_06
].join("\n");
