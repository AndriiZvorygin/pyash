import {
  COMPOSITIONAL_AXIS_ORDER,
  COMPOSITIONAL_CONTEXT_ORDER,
  compositionalGrid
} from "../compositionalCases.mjs";
import pyashWords from "../pyashWords.json" with { type: "json" };

const CORE_CASES = [
  { keyword: "su", case: "nominative_case_" },
  { keyword: "ob", case: "accusative_case_" }
];

const compositionalRegisters = COMPOSITIONAL_CONTEXT_ORDER.flatMap((context, contextIndex) =>
  COMPOSITIONAL_AXIS_ORDER.map((axis, axisIndex) => {
    const cell = compositionalGrid[context][axis];
    return Object.freeze({
      index: contextIndex * COMPOSITIONAL_AXIS_ORDER.length + axisIndex,
      context,
      axis,
      keyword: cell.keyword,
      case: cell.case,
      hnuc: cell.hnuc,
      pya: cell.pya,
      encodable: cell.status !== "unassigned"
    });
  })
);

const coreRegisters = CORE_CASES.map((entry, index) => {
  const lexeme = pyashWords.find((word) => word.en === entry.case);
  if (!lexeme?.hnuc || !lexeme?.pya) {
    throw new Error(`Sysh core case register has no Pyash lexeme (${entry.case})`);
  }
  return Object.freeze({
    index: compositionalRegisters.length + index,
    context: "core",
    axis: "case",
    keyword: entry.keyword,
    case: entry.case,
    hnuc: lexeme.hnuc,
    pya: lexeme.pya,
    encodable: true
  });
});

export const SYSH_CASE_REGISTER_LAYOUT = Object.freeze([
  ...compositionalRegisters,
  ...coreRegisters
]);

const registersByKeyword = new Map(
  SYSH_CASE_REGISTER_LAYOUT.map((register) => [register.keyword, register])
);

if (registersByKeyword.size !== SYSH_CASE_REGISTER_LAYOUT.length) {
  throw new Error("Sysh case-register layout requires unique canonical case keywords");
}

export function syshCaseRegisterForKeyword(keyword) {
  return registersByKeyword.get(keyword) ?? null;
}

export function syshCompoundWordCapacity(registerBits) {
  if (!Number.isInteger(registerBits) || registerBits < 16 || registerBits % 16 !== 0) {
    throw new RangeError("Sysh register width must be a positive multiple of 16 bits");
  }
  return registerBits / 16;
}
