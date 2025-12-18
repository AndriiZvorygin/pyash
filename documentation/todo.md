# TODO

## Now
- C backend MVP parity (JS remains reference):
  - Add loop lowering (`fromindex`/`toindex`) for C and cover with gcc+run quizzes.
  - Add conditional lowering variants (`tiny`/`giant` as `<`/`>`) and cover with gcc+run quizzes.
  - Start a C vector runtime (or choose a simpler C representation) to support 10/100 doors in C.
- Mind: add streaming path and richer reply envelopes per `mind.md`.
- Docs sweep: remove stale `tloh` wording in documentation (it is deprecated; loops are `fromindex`/`toindex` stop-when-equal).

## Soon
- Expand verb coverage with quizzes for additional nouns/classes hinted in `pyac.txt` (e.g., files/models/pipeline nodes) before adding code.
- Add hnuc/code validation utilities for compositional cases to align runtime with `compositionalCases.mjs` and the longer-term spec.
- Improve mind integration: streaming handling for Ollama responses and richer reply mapping (assistant/thinking/timestamps) per `mind.md`.
- Add error-handling paths for ceremonies/sandpits using `ret` with `be error`, and surface those in main memory/results.
- Strengthen CLI UX: document `./compile`, `./run`, `./interpret` case-parsed args; add smoke tests for CLI wrappers.

## Later
- Explore lowering parsed sentences into graph/IR forms for future backends (shell/SQL/IR), aligning with the interlanguage vision.
- Revisit broader spec features (phonology, noun classes, control constructs from `pyac.txt`) when the interpreter foundations are stable.
- Introduce result tracking with per-command IDs instead of generic `result`, to support richer history and debugging.
- Remove reliance on separate register facts (e.g., `fromindex`/`toindex`); keep the evoking sentence as ground truth and derive any register lookups from it (in progress).
