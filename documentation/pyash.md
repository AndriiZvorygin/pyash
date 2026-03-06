Pyash is a small experimental language built on **human linguistic universals**. It treats grammar as the API surface for code and is designed as an **interlanguage** between all human languages and all computer languages, from assembly level on up.

Its long-term aim is to be a **Turing-complete, general-purpose language**, but one that is *grown* rather than hand-designed, using LLMs and evolutionary programming. Workflows, pipelines, and orchestrations are the main early focus because they give clear structure and strong feedback for this evolutionary process.

At its core, a Pyash sentence is a **verb plus a bundle of typed noun phrases** in named cases. The verb does not “do the work” directly. Instead, it inspects the cases and noun classes and **dispatches** to an underlying implementation. Think of it as multiple dispatch over grammatical roles rather than positional arguments. This keeps the surface close to natural language while giving a precise, machine-friendly structure.

Because it is based on linguistic universals, the same Pyash core can be:

* rendered into different human languages (for example English, Interslavic),
* compiled or mapped into different machine targets (Node.js, shell, SQL, assembly-like IRs, domain-specific VMs),

so Pyash becomes a stable **pivot language** between people and machines.

---

### Mascot and naming

Pyash uses the raven as its mascot. A plausible deep-time framing is that a Raven cycle consolidated around the Kamchatka Peninsula during late Ice Age coastal life, roughly 20,000 ± 5,000 years ago, when peoples across Beringia and adjacent Northeast Asia lived within long-running northern networks and later dispersed into the Americas. In this telling, Raven as Kutkh / Big Raven becomes a portable world‑making imagination: a shapeshifter who can cross forms, steal or release essentials like light and fire, teach skills, and reshape a harsh environment through cleverness. The same core pattern then appears on both sides of the North Pacific, in Chukotka–Kamchatka corpora and in Northwest Coast Raven cycles, with similarities often discussed as evidence of a long shared North Pacific story‑sphere plus later contact and divergence.

Those Raven attributes map cleanly onto Pyash. Pyash is a language about transformation and translation, turning sentence‑shaped intent into executable action, much as Raven turns darkness into light by strategy rather than force. Raven’s boundary‑crossing fits Pyash’s bridge between human meaning and machine procedure; Raven’s opportunistic creativity mirrors compositional reuse and tool‑calling; Raven’s mixed nature, benefactor plus troublemaker, matches a practical builder mindset where power is handled with care, because every clever shortcut carries consequences.

For the C IR/VLIW line, the mascot is the muskrat. A parallel deep‑time framing for the earth‑diver cycle is that it belongs to an even older circumpolar creation layer, shared across north Eurasia and North America: in the beginning there is only water, and a humble diver brings up the first bit of mud or sand so land can form. In Eurasian tellings the diver is often a loon or duck; in many North American “Turtle Island” tellings the diver is often muskrat (sometimes after larger divers fail), and the tiny clump of mud becomes the seed that expands into the world. The motif emphasizes endurance, humility, and the reality that a small being can establish the foundation that everything else depends on.

That maps cleanly onto a C IR / VLIW ISA / bytecode interpreter layer. The earth‑diver is the part of your stack that dives into the hard depths and returns with something minimal yet decisive: a small, correct substrate that can grow into a whole machine world. Muskrat fits as a symbol for this layer because it is a builder and shaper of wetlands, turning mud and plant fibre into stable structures. In the same way, an ISA or interpreter turns simple primitives into a reliable ground plane: deterministic execution, a clear memory model, small composable operations, and predictable control flow. Raven can bring the light at the language layer, while muskrat brings up the mud that makes land exist in the first place.

### Design goals

1. **Grammar-driven dispatch**

   * Verbs act as dispatchers over cases and noun classes.
   * Dispatch is **signature-based**, not verb-based: distinct case/type shapes are distinct implementations.
   * Cases encode roles like source, destination, instrument, condition, etc.
   * Noun classes represent semantic types like “model”, “file”, “dataset”, “pipeline node”, “hardware resource”.

2. **Linguistic universals as backbone**

   * Core structures follow cross-linguistic patterns: roles, valency, aspect, relations.
   * This makes Pyash easier to map into many human languages without loss of meaning.
   * The same structure can be lowered toward assembly-level abstractions while staying consistent.

3. **Interlanguage between humans and machines**

   * One Pyash sentence should be convertible into:

     * readable text for humans,
     * a JSON or graph workflow,
     * a Node.js call graph,
     * or a lower-level instruction sequence.
   * The core representation stays neutral and precise so backends can evolve underneath it.

4. **Turing-complete, general-purpose direction**

   * Pyash aims to support full computation: control flow, state, data structures and modules.
   * Instead of designing everything up front, capabilities are grown:

     * define clear tests and behaviours,
     * let LLMs propose or mutate implementations,
     * keep only what passes.
   * Over time this should yield a general-purpose ecosystem, not just a workflow DSL.

5. **LLM-friendly representation**

   * Syntax is compact and regular so models can read, generate and refactor it safely.
   * Key structure (cases, classes, verbs) is explicit, not hidden in prose.
   * Behaviour is encoded in small, focused tests that models can learn from and extend.

6. **Compositional workflows as a proving ground**

   * Early Pyash programs map directly to graphs that orchestrate tools, models and services.
   * Pipelines are inspectable and serializable, similar in spirit to ComfyUI graphs, but text based.
   * This domain gives rich, realistic tasks for evolving the language and runtime.

7. **Evolutionary ecosystem**

   * The quiz suite defines what each verb + case + noun-class pattern must do.
   * New implementations can be proposed by LLMs or mutation.
   * Only code that passes quizzes is kept, so behaviour is preserved while the internals evolve.

8. **Concrete, JS-first runtime (for now)**

   * Today, Pyash dispatch lands in plain Node.js ES modules.
* The runtime is meant to be simple to read and hack.
* There is a clear path from high-level sentences to low-level data structures that future backends, including assembly-like targets, can consume.

9. **Interpret/compile parity**

   * Any Pyash program should behave the same when interpreted or compiled.
   * Genitives, cases, signatures, and memory effects must be preserved across both paths.
   * Quizzes should cover both interpreter and compiler flows to guard against divergence.

10. **Deterministic JSON artefacts**

   * JSON output defaults to RFC 8785 official form via `to state json`.
   * Use `to state beautiful json` for human-readable pretty output.

---

### Pyash vocabulary in this repo

To keep code and commands closer to human speech, we use Pyash-flavoured names in the implementation:

- `program/understand/` — the parser; turns text into sentences.
- `program/bridge/` — the dispatcher; routes moods/verbs to handlers.
- `program/remember/` — memory; functions are `doRemember`, `remember`, `allRemember`, `forget`.
- `command/` — CLI helpers such as `run_pya_program.mjs`, `read_pya_trace.mjs`, `list_pyash_words.mjs`.
- `program/beautiful.mjs` — rendering sentences back to readable Pyash strings.
- `quiz/` — automated quizzes (tests) to pin behaviour.
- `program/configure/` — example configuration data (e.g., `workplace.json`).

The goal is to make the codebase read like controlled natural language, reducing translation overhead between human concepts (remember, understand, bridge) and their runtime responsibilities.

---

### Vocabulary helpers

Use the vocab helpers before introducing new verbs, files, directory names, or example words.

- `node command/vocab_suggest.mjs examples/pyash` scans `.pya` files for non-Pyash tokens and suggests replacements.
- `node command/vocab_suggest.mjs "new verb name"` checks a proposed token or phrase without touching files.
- `node command/vocab_check.mjs examples/pyash` enforces that every token is already in the dictionaries.

These helpers use the `caterer/pyac/lyac` dictionaries via `command/ryan.mjs`.

---

### Local configuration boundaries

To keep host and container runs stable, keep configuration scope strict:

- `configure/default.pya`: shared portable defaults.
- `configure/container.pya`: container-only network/routes (`host.docker.internal`, service aliases like `searxng` and `whisperx`).
- `configure/secret.pya`: secrets and local host settings only; do not store container service hostnames here.

Use `node command/check_local_config_safety.mjs` (or `npm run config:safety`) to catch container hostnames accidentally placed in `configure/secret.pya`.

---

### Declarations vs. assignments

Pyash keeps declarations explicit when compiling to code targets:

- Use `exists` on the first `ya` sentence for a name, e.g., `exists su name alpha ob num 1 be number ya`. This is treated as the declaration (`let/const` in JS, `double/const` in C).
- Later `ya` sentences on the same name omit `exists` and become plain assignments (`alpha = 2;`).
- The compiler will emit a Pyash error if a `ya` sentence assigns to a name that has not been declared with `exists`. This catches undeclared variables before the generated JS/C runs.
- The interpreter enforces the same rule for all runs, matching compiled behavior.

---

### What Codex should optimise for

When you, Codex, work on Pyash, optimise for:

* Preserving the **grammar-driven, linguistically grounded dispatch model**.
* Keeping verbs thin and focused, with clear mapping to underlying Node.js (and future) backends.
* Growing Pyash toward **full, Turing-complete, general-purpose capability** through quizzes plus evolutionary improvements.
* Strengthening and extending the **quiz suite** so new code can be proposed safely by models.
* Keeping representations **serializable, explicit and backend-agnostic**, so successors can target new languages and IRs.
* Preferring clarity over cleverness. Pyash is scaffolding for an ecosystem where humans and models co-create workflows, libraries and eventually full programs together.
