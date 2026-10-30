import { resolveZaiCodingApiKey } from "../program/runtime/zai_coding_plan.mjs";

const apiKey = resolveZaiCodingApiKey();
if (!apiKey) {
  process.stderr.write("Z.AI Coding Plan key missing from configure/secret.pya\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`${apiKey}\n`);
}
