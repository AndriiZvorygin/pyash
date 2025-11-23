# TODO

## Now
- Land remaining verb gaps:
  - Add streaming/richer mapping for `mind`.
  - Fill subtraction/conditional patterns (done).
- Make conditional loops write back mutated targets from sandpits (done for `to` targets).
- Document and test chaining scenarios (`result` feeding subsequent calls; subject-to-subject conditionals).

## Soon
- Expand verb coverage with tests for additional nouns/classes hinted in `pyac.txt` (e.g., files/models/pipeline nodes) before adding code.
- Add hnuc/code validation utilities for compositional cases to align runtime with `compositionalCases.mjs` and the longer-term spec.
- Improve mind integration: streaming handling for Ollama responses and richer reply mapping (assistant/thinking/timestamps) per `mind.md`.
- Add error-handling paths for ceremonies/sandpits using `ret` with `be error`, and surface those in main memory/results.

## Later
- Explore lowering parsed sentences into graph/IR forms for future backends (shell/SQL/IR), aligning with the interlanguage vision.
- Revisit broader spec features (phonology, noun classes, control constructs from `pyac.txt`) when the interpreter foundations are stable.
- Introduce result tracking with per-command IDs instead of generic `result`, to support richer history and debugging.
- Remove reliance on separate register facts (e.g., `tloh`/`until`); keep the evoking sentence as ground truth and derive any register lookups from it (in progress).
