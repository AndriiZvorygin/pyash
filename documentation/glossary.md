# Glossary

- **Pyash**: Experimental language using linguistic universals; sentences are verb + typed noun phrases in named roles.
- **Case (axis × context)**: Compositional role system; mapped to keywords (e.g., `fromtext`, `during`, `become`, `totext`, `as`). Defined in `program/library/compositionalCases.mjs`.
- **Mood**: Sentence force; supported moods here: `ya` (declarative), `def` (definition), `do` (imperative), `que` (query), `then` (conditional follow-up).
- **Verb**: Action handler dispatched by `program/bridge/index.mjs` (e.g., `add`, `giant`, `understand`, `mind`, `read`). Dynamic dispatch verbs (add/read) load type-specific handlers.
- **Memory**: In-memory history of sentences/facts (`program/remember/index.mjs`); `interpret` stores `ya/def/do` and result facts for imperatives.
- **Result fact**: Generic fact stored after imperatives with `subj result`, normalized `obj`, and `be` from verb or `result`.
- **Mind**: LLM-backed verb (`program/verbs/mind.mjs`) using config stored under a subject (`from` endpoint, `as` model, `accordingto` prompt) and calling Ollama HTTP (`program/motor/ollama.mjs`).
- **Understand**: Verb turning Pyash text into parsed sentences + JSON via `program/program.mjs`; stores output in memory (parse-only).
- **Read**: Verb that loads content (e.g., `program/verbs/read_from_filename.mjs`) and stores text.
- **Program**: `program/program.mjs` builds sentences/labels from plain text; used by understand.
- **REPL**: `program/main.mjs` interactive loop with `mem/reset/quit` commands for manual testing.
- **`documentation/pyac.txt`**: 2019 language/spec vision (phonology, cases, compiler, GPU ideas); current runtime implements a thin subset.
- **`documentation/pyash.md`**: High-level design goals and principles (grammar-driven dispatch, interlanguage intent, evolutionary growth).
- **`documentation/compositional-cases.md`**: Details compositional case grid, keywords, and context mapping.
