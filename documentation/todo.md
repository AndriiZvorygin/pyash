# TODO

## Now
- Parity gaps to close (non-external):
  - Higher-level translation paths parity (interpreter/JS only; defer C parity until stable) [partial: typed top-level ceremony tranche completed; broader exclusions remain].
- Mind: plus streaming path and richer reply envelopes per `mind.md`.
- Docs sweep: remove stale `tloh` wording in documentation (it is deprecated; loops are `fromindex`/`toindex` stop-when-equal).

## Soon
- Expand verb coverage with quizzes for additional nouns/classes hinted in `pyac.txt` (models and pipeline nodes remain).
- Improve mind integration: streaming handling for Ollama responses and richer reply mapping (assistant/thinking/timestamps) per `mind.md`.
- Add error-handling paths for ceremonies/sandpits using `ret` with `be error`, and surface those in main memory/results.
- Strengthen CLI UX: document `./compile`, `./run`, `./interpret` case-parsed args; plus smoke tests for CLI wrappers.

## Completed bounded tranches
- Typed top-level ceremony translation parity: signature-derived JavaScript functions now validate typed calls, use fresh call frames, propagate `this`/`ret` payloads into caller targets, and have interpreter/JavaScript golden and regression coverage. Nested/dynamic, recursive, closure, imported, broader control-flow, and C paths remain deferred.
- Filename mutation standard verbs: canonical filename signatures, interpreter behavior, JS/C lowering, parity quizzes, and the runnable touch/copy/rename/delete example are complete.
- HNUC/compositional validation: the canonical 12×3 grid, parser/signature projections, deterministic injected-defect validator, operator-readable `be verify hnuc grammar do` workflow, and conformance documentation are complete. Remaining allocation gap: authoritative HNUCs and lexicon entries for `quantity.way`, `quantity.destination`, all three `limit` cells, and all three `sequence` cells, plus authoritative context codes for `quantity`, `limit`, and `sequence`; C/backend parity and broader translation coverage remain later work.
- Separate register-fact reliance: direct ceremony/loop parity now keeps `fromindex`, `toindex`, `atindex`, and register-form `by` on the active evoking sentence; named returns preserve payloads without inheriting stale target control state, while explicit role returns remain supported. Mapper/refinery provenance and unsupported nested/imported/compiler mid-loop register mutation remain later work.

## Later
- Explore lowering parsed sentences into graph/IR forms for future backends (shell/SQL/IR), aligning with the interlanguage vision.
- Revisit broader spec features (phonology, noun classes, control constructs from `pyac.txt`) when the interpreter foundations are stable.
- Introduce result tracking with per-command IDs instead of generic `result`, to support richer history and debugging.
