# Decisions

- **Keywordized compositional cases**: Convert axis+context into single-token keywords (e.g., `fromtext`, `during`, `as`, `become`, `totext`) rather than storing `{context: …}`. Chosen for simplicity, testability, and alignment with `compositional-cases.md`; arrays of contexts were rejected to keep one winner per role.

- **Store all moods in memory**: `ya`, `def`, and `do` sentences are recorded to preserve history. Imperatives also create a result fact. Chosen to aid reproducibility and debugging; omitting `do` from history was rejected.

- **Result facts for imperatives**: Always store a `result` fact with normalized `obj` (and `be` from verb or `result`). Chosen to make REPL/testing expectations explicit; fabricating ad-hoc subjects per verb was deferred.

- **Dynamic verb dispatch for type combos**: `add`/`read` load handlers based on operand types/inputs (e.g., `add_obj_num_to_num.mjs`, `read_from_filename.mjs`). Chosen for extensibility; a monolithic switch was rejected.

- **Mind configuration as declarative fact**: Register minds with keyword roles (`from`, `as`, `accordingto`) and reuse on invocation. Chosen to align with `mind.md` and compositional mapping; embedding config per call was rejected.

- **Quiz-first workflow**: Red→green enforced; new features start with failing quizzes. Chosen to enable evolutionary growth and safe model proposals; informal ad-hoc coding was rejected.

- **Minimal JS-first runtime**: Native ESM, built-in `node:test`, no DB. Chosen for hackability and clarity; heavier frameworks and persistence are deferred.

- **Out-of-scope (for now)**: Phonology, noun classes, tense/aspect controls, GPU/IR compiler path from `pyac.txt`. Acknowledged but postponed to keep the current interpreter slice small and testable.
