import { MIND_RUNTIME_HELPER_PART_01 } from "./mind/part_01.mjs";
import { MIND_RUNTIME_HELPER_PART_02 } from "./mind/part_02.mjs";
import { MIND_RUNTIME_HELPER_PART_03 } from "./mind/part_03.mjs";

export const MIND_RUNTIME_HELPER = [
  ...MIND_RUNTIME_HELPER_PART_01,
  ...MIND_RUNTIME_HELPER_PART_02,
  ...MIND_RUNTIME_HELPER_PART_03
].join("\n");
