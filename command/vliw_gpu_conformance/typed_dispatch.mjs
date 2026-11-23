import assert from "node:assert/strict";
import { parse } from "../../program/understand/index.mjs";
import { lowerPyashProgram } from "../../program/library/vliw/index.mjs";
import { encodePyacPack } from "../../program/library/vliw/database.mjs";

const SOURCE = [
  "su name count once ob num 0 to name num answer be ceremony def",
  "ob num 41 ret",
  "su name count once be ceremony prah",
  "su name count once ob bool lie to name bool answer be ceremony def",
  "ob bool truth ret",
  "su name count once be ceremony prah",
  "su name count twice to name num answer be ceremony def",
  "to name num first ob num 9 be count once do",
  "su name first ret",
  "su name count twice be ceremony prah"
];

export function typedDispatchCases() {
  // The legacy programlet compiler disallows overloaded names; the Rust
  // interpreter accepts canonical VLIW definitions keyed by full signature.
  const pack = (call) => encodePyacPack(lowerPyashProgram([...SOURCE, call].map((line) => parse(line))).vectors);
  return [
    ["numeric overload", pack("ob num 9 to name num answer be count once do"), { type: "unsigned", value: 41 }],
    ["boolean overload with reversed cases", pack("to name bool answer ob bool lie be count once do"), { type: "boolean", value: true }],
    ["nested overloaded call", pack("to name num answer be count twice do"), { type: "unsigned", value: 41 }],
    ["missing overload", pack("to name bool answer ob num 9 be count once do"), 1]
  ];
}

export async function verifyTypedDispatch({ executePack, executeCpuPacks, executeCpuError, backend, report }) {
  for (const [name, pack, expected] of typedDispatchCases()) {
    if (typeof expected === "number") {
      assert.equal(await executeCpuError(pack), expected, name);
      await assert.rejects(() => executePack(pack), (error) => {
        const matches = /shared VLIW runtime error 1\b/u.test(error.message)
          && error.housekeeperTiming?.runtimeTimingMs?.kernelTimingSource === "cuda-event";
        if (matches) report(name, error.housekeeperTiming, null, expected);
        return matches;
      });
      continue;
    }
    assert.deepEqual(await executeCpuPacks([pack]), [[expected]], name);
    const result = await executePack(pack);
    assert.equal(result.backend, backend, name);
    assert.deepEqual(result.values, [expected], name);
    report(name, result.housekeeperTiming, result.device, expected);
  }
}
