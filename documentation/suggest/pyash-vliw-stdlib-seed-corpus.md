# Pyash Standard Functions and Evolution Seeds

**Status:** proposal. This is a design bridge between the versioned-stdlib and
genetic-programming roadmap items; it does not freeze a package/import ABI.

## Goal

Build a useful collection of small, composable Pyash functions that can be
reused by programs and serve as trusted starting candidates for evolutionary
programming. Keep the functions themselves as ordinary Pyash ceremony source.
VLIW codelets are the compiled representation; they are not a second function
language or a replacement for Pyash vocabulary and cases.

Keep three related layers distinct:

| Layer | Contents | Stability |
| --- | --- | --- |
| Pyash primitives | Existing verbs and interpreter semantics such as numeric operations, comparisons, boolean composition, and vectors | Governed by the Pyash language and VLIW semantic contracts |
| Standard functions | Named, typed Pyash ceremonies composed from those primitives | Versioned public surface after tests and compatibility review |
| Evolution seeds | Small known-answer `.pya` programs and training/held-out cases | Experimental; candidates are not automatically promoted to the standard library |

This distinction prevents the standard library from becoming a duplicate
opcode table. It also lets experiments add or replace seeds without changing a
stable function's meaning.

## Existing Foundation

| Area | Present evidence | Gap before use as a seed family |
| --- | --- | --- |
| Numeric VLIW operations | `plus`, `subtract`, `multiply`, `divide`, `xor`, `exponential`, and `remains` have codelet adapters; `invert` has a separate adapter | The source-level programlet evaluator currently admits only `remains`, `equally`, `plus`, and `subtract` |
| Boolean values | Truth/lie literals have codelets and ordinary Pyash boolean examples exist | The programlet evaluator currently admits boolean output values, but not `and`, `or`, `not`, or boolean `xor` operations |
| Comparison | The `equally` verb is used by the current parity programlet | Its lexical phrase is not a polished public function name; comparator behavior needs a focused shared contract and conformance cases |
| Vectors | Numeric, boolean, and text vector literals have encoding and decode tests | The programlet ABI currently handles scalar `num` and `bool` outputs only |
| Evolution | `evolvePyashProgramSource` scores deterministic candidates through the reference interpreter and validates held-out cases | Mutation currently changes numeric case literals only; it does not yet evolve operators or sentence structure |

The existing `vliw-is-even.pya` is a codec/runtime proof, not yet a good
standard-library API example. Its `equally number` ceremony name is an accepted
vocabulary compound used for the even-number sense, not a natural standalone
Pyash word. Public function names should use reviewed Pyash vocabulary or
accepted compounds rather than silently turning awkward fallback compounds
into permanent API.

## Function Domains

Start with the finite unsigned 16-bit numeric domain and booleans. Function
names below are concept labels, not approved Pyash spellings.

| Family | Candidate functions | Why it belongs |
| --- | --- | --- |
| Constants and transfer | zero, one, identity | Small ABI and return-value seeds |
| Scalar arithmetic | increment, decrement, add, subtract, multiply, quotient, remainder, bounded power | Directly exercises the arithmetic primitives and edge contracts |
| Predicates | equal, less-than, greater-than, is-zero, parity | Feeds branch selection and boolean composition |
| Boolean composition | not, and, or, boolean xor, select | Common control and predicate building blocks; numeric `xor` support does not define boolean `xor` semantics |
| Numeric composition | minimum, maximum, clamp, is-power-of-two | Useful reusable functions with small bounded control flow |
| Vectors | element-wise arithmetic, comparison, bounded reductions | Later tier after the programlet signature and work-budget contracts cover vectors |
| Bounded algorithms | greatest common divisor, factorial, small recurrence functions | Later tier; requires verified bounded loops and a step budget |

The unsigned domain is intentional for the first tier. Do not add signed
operations such as absolute value until the value representation and overflow
contract explicitly support signed values.

## Seed Record Contract

Each seed should be an ordinary `.pya` function with:

- A reviewed Pyash ceremony name and explicit typed input/output signature.
- Defined behavior for boundary values and error cases, inherited from or
  composed out of existing Pyash primitives.
- A small body with cyclomatic complexity at most 9 and a statically bounded
  amount of work.
- Known-answer training cases and a separate held-out set. Cases stay in the
  repository's Pyash data surfaces rather than becoming canonical ad hoc JSON.
- A successful source-to-`.pyac` lowering, decode round-trip, and reference
  interpreter run. Require target-backend parity only for targets the seed
  claims to support.
- A focused quiz that checks ordinary results, edge results, and rejection of
  unsupported inputs or effects.

One function per seed source keeps candidate size bounded and lets evolution
select or mutate functions independently. Experimental alternatives belong in
the seed corpus; only reviewed, stable semantics belong in a versioned standard
library package.

## Evolution Path

1. Freeze a v0 scalar function ABI and vocabulary names; document the exact
   numeric and boolean edge semantics used by the seeds.
2. Add hand-authored seed functions using only operations already admitted by
   the programlet evaluator. Prove them through Pyash source, PyAC round-trip,
   interpreter execution, and held-out quizzes.
3. Admit additional existing VLIW operations one at a time. Each operation
   needs matching Pyash interpreter, codelet, and candidate-evaluator results
   before it can appear in a seed.
4. Extend mutation from numeric constants to type- and signature-preserving
   operator/case substitutions. Add structural composition or crossover only
   after mutations retain a valid Pyash program and pass the same gates.
5. Promote stable functions into a versioned stdlib namespace only after their
   signatures, errors, tests, and backend support are documented.

Correctness is the admission gate. Code size or execution cost can rank
correct candidates, but must not compensate for a wrong result. Every evolved
candidate retains its seed, deterministic random seed, case results, and
reproducible `.pya` source so it can be reviewed before promotion.

## Current Boundary

The current programlet evaluator is a CPU reference path using Pyash's
process-global interpreter memory, so it evaluates candidates sequentially.
The legacy Housekeeper VLIW batch evaluator is a separate slot/op profile.
Neither fact prevents defining the source-level library; they do constrain
which functions can currently be certified as evolutionary candidates or GPU
workloads. See the
[`VLIW compiler architecture`](../reference/pyash-vliw-compiler-architecture.md)
for the implemented programlet slice and backend boundaries.
