# Decisions

- **Keywordized compositional cases**: Convert axis+context into single-token keywords (e.g., `fromtext`, `during`, `as`, `become`, `totext`) rather than storing `{context: …}`. Chosen for simplicity, testability, and alignment with `compositional-cases.md`; arrays of contexts were rejected to keep one winner per role.

- **Store all moods in memory**: `ya`, `def`, and `do` sentences are recorded to preserve history. Imperatives also create a result fact. Chosen to aid reproducibility and debugging; omitting `do` from history was rejected.

- **Result facts for imperatives**: Always store a `result` fact with normalized `ob` (and `be` from verb or `result`). Chosen to make REPL/testing expectations explicit; fabricating ad-hoc subjects per verb was deferred.

- **Dynamic verb dispatch for type combos**: `add`/`read` load handlers based on operand types/inputs (e.g., `add_obj_num_to_num.mjs`, `read_from_filename.mjs`). Chosen for extensibility; a monolithic switch was rejected. The `understand` verb is parse-to-JSON only; no JS emission yet.
- **Translation/compile**: `compile` currently emits basic JS or C declarations from Pyash sentences; `translation` renders Pyash text into simple English strings (“alpha is number 1.”). Both use signature-first dispatch and store results under the addressed target.

- **Mind configuration as declarative fact**: Register minds with keyword roles (`from`, `as`, `accordingto`) and reuse on invocation. Chosen to align with `mind.md` and compositional mapping; embedding config per call was rejected.

- **Quiz-first workflow**: Red→green enforced; new features start with failing quizzes. Chosen to enable evolutionary growth and safe model proposals; informal ad-hoc coding was rejected.

- **Minimal JS-first runtime**: Native ESM, built-in `node:test`, no DB. Chosen for hackability and clarity; heavier frameworks and persistence are deferred.

- **Out-of-scope (for now)**: Phonology, noun classes, tense/aspect controls, GPU/IR compiler path from `pyac.txt`. Acknowledged but postponed to keep the current interpreter slice small and testable.

- **Signature dispatch restored**: The bridge now dispatches imperatives and conditions via signature handlers first (builtin signatures registered at startup, ceremony `def` headers register their signatures), with legacy verb-map fallback removed entirely. Unknown/mismatched signatures surface as `Unknown verb: ...`. Write-backs run through sandpits with strict return handling (numeric signatures must return a value).

- **Exists emits sentence objects, not scalars**: Compiled `exists … ya` now produces `let <name> = { su, ob, be, exists, mood }` (not raw scalars) to stay ABI-aligned with the interpreter and later ceremony codegen. Reassignment reuses the same fact shape.

- **Vector `at all` uses map helper**: Mapping over vectors with primitive verbs (`add`, `subtract`, `invert`) lowers to an inline `map`/`runAtAll` helper rather than ceremony-only paths. The helper feeds per-element sentences, preserves `atindex`, and writes results either in-place or to `to` targets.

- **Remember shim returns undefined for missing names**: The JS prelude shim now resolves objects, globals by name, or `undefined` (no implicit fallback objects). This avoids silent truthy objects that masked missing facts during compilation/run.
