import { YAML_STRINGIFY_HELPER_PART_01 } from "./yaml/stringify_part_01.mjs";
import { YAML_RUNTIME_HELPER_PART_01 } from "./yaml/runtime_part_01.mjs";
import { YAML_RUNTIME_HELPER_PART_02 } from "./yaml/runtime_part_02.mjs";
import { YAML_RUNTIME_HELPER_PART_03 } from "./yaml/runtime_part_03.mjs";
import { YAML_RUNTIME_HELPER_PART_04 } from "./yaml/runtime_part_04.mjs";

export const YAML_STRINGIFY_HELPER = [
  ...YAML_STRINGIFY_HELPER_PART_01
].join("\n");

export const YAML_RUNTIME_HELPER = [
  ...YAML_RUNTIME_HELPER_PART_01,
  ...YAML_RUNTIME_HELPER_PART_02,
  ...YAML_RUNTIME_HELPER_PART_03,
  ...YAML_RUNTIME_HELPER_PART_04
].join("\n");
