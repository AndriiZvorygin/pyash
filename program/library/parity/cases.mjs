// Declared parity corpus. A case with `expected: "same"` must produce identical
// normalized stdout on every declared backend and exit zero. A case with a
// per-backend `expected` map pins a known divergence: the gate fails if any
// backend changes, in either direction.
export const CASES = [
  {
    family: "text-facts",
    name: "text-write",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      'exists su name greeting ob text "hello" be text ya',
      "ob name greeting be write do"
    ]
  },
  {
    family: "boolean-composition",
    name: "exists-and-or-not",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      'be touch ob filename "a.txt" do',
      'be touch ob filename "b.txt" do',
      'be and ob la be exists ob filename "a.txt" do ko with la be exists ob filename "b.txt" do ko do',
      "ob name result be write do",
      'be or ob la be exists ob filename "a.txt" do ko with la be exists ob filename "missing.txt" do ko do',
      "ob name result be write do",
      'be not ob la be exists ob filename "missing.txt" do ko do',
      "ob name result be write do"
    ]
  },
  {
    family: "filename-mutation",
    name: "touch-result",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      'be touch ob filename "parity-fs.txt" do',
      "ob name result be write do"
    ]
  },
  {
    family: "numeric-facts",
    name: "plus-result",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      "ob num 3 to num 4 be plus do",
      "ob name result be write do"
    ]
  },
  {
    family: "numeric-facts",
    name: "literal-operators",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      "ob num 9 from num 4 be subtract do",
      "ob name result be write do",
      "ob num 6 by num 7 be multiply do",
      "ob name result be write do",
      "ob num 8 by num 2 be divide do",
      "ob name result be write do",
      "ob num 8 from num 3 be remains do",
      "ob name result be write do",
      "ob num 2 from num 10 be exponential do",
      "ob name result be write do",
      "ob num 6 to num 3 be xor do",
      "ob name result be write do"
    ]
  },
  {
    family: "numeric-facts",
    name: "divide-by-zero-guard",
    backends: ["interpreter", "javascript", "c"],
    expected: {
      interpreter: { code: 1, lines: [] },
      javascript: { code: 1, lines: [] },
      c: { code: 1, lines: [] }
    },
    known: "each backend rejects division by zero with exit 1 and no stdout",
    stderrMatch: "divide: by cannot be zero",
    lines: [
      "ob num 1 by num 0 be divide do",
      "ob name result be write do"
    ]
  },
  {
    family: "ceremony-numeric",
    name: "ceremony-result",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      "exists su name result ob num 5 be number ya",
      "su name plus two to name num result be ceremony def",
      "ob num 2 to name result be plus do",
      "su name plus two be ceremony prah",
      "to name result be plus two do",
      "ob name result be write do"
    ]
  },
  {
    family: "file-read",
    name: "read-result",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      'be touch ob filename "parity-read.txt" do',
      'ob text "stable" to filename "parity-read.txt" be write do',
      'su file be read from filename "parity-read.txt" do',
      "ob name result be write do"
    ]
  },
  {
    family: "boolean-comparison",
    name: "nested-equally-leaves",
    backends: ["interpreter", "javascript", "c"],
    expected: "same",
    lines: [
      "be and ob la ob num 1 be equally from num 1 do ko with la ob num 1 be equally from num 2 do ko do",
      "ob name result be write do"
    ]
  }
];
