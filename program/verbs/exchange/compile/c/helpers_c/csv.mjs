import { CSV_RUNTIME_HELPER_PART_01 } from "./csv/part_01.mjs";
import { CSV_RUNTIME_HELPER_PART_02 } from "./csv/part_02.mjs";
import { CSV_RUNTIME_HELPER_PART_03 } from "./csv/part_03.mjs";
import { CSV_RUNTIME_HELPER_PART_04 } from "./csv/part_04.mjs";

export const CSV_RUNTIME_HELPER = [
  ...CSV_RUNTIME_HELPER_PART_01,
  ...CSV_RUNTIME_HELPER_PART_02,
  ...CSV_RUNTIME_HELPER_PART_03,
  ...CSV_RUNTIME_HELPER_PART_04
].join("\n");
