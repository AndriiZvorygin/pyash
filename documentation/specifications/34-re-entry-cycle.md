# `34-re-entry-cycle.md` (draft v0.1)

## Re-entry Cycle — Why, How, What

### Why (RPT motivation)

Autoregressive LLMs process inputs in a single forward sweep per token. That limits correction,
global coherence, and error recovery. **Recurrent Processing Theory (RPT)** highlights that refinement
comes from *re-entering* the same task with feedback before accepting an outcome. The goal here is
**RPT-1+**: system-level recurrence achieved through orchestration, without changing model weights.

| System pattern          | Recurrence locus              | Approx RPT |
| ----------------------- | ----------------------------- | ---------- |
| Single-pass AR LLM      | token sequence only           | ~0.5       |
| AR LLM + re-entry       | external task re-entry        | ~1.0–1.2   |
| Diffusion LLM           | intrinsic latent refinement   | ~1.5       |
| Human perceptual cortex | intrinsic multi-area feedback | ~2         |

The Re-entry Cycle delivers the first meaningful jump using existing models and tooling.

---

### How (mechanism)

The system intentionally **re-enters the same task** multiple times. Each pass produces a draft,
receives critique, applies revisions, and may be judged. Feedback from earlier passes shapes later ones.
The recurrence lives in **control flow** (`fromindex … toindex … do`), not inside the model.
One mind or multiple minds may be used; both qualify as RPT-1 because the task itself is what is re-entered.

---

### What (the spec)

A **Re-entry Cycle** is a bounded, deterministic outer cycle implemented as a ceremony (or refinery)
that repeats a fixed attempt ceremony. Each attempt follows the same stages and then loops back to the
supervisor, which advances the index and invokes the next attempt.

---

## Sample prompts (normative examples)

**Draft (author mind)**

```
Task:
{{TASK}}

Produce a concise, structured candidate answer.
State assumptions explicitly when needed.
```

**Critique (critic mind)**

```
Review the candidate.
Return:
1) Issues list (bullets)
2) Patch plan (numbered, concrete edits)
Candidate:
{{CANDIDATE}}
```

**Revise (author mind)**

```
Apply the patch plan to the candidate.
Return only the revised candidate.
Patch plan:
{{PATCH}}
Candidate:
{{CANDIDATE}}
```

**Judge (judge mind, optional)**

```
Score on correctness, completeness, constraint adherence, clarity.
Return only JSON:
{"score":0.0,"notes":"..."}
Revised candidate:
{{CANDIDATE}}
```

---

## Control flow (where it loops back)

```pyash
su name re-entry cycle be ceremony def
  ; evoker provides ob text <task>, fromindex <start>, toindex <limit>

  fromindex 0 toindex toindex of this
  be re-entry attempt do
prah
```

After each `re-entry attempt` completes, control returns to the supervisor, `fromindex` advances, and
the attempt ceremony is invoked again. The cycle ends when the bound is reached (or earlier by runner policy).

---

## Loop exit on judge pass (normative pattern)

If a judge is used, the cycle SHOULD terminate early when a pass threshold is met.
The supervisor can force loop exit by setting `fromindex` equal to `toindex`.

Example (illustrative):

```pyash
su name re-entry cycle be ceremony def
  fromindex 0 toindex toindex of this
  be re-entry attempt do
prah
```

Notes:
* If a judge score is available in the attempt, the attempt can end the loop by returning
  `fromindex` equal to `toindex` (see example below).
* The exact score placement is implementation-defined; the key requirement is deterministic exit.
* If no judge is used, the cycle runs to the bound.

Example (early exit inside the attempt):

```pyash
su name re-entry attempt fromindex num 0 toindex num 0 be ceremony def
  ; judge writes score into `su name score` (0..1)
  su name score be giant from num 0.8 then
  this fromindex num of toindex of this ret
  this ret
prah
```

---

## Single attempt (one pass)

```pyash
su name re-entry attempt be ceremony def

  su name task ob text ob of this ya

  ; draft
  su name draft out
  ob text task
  for name author
  to name draft out
  be write do

  ; critique
  su name critique out
  ob text draft out
  for name critic
  to name critique out
  be write do

  ; revise
  su name revised out
  ob text critique out
  for name author
  to name revised out
  be write do

  ; judge (optional)
  su name judged out
  ob text revised out
  for name judge
  to name judged out
  be write do

prah
```

---

## Verifier report bundle (subsection)

The verifier loop MUST emit a deterministic report bundle per run.

### Bundle location

```
artifacts/reports/<run-id>/
```

### Required files

#### `report.pya`

Pyash sentences, one per line:

```
su name report run id ob text "<run-id>" be report ya
su name report run time ob date <iso8601> be report ya
su name report run root ob filename "<absolute path>" be report ya
su name report source ob filename "<path>" be report ya
su name report status ob text "pass|fail" be report ya
su name report quiz count ob num <n> be report ya
su name report quiz passed ob num <n> be report ya
su name report quiz failed ob num <n> be report ya
su name report quiz skipped ob num <n> be report ya
su name report artifacts ob ve text "<rel>" "<rel>" be report ya
su name report notes ob ve text "<note>" "<note>" be report ya
```

Rules:

* `report artifacts` and `report notes` vectors MUST be sorted ASCII.
* `report status` MUST be `fail` if any quiz failed.
* `report source` MUST be:
  * the `.pya` path if `./run` was used, or
  * `"(inline)"` if stdin/inline input.

#### `quiz.pya`

Pyash sentences, ordered lexicographically by quiz `name`:

```
su name quiz "<name>" ob text "<file>" as text "<status>" by num <duration_ms> be quiz ya
su name quiz "<name>" ob text "<file>" as text "fail" by num <duration_ms> to text "<message>" be quiz ya
```

#### `summary.pya`

```
su name report summary be map def
  su name run ob text "<run-id>" be report ya
  su name time ob date <iso8601> be report ya
  su name status ob text "pass|fail" be report ya
  su name quizzes ob text "<passed>/<total>" be report ya
  su name failures ob num <n> be report ya
prah
```

### Optional files

* `diff.pya` — text diff lines as `su name diff line ... be report ya` (if produced).
* `env.pya` — stable environment inputs as `be ecology`-style sentences (optional).
* `tools.pya` — tool call summaries as `be tool` events (optional).

### Determinism rules

* Files are Pyash sentences (one per line).
* Lists must be sorted ASCII.
* Timestamps must be ISO 8601 with offset if known.
* Paths must be normalized to use `/`.

### Error handling

If the verifier cannot write the report bundle, it MUST emit:

```
su name report defective ob text "<reason>" from name verify be error ya
```

---

**Classification note:** This spec achieves **RPT-1+** because later passes incorporate feedback
from earlier passes through deliberate re-entry. Using different models for author, critic, or judge
remains valid, since recurrence is defined at the system level.
