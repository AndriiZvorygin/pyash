import { EXCHANGE_HELPER_PART_01 } from "./exchange/part_01.mjs";
import { EXCHANGE_HELPER_PART_02 } from "./exchange/part_02.mjs";
import { EXCHANGE_HELPER_PART_03 } from "./exchange/part_03.mjs";

export const EXCHANGE_HELPER = [
  ...EXCHANGE_HELPER_PART_01,
  ...EXCHANGE_HELPER_PART_02,
  ...EXCHANGE_HELPER_PART_03
].join("\n");
