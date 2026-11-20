# Interpretable Weight-Space Programming in Pyash: Framework and Implementation Roadmap

Status: proposal. This document maps the complete iWSP workflow onto Pyash and lays
out an implementation sequence. Its organizing unit is the candidate/evaluator loop,
not a particular numeric format or kernel. The operation inventory and paper details
are reference material for that roadmap.

Primary source: arXiv:2611.18114v1 [cs.CE], submitted 13 Nov 2026.
"Interpretable weight-space programming builds transparent transformers and brain
encoding models" (Mehta, Singh, Xu, Antonello, Flinker, Mesgarani, Bonner, Jojic, Gao).
PDF and extracted text are kept outside the repository; see Appendix A.

---

## 1. Purpose and fit

### 1.1 What the paper does, in operational terms

iWSP as presented in the paper replaces training with authorship. Instead of fitting
parameters by gradient descent, an LLM writes the parameters and computation directly
in code, in closed form, and is told not to train (paper §2, p. 3):

> "The model parameters must be set in closed form. [. . .] What you CANNOT do: Run any
> kind of training, gradient descent, optimizer step, fitting loop, or backprop."

The loop is: the harness supplies a starting file and a **non-editable evaluation
script**; the agent writes a model, the harness evaluates it on a "visible set", and the
agent revises, for a fixed number of iterations (30–50 for the algorithmic/NLP tasks,
600 for the visual-cortex search) (paper §2, p. 3; §4.1, p. 6).

That restriction describes the paper's experiment, not a blanket restriction on Pyash.
Pyash should allow a task to select direct authorship, search, gradient-based updates
including backpropagation, or a hybrid. The task contract declares which data and
feedback each method may use; held-out evaluation remains protected and separate.

Two things make this an interesting target for Pyash specifically:

1. **The artifact under test is source code, not a checkpoint.** The paper's Fig. 1b
   treats the agent's written program as the model. A language whose programs are
   inspectable, where a reviewer can read the exact weights and the exact computation,
   is the natural medium for this.
2. **The evaluation is a fixed, non-editable harness.** The agent writes one side of a
   boundary; the harness owns the other. Pyash already has a sentence-level memory
   (`program/remember/index.mjs`), a verb dispatcher (`program/bridge/index.mjs`,
   `program/verbs/index.mjs`), and an artifact/provenance layer
   (`program/bridge/exchange.mjs`), which map onto that boundary.

### 1.2 Why Pyash, specifically

Pyash already has several useful pieces of the iWSP system: inspectable sentence
memory, a compositional dispatcher, durable artifacts and provenance, a Rust VLIW
runtime shared by CPU/GPU/browser paths, independent section execution, and a bounded
candidate-evolution library. These are building blocks, not yet an integrated iWSP
workflow: parameterized model facts, an isolated fixed evaluator, visible/hidden data
ownership, and the revision/audit loop still need explicit contracts.

The numeric substrate is no longer integer-only. The shared VLIW path supports scalar
IEEE float32, scalar fixed16, and typed float32/float64 vector literals in addition to
integer operations. Those formats have different range, sign, and resolution
properties; none is a universal requirement for every task. The paper's float64
examples are evidence about the authors' implementations, not a rule that Pyash must
reproduce their leakage or numeric range before a lower-precision working candidate can
count as useful.

### 1.3 What this plan is and is not

It specifies: the end-to-end system boundary, the model representation in Pyash
source, evaluator and data-split responsibilities, candidate iteration and audit,
staged deliverables with acceptance criteria, and the operations that may be needed.

It does not: write runtime code, change the compiler, add tests, or modify any existing
file. It does not assume that every candidate must run on a GPU. The first complete
system should establish correct authoring, evaluation, isolation, and replay on CPU;
shared VLIW CPU/GPU execution is introduced where measured workload size benefits from
it. Existing Pyash sentence and fact conventions remain the authoring surface.

## Framework at a glance

An iWSP run is a controlled search over readable candidate programs, not just a set of
numeric kernels:

1. A task definition fixes the input/output contract, metric, limits, and visible and
   held-out data before candidate search starts.
2. The agent writes or updates a candidate as Pyash source and inspectable parameter
   facts using the method declared by the task: direct authorship, search,
   gradient-based updates, or a hybrid.
3. A validator checks syntax, names, declared shapes, resource limits, and the
   candidate's access against the task's declared data policy.
4. A fixed evaluator executes the candidate on the visible split and returns bounded
   feedback. The agent cannot read or modify the evaluator or held-out split.
5. Each revision records source, parameter facts, parent candidate, score, evaluator
   version, and artifacts so the run can be replayed and audited.
6. After the bounded search ends, the sealed candidate is evaluated on held-out data;
   interpretability and reproducibility are reviewed independently of its score.

The host owns orchestration, validation, data access, scoring, and provenance. Candidate
execution can use Pyash's existing interpreter or lower to the shared VLIW runtime
where the candidate's operations fit. The Housekeeper is for admitted GPU execution of
sufficiently parallel work, not for authoring or every small candidate edit.

The success criterion is a useful, reproducible candidate for a defined task. Matching
the paper's numerical precision or reported score is a separate comparison, not a
prerequisite for demonstrating the framework.

---

## 2. Capability inventory (reference)

This inventory maps the paper's described operations to Pyash capabilities. It is a
reference for implementation planning, not the implementation order. A paper-domain
entry records how the cited model is described; it is not a requirement that Pyash use
that same precision. Status labels are scoped to the iWSP semantics in each row:
**exists**, **partial**, **absent**, or **sketch**.

### 2.1 Group A — Parameter authoring

These are the operations that make the method *weight-space programming* rather than
model-building. They are what the agent calls most.

| # | Operation | Required semantics | Domain | Where | Status |
|---|---|---|---|---|---|
| A1 | Declare a named parameter with a shape | Bind a name to a typed container with declared dimensions (rows, cols). Shape is part of the declaration, not inferred later. | n/a | host | absent |
| A2 | Write a parameter element | `w[i][j] := v`, bounds-checked, shape-aware. | task-selected | host | partial — indexed vector element write exists (`write ... at num ... to name vec`, `program/verbs/vector/index.mjs`); no shape or second dimension |
| A3 | Read a parameter element | Read back for audit, inspection, and the auditor's own checks. | task-selected | host | partial — indexed vector element read exists (`read ... at num ... to name num`, same file) |
| A4 | Fill a parameter from a pattern | Set every element from a closed-form rule (Gabor coefficients, one-hot codes, sinusoidal codes). Paper: *"hand-built attention circuits and lookup tables"* (p. 3). | task-selected | host | partial |
| A5 | Declare a parameter as tied | One parameter referenced by several consumers. Paper: *"one tied block (one attention head, 2-neuron ReLU MLP) is applied 10 times"* (p. 21); *"12 tied rounds of four folds"* (p. 21). | n/a | host | absent |
| A6 | Parameter count | Count of parameters in a model. The paper treats this as an interpretability proxy and reports medians of 166 / 41,600 / 100,000 parameters for the three agents (Table A2, p. 19). | integer | host | absent |
| A7 | Structural edit | Change the architecture, not just the values: paper: *"The agent may change the architecture and hard-code constants"* (p. 3). Layer count, width, and head count are all agent-controlled in the paper's own models. | n/a | host | absent |
| A8 | Structural summary | Emit a description of the model's structure for a reviewer: layer kinds, shapes, which parameters are tied. Feeds the paper's text-bottleneck test (*"at most 200 words"*, p. 3). | n/a | host | partial (`program/verbs/status.mjs` returns a runtime status map, not a model summary) |

### 2.2 Group B — Numeric kernels

Every model the paper describes is built from a small set of kernels. Reading Table A3
(pp. 20–21) and §A.2 (pp. 22–23) as an operation spec rather than as prose gives:

| # | Operation | Required semantics | Evidence | Domain | Status |
|---|---|---|---|---|---|
| B1 | Dot product / matrix-vector | Sum of elementwise products over a dimension. Present in every described model. | p. 20–21 | float64 | implemented as the shared Rust VLIW scalar product for equal-width float32/float64 vectors; matrix-vector remains unimplemented |
| B2 | Matrix-matrix product | Attention needs `QKᵀ` and `AV`. | p. 20–21 | float64 | absent |
| B3 | Elementwise add / subtract / multiply / divide | Including subtract, which is where sign matters. | p. 20–21 | float64 | partial — integer, scalar float32, and scalar fixed16 arithmetic exist in VLIW; typed float32/float64 vector literals are supported, while model-sized tensor execution is absent |
| B4 | ReLU | *"2-neuron ReLU MLP"*, *"residual ReLU MLPs"*, *"4 ReLU knots"*. | p. 21 | float64 | absent |
| B5 | Softmax | Attention weighting; also *"softmax weights become 10^(4−i)/11111"*. | p. 21 | float64 | absent |
| B6 | Numerically stable softmax | At the paper's sink scales (1e17, 1e22) a naive softmax overflows; the paper's own models rely on softmax degenerating to *"a plain exponential"*. A stable form (max-subtract) is required, not optional. | p. 21 | float64 | absent |
| B7 | Hard argmax over a row | *"using hard argmax instead of softmax"* (p. 21); attention that reads *"the single best earlier position"*. | p. 21 | float64 | absent |
| B8 | Argmax readout with deterministic tie-break | Paper: *"An exact match scores 0; ties go to the lower id"* (p. 21). | p. 21 | integer | absent |
| B9 | Squared distance | *"negative squared distance between query and key"* (p. 21); *"-40(i−(s−5))²"* (p. 22). | p. 21–22 | float64 | absent |
| B10 | Layer normalisation | Present in some described models and deliberately absent in others (p. 21). | p. 21 | float64 | absent |
| B11 | Residual add | *"7-channel float64 residual stream"* (p. 21); *"the residual state has channels VAL, A, B, X"* (p. 21). | p. 21 | float64 | absent |
| B12 | Transcendental: exp, log, sqrt | Gabor banks and divisive normalization need exp and sqrt; power-law compression needs a fractional power; the tropical decoder needs a power of ten; the sieve needs `cos²`. | p. 21–22 | float64 | absent |
| B13 | Floor / truncation | *"whose argmax is floor(X/place)"* (p. 21). | p. 21 | float64 | absent |
| B14 | Real division | The prime-sieve model divides by a prime and tests fractional part; the GCD model computes `X=(A+B)/100`. | p. 21 | float64 | partial — integer division plus scalar float32 and fixed16 division exist; vector reductions and model-level numeric contracts remain |
| B15 | Log base 10 / ln | *"(4−i)·ln10"* (p. 22); *"10^(4−i)"*. | p. 22 | float64 | absent |
| B16 | Scale and shift with large dynamic range | Registers up to 1e10, sink scales 1e17/1e22, and attention scores of 40. | p. 21 | float64 | partial — float32 has broad exponent range; fixed16 has a fixed bounded range; task-level adequacy is unmeasured and wider fixed formats are not implemented |
| B17 | Cumulative sum | Lateral inhibition: *"2·pulse minus cumulative sum over smaller primes"* (p. 22). | p. 22 | float64 | absent |
| B18 | One-hot / bit-code encoding | *"digit value; comma and '=' are 0"*, *"5-bit letter code with flags"* (p. 22). | p. 22 | float64 | absent |
| B19 | Nearest-value lookup | *"a nearest-value lookup"* (p. 21). | p. 21 | float64 | absent |
| B20 | Repeated application of a block | *"One tied block ... is applied 10 times"* (p. 21) — needs an explicit repeat/unroll with shared parameters. | p. 21 | n/a | absent |

### 2.3 Group C — Feature extraction (brain-encoding path)

The visual-cortex model is a *program*, not a set of weights. Its 865 lines decompose
into a small set of canonical operations (§A.2, p. 22):

> "nearly every nonlinearity in the program reduces to one of five canonical operations
> from visual neuroscience: power/log compression, half-wave rectification, quadrature
> energy, divisive normalization, and pairwise channel multiplication."

| # | Operation | Required semantics | Status |
|---|---|---|---|
| C1 | Convolution / filter bank | Gabor filters at 8 orientations and 3 spatial scales; center-surround filters. (§A.2, p. 22) | absent |
| C2 | Spatial derivative | Second derivatives of brightness for surface geometry; derivatives of the local orientation field for contour curvature. (p. 22) | absent |
| C3 | Half-wave rectification | Split into ON and OFF channels. (p. 22) | absent |
| C4 | Quadrature energy | `sqrt(a²+b²)` of a quadrature filter pair. (p. 22) | absent |
| C5 | Divisive normalization | Local divisive normalization, then log compression. (p. 22) | absent |
| C6 | Power-law compression | *"pixel intensities undergo power-law compression"* (p. 22) | absent |
| C7 | Pairwise channel multiplication | Multiply pairs of centred, normalized channels and average spatially. (p. 22) | absent |
| C8 | Colour-opponent channel split | One luminance and two opponent channels (red–green, blue–yellow). (p. 22) | absent |
| C9 | Spatial pooling on a foveated grid | Pool over a grid finer near the gaze centre; per-cell mean *and* standard deviation. (p. 22) | absent |
| C10 | Per-block normalization | Normalize each pooled block. (p. 22) | absent |

### 2.4 Group D — The fixed evaluator (not agent-authored)

The paper is careful that the agent writes only one side. For the algorithmic/NLP path
the harness supplies *"fixed code that evaluates the result"* (p. 3). For the brain path:
*"A fixed evaluator then fits a ridge regression model W from f(x) that linearly
predicts recorded responses y"* (p. 4). The agent writes `f`; the harness owns the fit.

| # | Operation | Required semantics | Status |
|---|---|---|---|
| D1 | Model forward pass | Run a named model over one input, producing a prediction. | absent |
| D2 | Batched forward pass | Over the visible set (200 examples for algorithmic tasks, p. 3). | absent |
| D3 | Exact-match accuracy | Token-by-token exact match (p. 3). | absent |
| D4 | Pearson correlation | The brain-path metric (p. 4). | absent |
| D5 | Ridge regression (closed form) | Harness-side readout of agent-written features (p. 4). The paper is explicit the *agent* must not fit: *"the rules forbid a model from reading any of the brain responses"* (p. 4). | absent |
| D6 | Feature-count and parameter-count limits | *"rejects a candidate with 10,000 or more features"* (p. 4); *"fewer than 100,000 explicit parameters"* (p. 6). | absent |
| D7 | Weight-determinism / data-access check | The paper's protocol checks that closed-form weight writing is independent of task examples. Pyash makes this task-selected: direct-authorship tasks may require it; optimization tasks instead constrain visible-data access and protect held-out data. | absent |

### 2.5 Group E — Agent loop and provenance

| # | Operation | Required semantics | Status |
|---|---|---|---|
| E1 | Candidate checkpoint | Persist a candidate's source plus weights plus score, per iteration, so the run is replayable. | partial — refinery checkpoints and hashed artifacts exist; no complete iWSP candidate/evaluator checkpoint contract |
| E2 | Provenance record | Which candidate, which iteration, which visible score, which source revision. | partial — newspaper and artifact provenance exist; not yet joined into one iWSP run record |
| E3 | Deterministic replay of a candidate | Re-execute a checkpointed candidate and get identical results. | partial — shared VLIW semantics and bounded function evolution are deterministic; whole candidate/evaluator replay is not yet implemented |
| E4 | Audit surface for an independent reviewer | The paper's auditor is a separate agent judging *"whether model changes at each iteration are human-interpretable"* (p. 3). It needs to read the diff between consecutive candidates and the parameter list. | absent |

### 2.6 Summary of the gap

The main gap is not one missing kernel: Pyash has useful arithmetic, typed vector
literals, programlets, independent sections, bounded function evolution, and durable
artifact primitives, but they are not yet assembled into the task/evaluator/candidate
lifecycle described above. Model-shaped parameter facts, an isolated immutable
evaluator, a whole-run checkpoint identity, and an independent audit path remain to be
designed.

At the execution level, VLIW has scalar float32 and fixed16 alongside integer and
boolean behavior, typed float32/float64 vector literals, programlet control flow,
16-lane dot products, and exact-match vector evaluation. General sum/argmax
reductions, matrix/tensor execution, and a scalable model-weight data plane in
`.pyac` remain gaps. These are specific capability gaps, not evidence that every
iWSP task requires float64 or GPU execution.

---

## 3. Numeric formats are an empirical design axis

Numeric representation is one design variable in the framework, not the architecture
that determines the rest of it. The paper's float64 results describe its own models and
tasks; they do not make float64 fidelity a prerequisite for Pyash iWSP. The question is
whether a candidate using a particular representation meets the task's declared
correctness and interpretability criteria.

### 3.1 What the shared VLIW runtime offers today

The shared Rust semantics in `rust/pyac-vliw-core/src/semantics_runtime.rs` include
integer and boolean behavior, scalar IEEE float32 (`VALUE_FLOAT32`), scalar fixed16
(`VALUE_FIXED16`), and typed integer/boolean/float32/float64 vector literals. Fixed
hardware vectors execute up to 16 lanes. The JavaScript VLIW codec now uses the
thickness-6 16-bit element count (up to 65,535) for variable numeric arrays and
sequence-framed text arrays, with indexed codelet continuation; its `executeCodelets`
path round-trips those values. The shared Rust runtime's fixed `CoreResult` still
supports only 16 returned lanes, so large-array execution/output transport through the
Rust CPU/GPU ABI remains the next implementation gap. Programlet slots remain scalar
typed values, so this is not yet a general tensor or matrix data model.

The current fixed16 quote carries an unsigned 16-bit numerator `n`; its divisor is the
implicit fixed constant 46,656 (`6^6`), not a per-value denominator field:

| Format | Approximate representable range | Resolution / precision character |
|---|---:|---|
| Fixed16, `n / 46,656`, `0 <= n <= 65,535` | 0 to 1.40464 | Constant step `1 / 46,656`, about 0.00002143; unsigned |
| IEEE binary16 (comparison only; not currently implemented here) | -65,504 to +65,504, with subnormals down to about 5.96e-8 | Floating spacing varies with magnitude; spacing near 1 is about 0.00097656 |
| IEEE float32, currently implemented | Broad signed exponent range, roughly ±3.4e38 | About 24 bits of significand precision; spacing varies with magnitude |

Thus fixed16 has finer spacing than binary16 near 1, but much smaller range and no
negative values. A wider numerator with the same divisor increases range without
improving the step size: unsigned 32-bit and 64-bit numerators would reach roughly
92,056 and 3.95e14. Those wider fixed formats are design possibilities, not current
runtime types. Increasing the divisor improves resolution while lowering the maximum;
signed encodings must also spend range on negative values. Binary/low-bit weights are
another possible representation, not a claim that an IEEE float is one bit wide.

The shared core currently supports dot product for inline or preceding named
float32/float64 vectors, up to 16 lanes. General sum/argmax reductions and
matrix/tensor execution are still absent. The `.pyac` pack has no scalable
weight-data section: small named vectors fit in ordinary vector declarations,
but larger model weights need the versioned program-image/container design.
These are separate execution/data-layout gaps; they should not be conflated with
scalar numeric-format support.

### 3.2 How to choose a representation

Choose formats per task and operation based on measured behavior:

- task correctness and score against a fixed reference;
- error tolerance and stability across representative inputs;
- required sign, dynamic range, and resolution;
- determinism and CPU/GPU agreement;
- memory footprint, throughput, and implementation cost.

Use the least costly representation that passes the task's declared criterion. Keep
reference and evaluator arithmetic sufficiently independent to detect candidate
errors. Scalar float32/fixed16 and float32/float64 vector values provide current
representation points for comparison; vector reduction arithmetic remains future work.
Float16, wider fixed numerators, signed fixed-point, and lower-bit parameter encodings
should be added only when a task or benchmark demonstrates their value. No
representation is rejected merely because it does not reproduce a paper's reported
precision.

### 3.3 Implementation implication

The framework should keep model authorship, evaluation isolation, and provenance
independent of any one numeric format. Numeric extensions are incremental runtime
capabilities: define their encoding and overflow/rounding behavior, add reference and
conformance tests, and measure them on a task before promoting them to a default. New
formats must preserve existing quote encodings and the shared CPU/GPU/browser semantic
contract. The RISC-V backend is a separate target and must explicitly demonstrate
conformance for any format it adopts.

---

## 4. The Pyash model representation

### 4.1 Candidate as inspectable source and named facts

The target candidate consists of ordinary Pyash source plus named, inspectable facts
that the source creates or consumes. A parameter's identity, value representation,
shape, and provenance need to be recoverable; a model's computation and structure need
to remain readable as sentences. This is a design contract, not a declaration that the
following record types or `be` values already exist.

| Concept | Information the candidate/evaluator must preserve |
|---|---|
| Feature/input | Name, value type, dimensions, and role in the task. |
| Parameter | Stable name, values or reproducible initializer/update history, numeric format, dimensions, and consumers. |
| Computation | Pyash source describing operations and control/data dependencies. |
| Connection | Which named result feeds which later computation. |
| Candidate/model | Source revision, referenced facts, task contract, and enough structure to count parameters and summarize the candidate. |
| Semantic reference | Optional reviewed vocabulary/sense association that explains a name; it does not prove the code implements that meaning. |

The exact storage shape should follow the existing Pyash fact/map/quote conventions and
the `.pyac` format's documented evolution path. Do not introduce a parallel tensor
syntax or reserve new vocabulary until those existing contracts have been inspected and
the needed terms have been validated.

### 4.2 Operations to express

The authoring operations (A1–A8) describe behaviors, not proposed verb names. An
implementation must make it possible to identify parameters, initialize and update
them using the task's declared method, inspect values, express reuse/ties, describe
computation and dependencies, and produce a structural summary. Each behavior needs a
clear Pyash sentence/case signature and a testable contract before implementation.

These distinctions matter for auditability: element assignment, initialization,
optimization updates, and parameter reuse are different behaviors even if they
eventually share a storage representation. A single opaque "build model" operation
would hide the candidate changes the method is intended to expose.

### 4.3 Why shape belongs to the candidate facts

The paper's audit procedure requires that a reviewer can read the model. If weights
live only in a compiled artifact, the reviewer still needs the authoring source — the
artifact under test. The target design keeps parameter values and shape metadata
inspectable so that:

- A6 (parameter count) is a property of the fact set, computable without executing
  the model.
- Candidate parameter changes can be inspected as fact-set diffs; D7 applies when the
  selected task protocol requires data-independent, direct weight authorship.
- The text-bottleneck test (A8) can be produced from the fact set plus the structure
  map.

### 4.4 Sense links

**Sense links have no runtime lookup surface.** The lexical machinery exists but is
build-time and translation-time only. Note that `rg "wordnet|synset|gloss"
program/verbs/ program/bridge/ program/motor/` is *not* empty: it returns two hits in
`program/verbs/exchange/translation.mjs:6,96`, which call `matchGlossToPyash`
(`program/library/translation/reverse_pairs.mjs:205`). That helper matches a gloss
*string* against a reverse word map; it does not resolve a model or feature name to a
sense record (id, POS, synset, lemmas, gloss). The gap an implementation agent should
plan against is therefore a name-to-sense lookup, not the absence of gloss handling.

- `program/library/translation/english_wordnet_linker.mjs` produces sense records with
  a stable id (`english-wordnet-sense-<hash>`), `pos`, `synset`, `lemmas`, `gloss`,
  `sourceTerms`, and a candidate list.
- `program/library/translation/english_wordnet_bridges.pya` records one row per
  WordNet sense: `su` is the POS-prefixed sense key, `ob` an English target anchor,
  `as` the target part of speech, `with` certainty, `via` provenance
  (`documentation/specifications/11-translation.md:67-71`).
- The linker is a bounded durable job: batch bound 200 senses, candidates only from an
  inventory-backed set, and *"the linker never edits the vocabulary directly"*
  (`11-translation.md:73-76`).

For iWSP, a reviewed sense association may help a reviewer interpret a feature or
computation name. Whether that association is embedded in candidate facts or resolved
through existing translation data remains a design question (§9.2); it is not needed
to claim that a candidate is executable, and it never substitutes for inspecting its
operations and parameter values.

### 4.5 Shape contract and enforcement point

Once parameter shapes are represented (A1), the evaluator should check them on every
element write (A2) and consuming operation (B1, B2). A shape violation should be a
named error, not a silent truncation or broadcast.

This matters more than it might seem: the paper's models are exactly where a silent
broadcast would hide a bug. A Gabor bank of 8 orientations at 3 scales with mismatched
widths would produce plausible-looking but wrong features, and the paper's own
evaluation loop would report a mediocre correlation without saying why.

---

## 5. Execution design

### 5.1 Separate responsibilities; shared candidate semantics

```
Task contract + protected evaluator/data (host-owned)
                  │ visible feedback during bounded search
                  ▼
Agent-authored Pyash source + named parameter facts
                  │ validate, record, execute
                  ▼
Candidate runtime: Pyash interpreter or shared VLIW semantics
                  │ same candidate contract; execution target selected by workload
          ┌───────┴────────┐
          ▼                ▼
       CPU runtime     GPU / browser runtime
       reference       admitted GPU work via Housekeeper
                  │
                  ▼
       sealed held-out evaluation + independent audit
```

The evaluator and orchestration own task data, scoring, limits, and provenance. The
candidate remains readable Pyash source and named facts. Execution is not divided by
numeric type: use the interpreter or shared VLIW implementation according to supported
semantics and measured workload. CPU is the reference and first integration target;
GPU/WebGPU are execution targets for suitable workloads, not separate candidate
languages or a reason to weaken the evaluator boundary.

### 5.2 Interpreter semantics today

For reference, the paths a Pyash program takes today:

- **Verb dispatch.** `program/bridge/index.mjs:169` `interpret(sentence)` applies
  environment defaults, resolves genitives, enforces the named-numeric-slot rules
  (mutable vs constant), then routes by verb and mood. Verbs register via
  `signatureWords` arrays (`program/verbs/index.mjs`), matched against the parsed
  sentence's case structure.
- **Facts.** `program/remember/index.mjs` stores `{su, be, ob}` triples; a vector fact
  is `ob.ve.values`.
- **Vectors.** Arbitrary length at the fact level: a 64-element vector stores and
  round-trips, and elements may be negative or fractional (verified). `produce` and
  `neuron` compute in float64 (`program/verbs/mathematics/produce.mjs`,
  `neuron.mjs`).
- **VLIW lowering.** `program/library/vliw/index.mjs` `lowerSentence` maps a sentence
  to codelets; the semantic slice is documented in
  `documentation/reference/pyac-vliw-semantic-slices.md`. `produce` and `neuron` do
  **not** lower (verified: `lowerSentence` rejects both with *"numeric-plus requires
  exactly mood, be, ob, and to"*).
- **Programlets.** `program/library/vliw/programlet.mjs` compiles ordinary `.pya`
  ceremony source into a `.pyac` pack of 16-word codelets, decodes it back, and
  executes it in an isolated memory scope. Sections are named independent blocks
  delimited by `myocpfun`.

### 5.3 Execution and parallelism

The current VLIW path already supports independent named sections on CPU and GPU; the
shared runtime also backs the browser WebGPU path. Independent sections may complete
out of source order, so consumers must associate results with section identity rather
than assume positional completion. A section per example is a possible mapping for an
evaluation batch, subject to the current 64-section pack capacity and measured packing
overhead.

That is distinct from parallelizing a single example's tensor operations. Float32 and
fixed16 scalar semantics, float32/float64 vector literals, and a 16-lane dot product
now exist. General sum/argmax reductions, model-scale matrix/tensor operations, and a
scalable parameter payload/data layout are still gaps. The plan must measure whether
within-example parallelism is worthwhile after a minimal end-to-end CPU candidate
exists; do not treat "GPU" as synonymous with "matrix support" or assume current
section dispatch already accelerates a layer.

The `.pyac` pack currently carries codelets rather than a general weight-data plane.
Any weight transport must follow the indexed program-image/container design and its
versioning contract, not an undocumented side channel (§9.3).

### 5.4 Parity across execution targets

`rust/pyac-vliw-core/` is shared by the Rust CPU backend, the GPU SPIR-V shader, and
the browser WebGPU path. The RISC-V backend is separate; it must not be counted as an
automatic consumer of shared-core changes. That separation is an asset for isolating
target-specific work, but every shared semantic extension still needs explicit
conformance on each shared target and a separate RISC-V decision where applicable.

The existing conformance harness is the model to follow:
`quiz/vliw_gpu_conformance.test.mjs` runs a named case matrix through
`command/vliw_gpu_conformance.mjs` and compares against the reference interpreter;
`rust/pyac/tests/pack_execution.rs` covers the Rust side.

Each new shared numeric operation should land with: a Rust core unit test, a JS
reference case, GPU conformance, and browser conformance. The existing
`quiz/vliw_vector_arithmetic.test.mjs` is the template for vector-op conformance.

### 5.5 Reuse of the GPU Housekeeper

The Housekeeper path is already built and is directly reusable:

- `program/runtime/gpu/housekeeper_adapter.mjs` is the HTTP client;
  `program/runtime/gpu/queue.mjs` is the durable local queue; `program/verbs/gpu.mjs`
  exposes the surface (`be gpu vliw ... vyah start`).
- `program/library/vliw/rust_gpu_pack.mjs` `createHousekeeperVliwPackExecutor` submits
  a `.pyac` pack as a `pyac-pack-execute` job with `profileName: "pyac-vliw-rust-gpu"`,
  sizing VRAM from the codelet count.
- The worker (`rust/pyac-gpu/worker/src/bin/vliw_runtime.rs`) exposes
  `POST /v1/execute`, base64-decodes the pack, runs it through the shader, and returns
  values plus per-section results.

For iWSP this path carries the *evaluation* of a candidate, not the authoring. The
separation mirrors the paper's: the agent writes the model, the harness evaluates it.

One caveat worth flagging: `documentation/reference/gpu-housekeeper-architecture.md`
states that the Housekeeper *"forwards only validated canonical PyAC packs to the
service"*, and the Rust VLIW interpreter is an independent GPU runtime service. If the
evaluation harness needs to read agent-authored *facts* (which it will, to evaluate a
candidate), that is a host-side concern and does not change the pack contract — but it
does mean the split between "pack payload" and "host facts" must be explicit (§9.3).

### 5.6 Where the Housekeeper is not the right tool

- **Authoring.** Weight writes are single-element edits against named facts. Round-
  tripping a 200-example evaluation through a GPU pack to change one weight is
  absurd.
- **Interpretation.** The auditor needs the source and the fact set. A compiled
  artifact is the wrong thing to read.
- **Small candidates.** The paper's median successful algorithmic model has **166
  parameters** (Table A2, p. 19). That is smaller than a single GPU workgroup's
  worth of work.

---

## 6. The iWSP agent loop in Pyash

### 6.1 Candidate generation and revision

The paper's loop, restated operationally for its direct-authorship protocol:

| Paper step | Paper location | Pyash operation |
|---|---|---|
| Write a model, weights in closed form | p. 3 | A1–A7 (parameter authoring) |
| Evaluate on the visible set | p. 3 | D1–D2, D3 or D4 |
| See the visible score | p. 3 | E1–E2 |
| Revise | p. 3 | A2/A4/A7 again |
| Iterate 30–50 times (600 for visual cortex) | p. 3, p. 6 | loop control |
| Compress after accuracy is reached | p. 4 | A6 + pruning |
| Audit interpretability of the edits | p. 3 | E4 |
| Check weights do not depend on task data (when this protocol is selected) | p. 3 | D7 |
| Re-evaluate on the hidden set | p. 3 | D2 + D3/D4 on the hidden split |

The task contract must state exactly what the agent receives: its current Pyash source,
the allowed task information, and the bounded visible feedback. The agent must not be
able to read or modify evaluator internals or the held-out split. The trusted evaluator
may access those protected resources; an independent auditor may inspect candidate
revisions and provenance. Keep these roles explicit rather than describing the hidden
set as part of an agent-visible or otherwise ambiguous "harness-visible" surface.

### 6.2 Validation

Before a candidate is scored, it must pass structural checks. These are the Pyash-side
analogue of the paper's harness-side checks:

- Shapes are consistent (every layer's input width matches its producer's output
  width; every parameter's declared shape matches its consumers).
- The model contains no unbound names.
- Feature and parameter counts are within D6's limits.
- Enforce the task's data-use policy: direct-authorship protocols can require D7;
  optimization protocols can use declared visible data while protecting held-out data
  and recording the update method and inputs.

### 6.3 Feedback

The feedback to the agent is a score, and the paper is careful about what else leaks.
The harness reports visible accuracy or correlation. It does not report which
parameters were wrong.

The useful addition Pyash can make — and the one that matches the paper's own
interpretability agenda — is a *structural* diff between consecutive candidates: which
parameters changed, by how much, and what new sense links appeared. The paper's
auditor needs exactly this to judge whether an edit is human-interpretable (p. 3), and
it is strictly less leaky than the score because it describes the *form* of the change
rather than the location of the error.

### 6.4 Checkpointing and provenance

Per iteration, persist:

1. The candidate's **Pyash source** (the artifact under test).
2. The candidate's **parameter facts** (so the model can be reconstructed and audited).
3. The **visible score** and the split identifier.
4. The **parent** candidate id, so the run is a tree, not a list.
5. A **content hash** over (1)–(3).

The existing machinery covers most of this: `program/bridge/refinery.mjs` already
computes checkpoint hashes and supports resume with a JSON token; `recordArtifact` in
`program/bridge/exchange.mjs` writes hashed artifacts under `artifacts/<run>/...`;
`program/agent/newspaper_log.mjs` gives the per-agent dated log.

### 6.5 Keeping candidates readable and reproducible

Two properties the paper relies on and that Pyash can support directly:

- **Readability.** Because the candidate *is* a Pyash program plus named facts, a
  reviewer reads the same text the agent wrote. No decompilation step exists.
- **Reproducibility.** A checkpointed candidate re-executes to the same score. This
  requires the *evaluation* path to be deterministic. The VLIW core is deterministic by
  construction; the JS verb layer needs a determinism check before it can be relied
  on (E3).

### 6.6 The text-bottleneck test

The paper's sharpest interpretability test: describe the best model in at most 200
words, give only that description to a fresh session, and see whether the rebuilt
model preserves performance (p. 3; Fig. A2, p. 21). Reported: rebuilt models retain
1.74× the original's parameters on geometric mean, against 2,043× for a control with no
description; and the visual-cortex rebuild reaches 0.451 pooled correlation against the
original's 0.488 (p. 6).

For Pyash this test has a specific and interesting property: the description would be
of *Pyash source*, and the rebuild would be *Pyash source*. So the test becomes
"can a fresh agent write Pyash that reproduces this Pyash's behaviour?" — which is
directly comparable to the paper's Python-to-Python test.

---

## 7. Semantic grounding and correctness

### 7.1 What sense links can and cannot do

A sense link answers "what does this *name* denote". It cannot answer "what does this
*weight vector* compute" — that requires reading the numbers.

The paper's own interpretability story is of the second kind. The auditor judges
whether *model changes* are human-interpretable (p. 3), and the visual-cortex model's
interpretability comes from its structure being *named after* cortical operations:
*"Gabor energy"*, *"Color contrast"*, *"Surface geometry"*, *"Contour curvature"*,
*"Channel correlations"* (Fig. 3d, p. 7; per-area breakdown p. 23), each backed by a weight pattern and an
operation sequence a neuroscientist can check.

So sense links do real work in iWSP, in two places:

1. **Naming the computation.** A layer or feature called "gabor energy" should resolve
   to a stable sense, so that two agents' solutions can be compared by name and so
   that "is this layer computing a Gabor filter?" is a question about a declared
   meaning plus a checkable weight pattern.
2. **Disambiguating the vocabulary.** The paper's models are described with terms
   that are overloaded in the ordinary sense — "energy", "surface", "ridge", "phase",
   "contrast". Linking these to specific senses makes the reviewer's reading of the
   model unambiguous.

What sense links cannot do is certify that the implementation matches the name. That
requires the auditor to check the weights, which is the paper's actual practice.

### 7.2 Types and shapes as a correctness instrument

The proposed type/shape contract in §4.5 should catch errors at the earliest
well-defined boundary, rather than serve as documentation alone:

- A shape mismatch should fail during declaration, assignment, or validation before
  evaluation.
- A value outside an operation's signedness or numeric domain should produce a clear
  typed error rather than an accidental conversion.
- A computation consuming a missing or incompatible named result should fail the
  connection check before scoring.

Each catches a class of bug that can otherwise appear as a plausible-but-wrong number.

### 7.3 The independent evaluator

The target correctness boundary follows the paper: the agent writes the candidate; a
fixed trusted harness owns scoring and protected data. For the algorithmic path, the
candidate returns predictions and the harness computes the metric. For the brain path,
the harness also owns the ridge readout (p. 4). It enforces feature/parameter limits
and runs held-out examples only after search ends.

The evaluator should not call candidate-authored scoring code. Independent reference
checks for metrics and representative outputs help prevent candidate and evaluator
bugs from canceling each other. The paper's fixed, non-editable evaluator is the model
for this boundary; Pyash must establish it through implementation and tests.

### 7.4 Proof obligations for the implementation

These are target invariants, not claims about the current runtime:

1. Candidate edits are limited to the declared source and parameter surface.
2. Every executable operation has a pinned semantic contract and a reference test.
3. Only the trusted evaluator computes official scores and accesses held-out data.
4. Candidate, evaluator, task, and data versions are recorded so a result can be
   replayed and audited.

Together these make a score interpretable: a mismatch can be traced to candidate
behavior, an operation implementation, evaluator behavior, or task data rather than
hidden state. Each operation added from the capability inventory needs conformance
evidence across the targets that claim to support it (§5.4).

---

## 8. Implementation roadmap

The order is architecture-first and vertical-slice driven. Each step should reuse
existing Pyash facts, sentences, interpreter, artifact, refinery, criterion, and
Housekeeper contracts where they fit. New vocabulary, storage shapes, and APIs are
selected only after checking the current Pyash cases, vocabulary inventory, and
relevant specifications. Numeric formats are not a gate to the first framework slice.

Current position: typed float32/float64 vectors, inline and named-vector dot
products, mutable float32 result collection, and the `pluk tlas` exact-match count
are implemented in the shared VLIW runtime. The CPU pilot
`iwsp-linear-score-v1` uses one two-feature input, three named weight vectors,
three collected scores, and a fixed expected vector: the reference candidate
scores 3/3 and a one-weight mutation scores 2/3. It is a reproducible visible
scoring example, not a complete candidate-search loop. The same reference and mutated
candidates now pass on live Vulkan through Housekeeper; see the verification ledger for
the exact run and artifacts. The first Rust PyAC evaluator boundary is now implemented;
Stage 2 remains open for the orchestration and parameter-policy work listed below.

### Stage 0 — Fix the task and trust contract

Define one small deterministic task and write down, before implementation:

- candidate inputs and outputs, allowed source/fact changes, and resource limits;
- the candidate update method or permitted method family, its allowed data, visible
  feedback, and exact metric;
- which examples and labels are visible to candidate updates, and which held-out data
  and evaluator internals remain protected;
- the sealed held-out evaluation step, iteration limit, and independent audit role;
- what constitutes a reproducible run and which artifacts identify it.

**Acceptance:** the roles, method choices, and information boundaries are unambiguous;
a reviewer can state what the candidate author may read or change and what the evaluator
alone owns. No new Pyash surface is committed at this stage.

**Pilot contract (`iwsp-linear-score-v1`):** the feature vector, expected score
vector, and candidate weights are all visible and fixed in one small Pyash fixture.
For this smoke task, the permitted candidate edit is the three named weight-vector
declarations; the update method is a direct source edit, with no search loop or
gradient update. Feedback is the exact-match count from 0 to 3. There is no held-out
data and no evaluator confidentiality claim at this stage. Stage 2 adds an actual
trusted boundary; it must not be inferred from this transparent conformance pack.

### Stage 0.1 — Add an exact-match judge primitive (implemented)

The shared Rust VLIW runtime accepts a mutable float32 prediction vector, indexed
dot-product writes, a named answer vector, and:

```pyash
ob name prediction value
by name reference point value
to name num correct count
be pluk tlas do
```

Each dot product returns its scalar and may store it with `to name prediction at num 0`.
The mutable-vector declaration's `state` quote and count choose a zero-initialized
float32 vector; stores apply in source order. The evaluator resolves each reference
to one preceding named vector in the same pack, requires equal nonzero widths and
finite float32 values, and returns the exact-equality count as an unsigned numeric
scalar. JavaScript only lowers the sentences; CPU and GPU use the shared Rust
semantics. The runnable source fixture is
`examples/pyash/vliw-pluk-tlas.pya`.

**Acceptance evidence:** Rust core tests cover exact equality, one-ULP differences,
signed zero, maximum vector width across indexed codelets, missing/duplicate names,
type errors, and width mismatch. The public Rust pack executor returns `Unsigned(3)`
for the fixture. This establishes the operation, not evaluator isolation, held-out data
protection, or a complete iWSP search loop.

### Stage 1 — Deliver one CPU/GPU vertical slice with named-vector dot product (verified)

Task version `iwsp-linear-score-v1` uses the visible feature vector `[1, 2]`;
candidate weight vectors `[1, 2]`, `[2, 1]`, and `[3, 0]`; and reference scores
`[5, 4, 3]`. The candidate may edit the named weight-vector declarations for this
smoke task. Dot products read the named feature/weight vectors and store each
scalar in a lane of the mutable prediction vector. `pluk tlas` supplies the exact
float32 score out of three. A deliberate third-weight change to `[2, 0]` yields
`[5, 4, 2]` and score `2/3`.

All data and the evaluator are visible in the same PyAC pack. This is a small
scoring/conformance fixture, not a security boundary, training loop, classifier
argmax, or held-out evaluation. Dot products require finite, nonempty, equal-width
vectors of matching type and accumulate in lane order at the input precision;
the pilot uses two-lane float32 vectors. The CPU fixture and tests use the shared
Rust semantics; JavaScript lowers but does not calculate the score.

**Acceptance evidence:** the runnable fixture is
`examples/pyash/iwsp-linear-scorer-v1.pya`; CPU tests prove reference score `3`
and mutated score `2`; Rust tests cover named lookup, missing/duplicate names,
width mismatch, inline compatibility, and numeric edge cases. The live RTX 3090
Housekeeper run passed both candidates plus the full matrix (49/49 valid cases
and 2/2 expected errors); its metrics and artifact hashes are recorded in the
VLIW verification ledger. Stage 1 is cross-target verified.

### Stage 2 — Isolate and verify the evaluator

Implement the fixed evaluator as a trusted boundary separate from candidate-authored
code. Validate candidate syntax, referenced names, permitted resources, and declared
parameter limits before execution. Enforce the task's declared data-access policy,
keep visible feedback bounded, and defer held-out access until the search is sealed.
Record the candidate update method and its permitted inputs so direct authorship,
search, gradient-based updates, and hybrids can be audited under the same boundary.

**Acceptance:** tests prove that candidate code cannot read or modify evaluator
internals or held-out material; malformed/over-limit candidates fail before scoring;
reference and evaluator checks detect a known wrong output; the sealed held-out result
is not returned into the search loop.

**Implemented first slice (2026-11-20):** `rust/pyac/src/iwsp.rs` owns visible and
held-out reference vectors outside the candidate `PyacPack`. Candidate execution is
limited to 64 codelets and its final 1, 2, 3, 4, 8, or 16 scalar float32 results are
treated as predictions. `score_visible` returns only the bounded exact-match count;
`seal` consumes the visible evaluator and creates a one-use held-out evaluator whose
`evaluate` consumes itself. The trusted evaluator builds a separate PyAC pack containing
the existing Pyash `pluk tlas` signature and invokes the shared Rust runtime. Candidate
code is not combined with the evaluator pack: only its final scalar outputs are copied
into the trusted judge pack alongside its private reference values. The candidate test
uses named float vectors and `kl6m psas`, and proves reference score 3/3 and a
changed-weight score 2/3. A separate test confirms that changing held-out references
does not change visible feedback.

This is an in-process boundary for bounded, data-only PyAC execution, not an operating
system sandbox against arbitrary native code. The scorer also exposes a prediction-slice
entry point for outputs produced by another conforming target. GPU execution is not yet
wired into this evaluator API. Remaining Stage 2 work: connect the one-use seal to the
actual candidate-search controller
so held-out scores cannot flow back into revisions; define and enforce task-specific
parameter counts and allowed candidate edits; and add tests for referenced-name/resource
policy at the task boundary. No candidate optimizer or held-out data loader is introduced
by this slice.

### Stage 3 — Make candidate history reproducible and auditable

Connect each candidate revision to its source, parameter facts, parent revision, task
and evaluator versions, update method/configuration, visible score, and artifact hashes.
For stochastic or gradient-based updates, record the relevant seed, optimizer settings,
and permitted data identity. Use Pyash's existing artifact/newspaper and checkpoint
mechanisms where possible. Add a structural diff that lets an independent reviewer
understand what changed between revisions.

**Acceptance:** a checkpoint can reconstruct and rerun its candidate; the recorded
result matches; a two-revision fixture produces a useful source/fact diff and complete
provenance; interrupted work can resume without changing the task or evaluator
identity.

### Stage 4 — Add bounded candidate-update/evaluate search

Only after the vertical slice and trust boundary work, add the bounded iteration loop.
Allow direct authorship, deterministic search, gradient-based optimization (including
backpropagation), or hybrids according to the task and supported runtime. Record the
chosen method, its data access, and compute budget. Keep protected held-out data outside
the candidate loop; provide bounded visible feedback and a strict revision cap. Audit
candidate changes, then seal and evaluate the selected candidate on held-out data.

**Acceptance:** a small fixture shows improvement from a poor candidate to a correct
one; attempts to access protected held-out data are rejected; iteration limits, resume,
update-method provenance, audit, and held-out sequencing are covered by tests; each step
is inspectable in recorded artifacts.

### Stage 5 — Expand candidate representation and operations from task evidence

Use the capability inventory in §2 to select the next operation needed by the chosen
task, rather than implementing every paper operation up front. Keep source expressed
as Pyash sentences/cases and retain named, inspectable parameter facts. Define type,
shape, range, rounding, overflow, and determinism contracts for the operations actually
used. Check that any proposed vocabulary and compound meanings are inventory-backed
and reviewed before fixing signatures.

**Acceptance:** each added operation has a Pyash-level contract, reference semantics,
edge-case tests, and a candidate task that demonstrates its need. Existing encodings
and programs remain compatible. Numeric representation is chosen by task measurements
as described in §3, not by paper precision alone.

### Stage 6 — Scale suitable execution across CPU and GPU

Profile the completed CPU vertical slice first. Batch independent examples/sections
where the existing section and pack limits make that effective. Use the shared VLIW
runtime when the candidate's operations fit; route GPU work through the GPU Housekeeper.
Only add within-example reductions, matrix/tensor execution, or a weight-data transport
contract when the measured workload requires them. Follow the indexed program-image
and `.pyac` versioning design rather than an ad hoc side channel.

**Acceptance:** CPU remains the behavioral reference; GPU/browser paths pass the same
conformance cases for supported semantics; results are keyed by section identity and
remain correct when sections complete out of source order; workload measurements show
that dispatch overhead is justified.

### Stage 7 — Broaden the task and audit suite

Add representative algorithmic tasks incrementally, then consider the brain-encoding
path as a separate expansion. That path needs feature extraction, protected response
data, a trusted ridge readout, and its own correctness and privacy review. Use the paper's
operation inventory as coverage guidance, not a mandatory all-at-once implementation
list.

**Acceptance:** each task has a fixed reference, explicit metric and resource limits,
visible/held-out separation, replayable candidates, and independent review. Report
score, parameter count, numeric behavior, runtime cost, and interpretability evidence
separately so one measure cannot conceal failure in another.

---

## 9. Design gates and evidence to collect

These are decisions to resolve at the point they affect the next vertical slice. They do
not block defining the overall framework, and none should be answered by inventing a
second Pyash convention.

### 9.1 Pyash surface and vocabulary

Before implementing parameter or evaluator verbs, inspect the existing sentence/case
patterns, map and quote forms, VLIW surfaces, and relevant specifications. Run the
vocabulary tooling for missing concepts, review WordNet/compound candidates, and record
the selected meanings. The sketches in earlier drafts are not canonical Pyash syntax.

### 9.2 Semantic references

Decide whether reviewed sense information belongs in candidate facts, in a build-time
link, or in a runtime lookup only when a concrete reviewer workflow needs it. A sense
link explains an intended name; correctness still comes from inspecting source,
parameters, and execution.

### 9.3 Parameter storage and execution transport

The current `.pyac` pack carries codelets and has no general model-weight data plane.
First determine whether the CPU vertical slice can use ordinary Pyash facts directly.
If a GPU task needs packed parameter data, align its representation with the documented
indexed program-image/container evolution, including versioning, bounds, and replay
rules. Do not add an undocumented sidecar merely to reach the GPU sooner.

### 9.4 Numeric format selection

Scalar float32 and fixed16, plus typed float32/float64 vector literals, are implemented;
their task suitability remains an empirical question. For each pilot, record
error/score, stability, sign/range needs, CPU/GPU agreement, memory, and throughput.
Consider float16, wider fixed numerators, signed fixed-point, or lower-bit weights only
when those measurements identify a benefit. Paper-reported float64 requirements are
task-specific evidence, not a global format rule.

### 9.5 Evaluator independence and replay

The fixed evaluator must be outside the candidate's writable/readable boundary. Define
which parts of scoring need an independent implementation and how floating reduction
order affects deterministic replay. Verify this with deliberately faulty candidates
and replay tests rather than relying on architectural intent.

### 9.6 First tasks and later brain-encoding work

Choose the first task by simplicity of its fixed reference, deterministic scoring,
small candidate representation, and ability to test the trust boundary. Expand toward
the paper's algorithmic tasks based on missing operations actually exposed by that
pilot. Brain encoding is a later, separate task family because it adds protected
response data, feature extraction, and evaluator-side regression.

## Appendix A — Evidence and reproduction

### A.1 The paper

```
# outside the repository
curl -fL https://arxiv.org/pdf/2611.18114 -o /tmp/iwsp-2611.18114.pdf
pdftotext -layout /tmp/iwsp-2611.18114.pdf /tmp/iwsp-2611.18114.txt
```

Version and date, from the PDF's own stamp on page 1: `arXiv:2611.18114v1 [cs.CE]`,
**13 Nov 2026**. Cited pages in this document are PDF page numbers.

Page map used above: §1 Introduction p. 1; §2 Method p. 3; §3 Algorithmic/NLP results
pp. 4–5; §4 Neuroscience results pp. 6–10; §5 Related works p. 11; §6 Discussion p. 12;
Appendix A.1 pp. 18–21 (Table A1 p. 19, Table A2 p. 19, Table A3 pp. 21–22); A.2 pp. 22–27; A.3 p. 28; A.4 p. 31; A.5 p. 33 (Table A7).

### A.2 Paper claims used in the operation inventory

| Operation | Paper location | Quoted or paraphrased |
|---|---|---|
| No training | p. 3 | "The model parameters must be set in closed form." |
| Architecture may change | p. 3 | "The agent may change the architecture and hard-code constants, including hand-built attention circuits and lookup tables." |
| Fixed evaluator | p. 3 | "one Python file ... a function write_weights(model, task) for the agent to fill in, and fixed code that evaluates the result" |
| Visible set, token-by-token | p. 4 | "a fixed visible set of 200 examples, where the answer is generated token by token and must match exactly" |
| Iterations | p. 3 | "30 to 50 iterations" (600 for the visual-cortex search, p. 6) |
| Auditor | p. 3 | "audited by a separate agent to test for the interpretability of the edits and any violations of the constraints" |
| Weight determinism | p. 3 | "rerunning each model's weight-writing code on altered task data leaves its weights unchanged" |
| Hidden set | p. 3 | "the models are reevaluated on a 'hidden set' that they never saw during the iterative loop" |
| Text bottleneck | p. 3 | "describe the best model for each task in at most 200 words, and then give only that description and the task to a fresh session" |
| Ridge readout is harness-side | p. 4 | "A fixed evaluator then fits a ridge regression model W from f(x)" |
| Agent may not read responses | p. 4 | "the rules forbid a model from reading any of the brain responses" |
| Feature cap | p. 4 | "the evaluation code rejects a candidate with 10,000 or more features" |
| Parameter cap | p. 6 | "fewer than 100,000 explicit parameters" |
| Compression | p. 4 | "compress the model parameters ... from about 3,400 parameters to about 200" |
| Parameter count as proxy | p. 3 | "Number of model parameters can help serve as a proxy for interpretability" |
| Median parameter counts | p. 19 (Table A2) | 166 / 41,600 / 100,000 for Opus / Sonnet / Haiku |
| Paper-specific precision claim | p. 21 (Table A3) | For one leakage model, the paper reports "leakage is about 1e-12 relative, so float64 is required (float32 breaks)"; this is evidence about that model, not a Pyash-wide requirement. |
| Sink scales | p. 21 (Table A3) | "scale about 1e17"; "scale about 1e22" |
| Hard argmax attention | p. 21 (Table A3) | "using hard argmax instead of softmax" |
| Argmax tie-break | p. 21 (Table A3) | "ties go to the lower id" |
| Tied block, 10× | p. 21 (Table A3) | "One tied block (one attention head, 2-neuron ReLU MLP) is applied 10 times" |
| ReLU knots | p. 21 (Table A3) | "4 ReLU knots at m·s·B/2 with alternating ±2 slopes" |
| Tropical decoder | p. 21 (Table A3) | "logit_k = k·X − place·k(k+1)/2 with place = 10^(20−t), whose argmax is floor(X/place)" |
| Sieve, cosine pulse | p. 22 (Table A3) | "pulse activation relu(1 + 10^4 (cos2πu − 1))" |
| Lateral inhibition | p. 22 (Table A3) | "2·pulse minus cumulative sum over smaller primes" |
| Gaussian copy head | p. 22 (Table A3) | "score −40(i−(s−5))2" |
| Letter codes | p. 22 (Table A3) | "each character is embedded as a 5-bit letter code with flags for word boundary, start and padding, plus position" |
| Five canonical operations | p. 22 (§A.2) | "power/log compression, half-wave rectification, quadrature energy, divisive normalization, and pairwise channel multiplication" |
| Filter bank | p. 22 (§A.2) | "convolved at three spatial scales with center–surround filters and oriented Gabor filters spanning eight orientations" |
| Surface geometry | p. 22 (§A.2) | "second derivatives of brightness to classify local brightness surfaces into five 3D shading primitives" |
| Foveated pooling | p. 22 (§A.2) | "summarized by their mean and spatial standard deviation over a foveated grid of image windows" |
| Per-block normalization | p. 22 (§A.2) | "normalized per block, yielding 9,996 explicit features" |
| Model size | p. 6 | "The final 865-line program produces 9,996 features from 14 explicit computations" |
| Rebuild fidelity | p. 6 | "fresh sessions given only a 185-word summary rebuild models that reach 0.451 pooled correlation (versus 0.488)" |
| Control vs described | p. 21 (Fig. A2) | rebuilt models "1.74 times the original's parameters on a geometric mean, against 2,043 times for the control" |

### A.3 Repository claims, with reproduction

All paths are relative to the repository root. These commands inspect the current
implementation; test counts are intentionally not frozen into this proposal.

```bash
# Current shared-core scalar numeric kinds and programlet capacity constants.
rg -n 'VALUE_FLOAT32|VALUE_FIXED16|MAX_PROGRAMLET_' \
  rust/pyac-vliw-core/src/semantics_runtime.rs

# Float32 quote and arithmetic semantics; fixed16 scale and arithmetic semantics.
sed -n '1,170p' rust/pyac-vliw-core/src/semantics_runtime/float.rs
sed -n '1,115p' rust/pyac-vliw-core/src/semantics_runtime/fixed16.rs

# Numeric behavior tests at the Rust core and Pyash VLIW layers.
(cd rust/pyac-vliw-core && cargo test --release)
node --test quiz/vliw_arithmetic.test.mjs quiz/vliw_vector_arithmetic.test.mjs

# Pack layout: the versioned header and codelet payload, with no model-weight field.
sed -n '30,65p' rust/pyac/src/lib.rs

# Shared core consumers; the RISC-V backend is a separate implementation.
rg -n 'pyac_vliw_core|semantics_runtime' rust/pyac/src rust/pyac-gpu rust/pyac-browser
rg -n 'struct .*Riscv|mod riscv|backend::riscv' rust/pyac/src/backend

# Existing bounded function-evolution code is not the complete iWSP workflow.
sed -n '1,100p' program/library/vliw/evolution.mjs
sed -n '1,100p' program/library/vliw/functions.mjs
```

The currently recorded GPU diagnostic artifact is a SPIR-V module, not a measurement of
the final driver-generated machine code:

- SPIR-V input: 2,620,320 bytes at
  `rust/pyac-gpu/target/diagnostics/function-reduction/20261119T052241Z-collect_sentence_at/generated/vulkan/pyac_vliw_gpu_kernel.spv`.
- Saved Vulkan pipeline cache: 9,643,999 bytes at
  `rust/pyac-gpu/target/diagnostics/pipeline-build-collect_sentence_at-20261119T052343Z/pipeline-cache.bin`.
- No extracted final machine-code size is recorded in that diagnostic run. A pipeline
  cache is not the same artifact as the executable GPU code, so neither figure should
  be described as the final generated code size.

### A.4 Repository paths cited

| Path | Role |
|---|---|
| `rust/pyac-vliw-core/src/semantics_runtime.rs` | Shared VLIW semantics for CPU, GPU, browser |
| `rust/pyac/src/lib.rs` | Pack encode/decode, numeric and section execution |
| `rust/pyac/src/backend/riscv.rs` | RISC-V backend |
| `rust/pyac-gpu/shader/src/lib.rs` | SPIR-V compute shaders |
| `rust/pyac-gpu/worker/src/bin/vliw_runtime.rs` | Standalone VLIW runtime service |
| `rust/pyac-browser/src/webgpu.rs` | Browser WebGPU path |
| `program/library/vliw/` | Lowering, quoting, programlets, pack database |
| `program/library/vliw/programlet.mjs` | `.pya` → `.pyac` compilation and execution |
| `program/library/vliw/evolution.mjs` | Bounded host-side candidate evolution |
| `program/library/vliw/functions.mjs` | Candidate function contract and scoring |
| `program/verbs/mathematics/neuron.mjs` | `neuron` verb: dot + bias + sigmoid |
| `program/verbs/mathematics/produce.mjs` | `produce` verb: dot product |
| `program/verbs/vector/index.mjs` | Vector read/write/invert by index |
| `program/verbs/vector_map.mjs` | Elementwise map over a vector, with index registers |
| `program/verbs/index.mjs` | Verb registration and signature tables |
| `program/bridge/index.mjs` | `interpret` — the dispatcher |
| `program/bridge/refinery.mjs` | Checkpointing, retry, resume |
| `program/bridge/exchange.mjs` | Artifact recording and hashing |
| `program/remember/index.mjs` | The fact store |
| `program/runtime/gpu/` | Queue, lease, Housekeeper adapter, worker capacity |
| `program/runtime/criterion/` | Benchmark/dataset/metric harness (an evaluator precedent) |
| `program/library/translation/english_wordnet_linker.mjs` | Sense linking |
| `program/library/translation/english_wordnet_bridges.pya` | Sense → anchor bridge records |
| `program/library/pyashWords.json` | The vocabulary table |
| `documentation/specifications/27-pyash-vliw-isa.md` | ISA and lowering contract |
| `documentation/specifications/28-pyash-vliw-targets.md` | Target capability selection |
| `documentation/specifications/11-translation.md` | Translation and sense-link contract |
| `documentation/reference/pyac-vliw-semantic-slices.md` | Proven semantic slices |
| `documentation/reference/pyash-vliw-compiler-architecture.md` | Compiler architecture and vocabulary contract |
| `documentation/reference/pyac-vliw-database.md` | `.pyac` container and future indexed image |
| `documentation/reference/gpu-housekeeper-architecture.md` | Housekeeper and runtime split |
| `documentation/roadmap.md` | The parity-first invariant |

### A.5 First-pass vocabulary anchors for the Transformer instruction set

These matches were checked with the local Kwon/WordNet/SUMO lookup on 2026-11-19.
IDs below are Open English WordNet 2025 senses. `=` marks an equivalent SUMO
concept; `+` means the WordNet sense is subsumed by the broader SUMO concept.
This is a sense-selection record, not a final Pyash compound or HNUC assignment.

| Instruction concept | WordNet 2025 sense | SUMO link | Fit |
|---|---|---|---|
| Vector value | `n:05873161-n`, variable quantity resolved into components | `FunctionQuantity` (`=`) | Direct mathematical sense |
| Tensor value | `n:05873065-n`, generalization of a vector | `Quantity` (`+`) | Useful parent concept |
| Matrix value | `n:08284561-n`, rectangular array of quantities | `ContentBearingObject` (`+`) | Direct mathematical sense |
| Matrix multiplication | `n:00874664-n`, multiplication of matrices | `Calculating` (`+`) | Direct operation sense |
| Dot/inner product | `n:05873468-n`, scalar product of two vectors | `MultiplicationFn` (`+`) | Direct operation sense |
| Sum reduction | `n:05869651-n`, sum of a group of numbers; action `v:00951320-v`, determine a sum | `AdditionFn` (`+`); action `Calculating` (`+`) | Direct operation/action senses |
| Division | `v:00643760-v`, perform a division | `Calculating` (`+`) | Direct operation sense |
| Exponentiation | `n:00874089-n`, raise a quantity to a power | `ExponentiationFn` (`=`) | Direct operation sense |
| Exponential function | `n:13811674-n` | `ExponentiationFn` (`=`) | Direct function sense |
| Square root | `n:13753980-n`, number whose square equals a given number | `SquareRootFn` (`=`) | Direct function sense |
| Maximum result | `n:13798337-n`, largest possible quantity | `Quantity` (`+`) | Result sense; `argmax` has no direct match |
| Normalize | `v:00469149-v`, make normal or conform to a standard; gloss includes temperature normalization | `IntentionalProcess` (`+`) | Broad parent for numeric normalization |
| Activation function | `n:13806028-n`, mathematical function/relation | No specific SUMO mapping captured | Parent only; no direct ReLU/GELU sense found |
| Softmax | No direct sense found | No direct SUMO concept found | Compose from maximum, subtraction, exponentiation, sum, and division |
| Embedding lookup | `n:13574763-n`, table lookup operation | `ContentDevelopment` (`+`) | Lookup is direct; learned embedding has no direct sense |
| Computer memory | `n:03749767-n`, electronic memory device | `ComputerMemory` (`=`) | Direct storage concept |
| Computer address | `n:06367922-n`, code identifying where information is stored | `ContentBearingObject` (`+`) | Direct addressing concept |
| Read computer data | `v:00629157-v`, obtain data from digital sources | No specific SUMO mapping captured | Direct read sense |
| Write computer data | `v:01000931-v`, record data on a computer | `Encoding` (`+`) | Direct write sense |
| Compare | `v:00654571-v`, examine similarities or differences | `Comparing` (`=`) | Direct comparison sense |
| Select | `v:00676526-v`, choose from alternatives | `Selecting` (`=`) | Direct selection sense |
| Parallel processing | `n:13539343-n`, simultaneous processing by multiple units | `ContentDevelopment` (`+`) | Direct execution-mode sense |
| Execute program | `v:02569242-v`, run a process or program on a computer | `PsychologicalProcess` (`+`) | Direct computer-execution sense |
| Synchronize | `v:00465909-v`, operate simultaneously | `Guiding` (`+`) | Broad concurrency parent; GPU barrier has no direct match |

`kernel launch`, `workgroup`, positional encoding, and causal masking have no
direct senses in these lookups. Kernel launch can use execution and parallel-
processing parents; the other concepts can link to their mathematical, indexing,
comparison, and selection parents. The Q/K/V “projection” in attention is a
matrix multiplication, so the mathematical matrix-multiplication sense is the
better anchor than the geometric projection sense.

### A.6 Proposed head-final compounds for current lexical gaps

Each proposal below is a two-part semantic composition. The component order is
modifier then head, and the final component names the compound's core concept.
The anchors are existing Open English WordNet 2025 senses and their verified
SUMO crosswalks from A.5. These are plan candidates only; they do not allocate
HNUCs or add entries to the accepted compound catalog.

| Missing term | Proposed compound | Component synset anchors | Composed meaning |
|---|---|---|---|
| Softmax | **exponential normalization** (`exponential` + `normalization`; head: `normalization`) | Exponential function `n:13811674-n`, `ExponentiationFn` (`=`); normalize `v:00469149-v`, `IntentionalProcess` (`+`) | Normalize exponentials across a vector into relative weights; a stable implementation may subtract the maximum first. |
| Argmax | **maximum position** (`maximum` + `position`; head: `position`) | Maximum quantity `n:13798337-n`, `Quantity` (`+`); list/sequence position `n:06495143-n` | Return the sequence position associated with the greatest value. |
| Neural activation function | **activation function** (`activation` + `function`; head: `function`) | Activation process `n:13447549-n`, `Process` (`+`); mathematical function `n:13806028-n` | A neural input-to-output mapping that applies an activation operation; “neural” is the domain in the gloss, keeping the compound at two parts. |
| Embedding as learned representation | **learned vector** (`learned` + `vector`; head: `vector`) | Learn/acquire knowledge `v:00599310-v`, `Learning` (`+`); vector quantity `n:05873161-n`, `FunctionQuantity` (`=`) | A vector-valued representation whose components are learned from data, such as a token embedding. |
| Kernel launch | **parallel execution** (`parallel` + `execution`; head: `execution`) | Parallel processing `n:13539343-n`, `ContentDevelopment` (`+`); execute a computer program `v:02569242-v`, `PsychologicalProcess` (`+`) | Start a kernel program across a configured set of concurrent work items. |
| GPU workgroup | **parallel group** (`parallel` + `group`; head: `group`) | Parallel processing `n:13539343-n`, `ContentDevelopment` (`+`); group `n:00031563-n`, `Group` (`=`) | A set of GPU work items scheduled as one cooperating unit. |
| GPU barrier | **group synchronization** (`group` + `synchronization`; head: `synchronization`) | Group `n:00031563-n`, `Group` (`=`); synchronization `n:01003039-n`, `IntentionalProcess` (`+`) | At a named point in the program, each computation instance in one assigned set pauses. None may proceed beyond that point until every instance in the set has reached it. |

The compounds name the computation or execution concept; exact Pyash component
words and HNUCs remain to be selected through the normal vocabulary workflow.

### A.7 Refinements for broad anchors and GPU identity

These refinements keep a broad WordNet/SUMO parent from being mistaken for an
exact technical synonym. The compounds remain semantic proposals; their
operation-level definitions belong in the VLIW specification.

| Concept | Compound or identity proposal | Sense anchors | Qualification |
|---|---|---|---|
| Vector normalization | **vector normalization** (`vector` + `normalization`; head: `normalization`) | Vector `n:05873161-n`, `FunctionQuantity` (`=`); normalize `v:00469149-v`, `IntentionalProcess` (`+`) | `normalize` is a broad conform-to-standard sense, not an exact numerical-normalization sense. Specify the numerical operation in the ISA contract. |
| Neural activation function | **activation function** (`activation` + `function`; head: `function`) | Activation `n:13447549-n`, `Process` (`+`); mathematical function `n:13806028-n`, `Function` (`+`) | The activation sense is biological/chemical stimulation, so this is a compositional label, not an exact neural-network synset. Define the supported activation operation separately. |
| Workgroup barrier | **group synchronization** (`group` + `synchronization`; head: `synchronization`) | Group `n:00031563-n`, `Group` (`=`); synchronization `n:01003039-n`, `IntentionalProcess` (`+`), or coordination `n:00809161-n`, `Cooperation` (`+`) | Both synchronization senses are broader than a GPU barrier. The compound gloss must specify workgroup scope and the wait-until-all-participants-arrive behavior; memory visibility remains an ISA/runtime rule. |
| Parallel kernel execution | **parallel execution** (`parallel` + `execution`; head: `execution`) | Parallel processing `n:13539343-n`, `ContentDevelopment` (`+`); computer instruction execution `n:13498665-n`, `ContentDevelopment` (`+`) | Prefer the computer-science execution sense over `v:02569242-v` (`PsychologicalProcess`) for this technical usage. “Launch” still describes starting this execution, not a separate exact synset found here. |
| GPU hardware concept | Project-local concept proposal: **graphics processing unit (GPU)**, with a stable local concept ID and definition | SUMO `ComputerComponent` under `ComputerHardware`; align functionally to parallel processing `n:13539343-n` and computer instruction execution `n:13498665-n` without claiming either is equivalent to a GPU | The local lookup found no exact GPU/graphics-processing-unit synset or SUMO class. SUMO's `ComputerComponent` is a valid parent, not the GPU concept itself. |

The accepted Pyash compound catalog currently resolves `GPU` to **video
processor module** (`byot ples myoc`). Treat that as an existing lexical
compound, not as evidence of a dedicated WordNet/SUMO GPU synset. The local
lookup's `video` sense is about displayed text and graphics, while its
available `processor` sense is not a graphics-processor definition. Keep the
existing spelling usable, but ground the technical GPU identity in the
project-local concept above rather than asserting a false exact crosswalk.

The SUMO computer ontology defines `ComputerComponent` as computer hardware
with measurable performance and includes processing and memory components; it
does not provide a GPU-specific class in the checked source. This supports the
parent choice while leaving the GPU as an explicit local specialization.

### A.8 Non-circular glosses for group execution

The synsets supply lexical anchors, but they do not fully specify GPU
execution semantics. Use the plain-language gloss as the definition; do not
define one technical term by repeating another unexplained technical term.

| Term | Non-circular gloss | Lexical anchors |
|---|---|---|
| GPU workgroup | A set of copies of a program, each handling part of one calculation at the same time. The program treats those copies as one set for designated checkpoints and group-scoped resources. | Group `n:00031563-n`, `Group` (`=`); parallel processing `n:13539343-n`, `ContentDevelopment` (`+`). |
| GPU group rendezvous (explanatory compound for a barrier) | A named point in the program where each copy pauses. No copy may execute instructions after that point until every copy in the same assigned set has reached it. | Group `n:00031563-n`, `Group` (`=`); rendezvous `n:01234113-n`, `Meeting` (`+`), a meeting planned for a time and place; wait `v:02644022-v`, `PsychologicalProcess` (`+`), stay in place while anticipating an event. These anchor the component ideas, not the GPU rule itself. |
| Execution barrier / group synchronization | The same operation as the group rendezvous above. “Group synchronization” is the conventional operation label; the gloss explains its effect without using “synchronize” or “barrier” as its definition. | The coordination senses in A.7 provide broad lexical parents; the group-rendezvous composition gives a more concrete, non-circular explanation. |
| Memory ordering | A separate rule stating which values one program copy stored before a point another copy is allowed to read afterward. Reaching the checkpoint alone does not define that rule; the opcode/API must say what becomes visible. | Computer memory `n:03749767-n`, `ComputerMemory` (`=`); computer instruction execution `n:13498665-n`, `ContentDevelopment` (`+`). |

Thus, a GPU barrier is not a physical wall and does not itself carry data: it
is a program point that holds the copies in one assigned set until every copy
in that set has arrived. Some GPU APIs also define which earlier memory stores
become visible at that point; that is a separate part of the operation's
contract. The exact participant set and behavior when control flow skips the
point must be stated in the VLIW/API operation contract. `Group rendezvous` is
an explanatory lexical candidate; it does not replace the established
technical name or allocate a Pyash form/HNUC.

### A.9 Candidate Pyash sentence signatures

These signatures connect the A.5-A.8 terms to the Pyash case grid. They are
surface proposals, not registered signatures, vocabulary assignments, or a
claim that the current VLIW runtime executes these operations. `from` names
the primary input/source, `by` supplies a second operand or mapper, `via`
selects an index, `with` supplies configuration, and `to` names the output.
Where a term names a value or execution configuration rather than an action,
the row gives its proposed map shape instead of inventing a verb.
The structured term/anchor/compound reference is
[`iwsp-transformer-terms.pya`](iwsp-transformer-terms.pya); it also records
partial mappings and the GPU compound review note from A.7.

| Term | Candidate Pyash use/signature | Meaning and current status |
|---|---|---|
| Tensor | `su name weights be map def`<br>`  su name shape ob ve num 2 3 ya`<br>`  su name dtype ob text "float32" ya`<br>`  su name values ob ve num ... ya`<br>`prah` | Represent a tensor as a map with explicit shape, element type, and flattened values. This is a proposed authoring/data contract; the current `ve` literal is rank-1 and the tensor map is not yet a VLIW value type. Specify dimension order and bounds before implementation. Lowering should store values contiguously rather than dispatching one map operation per element. |
| Matrix multiplication | `from name left by name right to name product be matrix multiplication do` | Multiply compatible matrices, with shape checks and a specified storage order. New operation; distinct from `kl6m psas` (dot product). |
| Dot product / sum reduction | `ob ve float32 ... by ve float32 ... be kl6m psas do` | `kl6m psas` is the catalog-linked Pyash compound glossed “dot product.” The shared Rust VLIW operation accepts equal-width float32/float64 vectors and returns one scalar; general sum reduction remains a separate operation. |
| Exponential normalization (softmax) | `from name logits to name probabilities be exponential normalization do` | Produce normalized exponential weights from a numeric vector. Define stable max-subtraction, accumulation precision, and behavior for empty or non-finite inputs in the operation contract. New operation. |
| Vector normalization | `from name values with name normalization options to name normalized be vector normalization do` | Normalize a vector under an explicitly selected norm (for example L1 or L2); options should include epsilon/zero-vector behavior. Distinct from exponential normalization. New operation. |
| Maximum position (argmax) | `from name scores to name selected index be maximum position do` | Return the index of the greatest element. Define ties as the lowest index for deterministic results. New operation; output is an index, not the maximum value. |
| Activation function | `from name preactivation by name relu to name activated be vector map do` | Reuse the existing vector-map sentence surface to apply a named scalar function elementwise. `vector map` currently runs through the JS interpreter; `relu` here is illustrative and needs a registered scalar mapper. A fused GPU activation is a later lowering/optimization, not a different meaning. |
| Learned vector / embedding | `from name embedding table via name token id to name embedding be embedding lookup do` | Return the learned row for a token ID. “Learned vector” names the result; lookup is the action. New tensor-indexing operation. Existing vector `read` handles a flat element, not a row from a rank-2 table. |
| Parallel execution / kernel launch | `from name kernel with name launch config to name results be parallel execution do` | Submit a kernel over the configured index space and return its result handle/data. This is a proposed compute operation, not `be gpu mind` or another Housekeeper inference request. |
| Parallel group / GPU workgroup | `su name launch config be map def`<br>`  su name grid dimensions ob ve num 128 ya`<br>`  su name workgroup dimensions ob ve num 64 ya`<br>`prah` | The map configures the total work-item grid and the cooperating group shape. These example dimensions are illustrative 1-D values, not defaults or a finalized schema. Workgroup membership is execution topology, not an independent computation verb. |
| Group synchronization / barrier | `from name workgroup be group synchronization do` | Every participant in the named group waits at this program point until all participants arrive. This is a proposed in-kernel control operation. Its scope, divergent-control behavior, and memory visibility rules must be explicit; memory ordering is not implied by the name alone. |
| Group rendezvous (explanatory alias) | `from name workgroup be group synchronization do` | Same operation and signature as the barrier row; explanatory wording only, not a second opcode or dispatch signature. |
| Memory ordering | `su name memory policy be map def`<br>`  su name scope ob text "workgroup" ya`<br>`  su name order ob text "acquire release" ya`<br>`prah` | A policy value to attach to future shared-memory access/synchronization operations. The field vocabulary and allowed orderings remain to be specified; this is not itself a barrier operation. |
| GPU device concept | `su name device profile be map def`<br>`  su name kind ob text "graphics processing unit" ya`<br>`  su name backend ob text "wgpu" ya`<br>`prah` | A device/profile description anchored to the project-local GPU concept. It identifies a compute target; it does not invoke Housekeeper and does not add a `gpu` verb. Final device identity/capability fields belong in the target contract. |
| Independent parallel sections | `su name first be myocpfun def`<br>`... section body ...`<br>`su name first be myocpfun prah` | This section form already exists in the VLIW pack surface for independent duties. It is the current Pyash-level way to mark section boundaries; runtime completion order may differ from source order. It does not yet express a GPU workgroup or a barrier inside a section. |

The proposed action spellings in this table use the English compound labels
from A.6-A.8 to make the case roles readable. They are placeholders until
the normal Kwon/WordNet/SUMO and vocabulary workflow chooses the actual Pyash
atoms or compounds and confirms their HNUCs. In particular, do not turn the
examples into runnable `.pya` examples until those names have accepted
vocabulary and registered dispatch signatures.

Implementation boundary from the current source audit: integer, float32, and
float64 vector literals run through the shared Rust CPU/GPU interpreter; JS
`vector map`, JS `produce` (dot product), and the `neuron` operation also exist;
independent `myocpfun` sections exist in the VLIW pack format. Matrix/tensor values,
matrix multiplication, softmax, argmax,
GPU-resident kernel launch, workgroup topology, and group synchronization
are not thereby implemented in the shared Rust VLIW CPU/GPU runtime. The
signatures above define candidate Pyash surfaces for the IWSP/transformer
work; each still needs spec, vocabulary, dispatch, CPU semantics, and GPU
conformance coverage before it is considered supported.
