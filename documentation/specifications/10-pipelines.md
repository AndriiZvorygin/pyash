# 10. Pipelines

Purpose: define procedure declarations (currently spelled `refinery`), stage execution semantics, and deterministic re-entry loops.

## 1. Terminology and pipeline vocabulary

The executable construct is a dependency-ordered procedure. The current public
word `refinery` is retained for compatibility, but its WordNet links name the
purification process (`n:13489509-n`) and industrial plant (`n:04075553-n`),
not a software workflow. `workflow` (`n:00251010-n`) means progress or rate of
work, and `pipeline` (`n:03952601-n`) means a physical pipe; neither is the
preferred concept. The better overall sense is `procedure` (`n:01025762-n`):
"a particular course of action intended to achieve a result." Its current
Pyash compound candidate is `rwoc hrom` (sequential + program, accepted-LLM;
not yet a curated catalog decision).

| Concept | Runtime meaning and current surface | WordNet evidence and current Pyash link | Terminology decision |
| --- | --- | --- | --- |
| Procedure | Whole declared, executable stage graph; `be refinery` | `n:01025762-n`, course of action intended to achieve a result -> `rwoc hrom` (accepted-LLM candidate) | Preferred future public concept: `procedure`; retain `refinery` until a coordinated migration. |
| Run | One execution of a declared procedure; currently produces a run id and artifact folder | No exact local sense or Pyash compound selected | Keep distinct from the reusable procedure declaration; do not use `pipeline` as a synonym. |
| Stage | One uniquely named execution unit; its name is ordinary `su name` data, not a special `stage` token | `n:13962925-n`, identifiable position in a series or process -> `degree` / `tlut tsuk` (accepted-LLM candidate) | Keep `stage` as the readable term; do not treat the name suffix as dispatch grammar. |
| Dependency | A required predecessor whose result is passed to a stage; expressed by `from name` or `from ve name` | `n:14024833-n`, state of relying on something -> `blas drat` (accepted-LLM candidate) | Use `dependency` for the graph relation; the `from` case remains the executable encoding. |
| Input | Data supplied to a procedure or stage | `n:03578305-n`, a component of production -> `nrup` (`myoc nrup` compound candidate) | Keep `input` as the concept; distinguish input data from the `from` case that carries it. |
| Output contract | `to name <type> <handle>` declares the expected output handle and type; the runner checks that the stage writes it | `n:03866402-n`, what is produced in a period -> `kwin psas` (candidate) | The handle/type are the contract, not the produced value itself. |
| Result | The sentence/value produced by one stage or by the procedure run | `n:11430739-n`, a caused consequence or outcome -> `ksik` | Keep result distinct from its output handle and from the durable artifacts that record it. |
| Export | Facts retained from a stage for later stages to resolve by name | No exact local sense or Pyash compound selected | Treat exports as scoped data handoff, not as the whole stage result. |
| Checkpoint | Runner-generated durable stage record used for trace and conditional reuse/resume; not a user-authored stage | No exact local WordNet suggestion. Supporting senses include record `n:06659969-n` and resume `v:00350937-v`; these do not individually mean a software checkpoint. | Define the Pyash-local concept by its runtime behavior; do not claim a direct WordNet equivalent. A head-final compound requires catalog review. |
| Retry | Bounded re-execution/reporting after a failed stage; current event `be reiterate ya` | `v:00960366-v` means say/state/perform again -> `dret hsac` (iteration + say). A closer concept combines `v:01738383-v` (perform again) with `v:02535833-v` (attempt); `htas tsic` is a proposed, unreviewed compound. | `reiterate` is the current compatibility surface. The intended concept is repeating an attempt, not repeating prose; any replacement compound needs catalog review. |
| Resume | Continue a procedure from a valid prior checkpoint | `v:00350937-v`, return to a previous location or condition -> `htas hrek` (again + restore, accepted-LLM candidate) | Use `resume` for continuation; it is distinct from retrying a failed stage. |
| Conduct | Optional map selected by `under name`; configures the deterministic simulation contract | `v:02450374-v`, direct the course of; current atom `kfan` | Treat this as a run-policy/configuration map, not a procedure or stage. Keep the current spelling pending a better catalog-backed term. |
| Platform | Legacy implementation variable and runtime error prefix for a stage | No separate public vocabulary role | Use `stage` in new terminology. Existing error names retain `platform` until a versioned runtime migration; `be platform` declarations remain deprecated. |

`accepted-LLM` identifies a current compound-catalog status, not an approved
semantic decision. A proposed public encoding must be backed by its exact
WordNet sense and reviewed Pyash components. When no exact sense fits, use a
non-circular Pyash gloss and record the component senses; do not force a nearby
but misleading synset.

`from` and `to` are grammatical cases, not synonyms for dependency or output.
An omitted `from` on a stage means dependency on the preceding stage; it does
not make the stage independent. Independent VLIW `myocpfun` sections have a
different contract and cannot consume one another's local state.

### Checkpoint record and handoff

The refinery runner emits a checkpoint after each completed stage; `.pya`
authors declare stages and dependencies, not checkpoint sentences. A
checkpoint records the stage name, procedure name, hash derived from the
action, dependency results, and relevant loop/scope state, result sentence and
line, exported facts, and local scope. Reuse requires that hash to match and
referenced output files to still exist. For a stage with dependencies, the last
listed dependency supplies the current input evoke; exported facts from
completed stages are also restored and available by name. This checkpoint is
run evidence and resume state, not a security boundary or a VLIW parallel
section.

### Procedure grammar and runtime surface

| Keyword | Meaning | Application |
| --- | --- | --- |
| `be refinery def ... prah` | procedure declaration block (current spelling) | define ordered stages |
| `su name <stage>` | stage identifier | unique stage node |
| `from name ...` | single dependency link | explicit prior-stage requirement |
| `from la ... ko` | embedded invocation clause | pass callable sentence template |
| `from ve name ...` | multi-dependency link | explicit prior-stage requirements |
| `be evoke do` (clause mode) | execute embedded clause template | deterministic per-call output override |
| `be refinery do` | execute procedure | create one procedure run |
| `be better compare do` | pairwise comparison loop | module-driven candidate selection |
| `be chirp do` | chirp manuscript procedure | source-grounded problem/cause/insight compression |
| `be reiterate ya` | retry marker | bounded retry reporting |
| `be checkpoint ya` | checkpoint marker | deterministic reuse/trace |
| `under name <conduct>` | procedure conduct association | select a source-local run contract |

## 2. Canonical staged procedure pattern (current spelling)

```pyash
su name plan loop be refinery def
su name plan stage ob name input for name planner to name text plan out be write do
su name execute stage ob name plan out for name worker to name text draft out be write do
su name verify stage ob name draft out for name checker to name text verdict out be write do
prah

ob text "task" from name plan loop to name text result be refinery do
```

## 3. Determinism rules

- stage ordering deterministic,
- explicit fail/success path,
- bounded retry behavior,
- replay visibility through run recording.

Each procedure run has one semantic destination and one artifact folder. The
destination names the goal state; stage outputs, manifests, checkpoints, queue
evidence, and other durable products remain artifacts of that run.

Nested procedure invocation:
- a procedure call may target either a registered procedure name or a procedure-backed `.pya` program file,
- canonical file-backed call shape is `from filename "<program>.pya" ob name <bindings map> to name map <result> be refinery do`,
- the bindings map keys must match the target program's `be input ya` handles,
- the result map should expose the child `produce`, child `sort`, child `run id`, child `artifacts folder`, and child `result file`,
- checkpoint replay must preserve the typed result payload for procedure results, including `map` and `series` outputs,
- child artifacts should nest under the parent run id when a parent run id exists.

Dependency encoding rule:
- use `from name <dep>` when exactly one dependency is referenced,
- use `from ve name <dep1> name <dep2> ...` when multiple dependencies are referenced.
- an explicit empty `from ve name` is a root with no dependencies,
- when `from` is omitted, the stage retains the implicit dependency on the preceding stage.

Terminology migration is staged. Current `.pya` programs continue to use
`be refinery` and `be reiterate`; no runtime or vocabulary catalog changes are
implied by this specification update. A later migration may register the
reviewed procedure and retry terms, update examples and diagnostics, and retain
the old surfaces as readable compatibility forms while tracked and external
uses are audited. Internal `platform` labels can then be renamed to `stage`
without changing the stage-result contract.

## 3.1 Deterministic concurrency simulation v0.1

Simulation is activated only by an existing procedure invocation with a conduct
association:

```pyash
from name <procedure> to name text <result> under name <conduct> be refinery do
```

The conduct is a source-local Pyash map. Its bounded contract is:

```pyash
su name <conduct> be map def
su name artificial ob bool truth ya
su name seed ob num <0..4294967295> ya
su name start tick ob num <nonnegative integer> ya
su name parallel capacity ob num <positive integer> ya
su name waiting capacity ob num <nonnegative integer> ya
su name schedule newspaper ob bool <truth|lie> ya
prah
```

`artificial`, `seed`, `start tick`, `parallel capacity`, and `waiting capacity`
are required when artificial mode is truth. `schedule newspaper` is optional and
defaults to lie. Any missing, non-boolean, non-integer, negative, out-of-range,
or zero parallel capacity value is one canonical
`artificial conduct defective` error; values are never coerced.

On a stage, `during num N` is its positive unsigned-32-bit simulated duration
in ticks. Optional `atmost num N` is a positive unsigned-32-bit stage-relative
simulated timebox. A completion at exactly
the deadline succeeds; only a completion after the deadline times out.

Artificial stage bodies are never invoked. Real procedure execution remains
sequential and simulation metadata does not alter real stage semantics. When
`artificial` is lie, the conduct association selects that ordinary sequential
procedure path rather than the simulation kernel.

The simulation uses unsigned 32-bit FNV-1a over the UTF-8 stage name, XORs
the result with the unsigned seed, and applies one xorshift32 round (`13`, `17`,
`5`). Scheduling ties sort by that rank and then by UTF-8 stage name. At each
virtual tick the kernel processes successful completions, expirations, dependent
cancellation, waiting promotion, new admission, and starts, in that order. It
jumps directly to the next completion or deadline and never sleeps. Idle active
slots are filled before the bounded waiting queue. Excess eligible stages
remain pending and receive one denied-admission record.

The exact ordered concurrency records are:

```pyash
su name <stage> from name <procedure> during num <tick> by num <ordinal> be schedule admission ya
su name <stage> from name <procedure> during num <tick> by num <ordinal> be schedule start ya
su name <stage> from name <procedure> during num <tick> by num <ordinal> be schedule finish ya
su name <stage> ob text "schedule crowded" from name <procedure> during num <tick> by num <ordinal> be schedule crowded ya
su name <stage> ob text "platform timebox" from name <procedure> during num <tick> by num <ordinal> be error ya
su name <stage> ob text "platform cancel" from name <procedure> during num <tick> by num <ordinal> be error ya
```

The `during` field is the virtual tick, and `by num` is a monotonically
increasing decision ordinal. Schedule records (admission, start, finish, and
crowded) are emitted only when `schedule newspaper` is truth. Timebox and
dependent-cancellation fault sentences are always surfaced. Cancellation faults
at one tick are ordered by UTF-8 stage name. Zero-capacity and no-progress
states use the same canonical `artificial conduct defective` error instead of
looping.

## 4. Re-entry loop requirements

Review/coding loops must declare:
- explicit stop condition,
- bounded attempt count,
- recorded pass/fail decision.

## 5. Scheduling integration

Refineries may be triggered by calendar/scheduler services; scheduler control lives in agent/world specs.

The filename-backed `be learn do` pipeline uses the same dependency shape for
large sources: independent chunk extraction fans out with bounded concurrency,
then sibling merge groups fan out within each merge layer, and the next layer
waits for those results. `PYA_LEARN_PARALLELISM` controls the pipeline fan-out
(bounded to eight); when unset, `PYA_GPU_WORKER_CONCURRENCY` is respected and
the default is four. Child mind calls automatically use the durable GPU lane
when `PYA_GPU_HOUSEKEEPER_URL` is explicitly configured, while an explicit
`PYA_GPU_MIND_QUEUE=false` keeps direct execution for local debugging.

## 6. Comparison refinery module profile (normative)

`be better compare do` is a pairwise comparison loop profile for module-driven candidate selection.
Use the dedicated reference profile for full input/flow/judge/observability contract.

## 7. Conformance

Implementation conforms when refinery execution + retry/stop logic are deterministic and observable.

For the pairwise profile (see reference), conformance additionally requires:
- required `from la ... ko` embedded manuscript invocation input shape,
- required clause-mode `evoke` generation with explicit `to` override for `A`/`B`,
- deterministic winner normalization,
- bounded termination via required `atmost` (canonical `atmost num 6`),
- exact `A`-wins-twice stop behavior.

For the chirp profile (see reference), conformance additionally requires:
- exactly one valid source mode (`ob text`, `from name text`, or `from filename`),
- staged atom and draft order (`problem -> hidden cause -> insight`, plus optional `proof hook` and `boundary`) with dependency-correct prompts,
- mandatory per-stage word-count + letter-count verification,
- stage-local bounded retries (no full-refinery retry for single-stage failures),
- final assembled output within total word/char target bounds or deterministic failure.

## 8. References

- Better compare refinery profile (reference): `documentation/reference/better-compare-refinery.md`
- Chirp refinery profile (reference): `documentation/reference/chirp-refinery.md`
- Brief manuscript refinery profile (reference): `documentation/reference/brief-manuscript-refinery.md`
- Verify count modes profile (reference): `documentation/reference/verify-count-modes.md`
- Full details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- LLM generation recipe: `documentation/recipes/refinery-planning-llm.md`
