### Compositional case system

Pyash treats cases as **compositional** rather than as one big flat list.

Every case is understood as:

> **axis × context**, realised by a single 16-bit case code.

* The **axis** tells you *what role* the marked phrase plays:

  * **SOURCE** → “from”
  * **WAY** → “via / along / as”
  * **DESTINATION** → “to / into / until”

* The **context** tells you *in what domain* that relation lives:

  * **space** – default physical / path domain
  * **interior** – inside / in–out of something
  * **surface** – on / off / along a surface
  * **under** – underneath or below
  * **time** – before / during / until
  * **state** – type, representation, condition
  * **person** – individual people
  * **social** – groups, communities
  * **discourse** – text, speech, documents

The **hex value** of the case (the `hnuc` field) is the canonical ID.
The `(axis, context)` reading is provided by lookup tables.

So for example:

* “from file” is **SOURCE + space**
* “to file” is **DESTINATION + space**
* “as C” is **WAY + state**
* “into LLVM IR” is **DESTINATION + state**

All of those are backed by specific case codes, but the system thinks of them as part of a regular grid.

---

### `library/pyashWords.json`

This file is the **raw dictionary of words** that Pyash knows, including all the human-style case names and context names.

Each entry looks like:

```json
{"en":"source_case_", "hnuc":"0x313E", "pya":"so"}
{"en":"way_case_", "hnuc":"0x265E", "pya":"ga"}
{"en":"destination_case_", "hnuc":"0x243E", "pya":"ma"}

{"en":"space_context_", "hnuc":"0x315E", "pya":"to"}
{"en":"time_context_",  "hnuc":"0x2D3E", "pya":"se"}
{"en":"state_context_", "hnuc":"0x31DE", "pya":"ro"}
```

* `en`  → English-ish name of the word (used as the stable key).
* `hnuc` → 16-bit code in hex, the canonical symbol ID in the language.
* `pya` → the Pyash phonological shape (your syllable / cluster).

There are two versions of most cases:

* `nominative_case` / `nominative_case_`
* `genitive_case` / `genitive_case_`, etc.

The version with a trailing `_` is the **pure grammatical morpheme**. That is the one used in the compositional grid.

`pyashWords.json` itself does **not** know about SOURCE / WAY / DESTINATION or contexts. It is just the base lexicon. The compositional meaning is layered on top.

---

### `library/compositionalCases.mjs`

This module explains *how the cases combine*.

It exports three main things:

1. `compositionalGrid`
2. `compositionalByHnuc`
3. `contextKeywords`

#### `compositionalGrid`

This is the **primary specification** of the compositional system.

It is a table:

* **rows** = contexts (`space`, `interior`, `surface`, `under`, `time`, `state`, `person`, `social`, `discourse`)
* **columns** = axes (`source`, `way`, `destination`)

Each cell chooses a canonical `*_case_` word from `pyashWords.json` and ties it to:

* its `hnuc` hex,
* its `pya` syllable,
* a simple English preposition to gloss it.

Example (space and state rows, shortened):

```js
export const compositionalGrid = {
  space: {
    context: { name: "space_context_", hnuc: "0x315E", pya: "to" },

    source: {
      axis: "source",
      case: "source_case_",
      hnuc: "0x313E",
      pya: "so",
      prep: "from",
    },

    way: {
      axis: "way",
      case: "way_case_",
      hnuc: "0x265E",
      pya: "ga",
      prep: "via",
    },

    destination: {
      axis: "destination",
      case: "destination_case_",
      hnuc: "0x243E",
      pya: "ma",
      prep: "to",
    },
  },

  state: {
    context: { name: "state_context_", hnuc: "0x31DE", pya: "ro" },

    source: {
      axis: "source",
      case: "exessive_case_",
      hnuc: "0x4757",
      pya: "txih",
      prep: "out of (being)",
    },

    way: {
      axis: "way",
      case: "essive_case_",
      hnuc: "0x414F",
      pya: "swih",
      prep: "as",
    },

    destination: {
      axis: "destination",
      case: "to_case_",
      hnuc: "0x5F17",
      pya: "kxeh",
      prep: "into (being)",
    },
  },

  // other contexts...
};
```

This grid is **compositional first**:

* it treats “space vs time vs state vs discourse” as the main choice,
* then SOURCE / WAY / DESTINATION on top of that,
* and only then picks a specific hex case code.

The old human-style case names (elative, illative, essive, etc.) are used as building blocks inside this grid.

#### `compositionalByHnuc`

This is the **reverse lookup** built from the grid.

It maps directly from the hex string to compositional meaning:

```js
export const compositionalByHnuc = {
  "0x313e": {
    context: "space",
    axis: "source",
    case: "source_case_",
    pya: "so",
    prep: "from",
  },
  "0x5f17": {
    context: "state",
    axis: "destination",
    case: "to_case_",
    pya: "kxeh",
    prep: "into (being)",
  },
  // ...
};
```

This is what the Node code and Codex should use when they see a case hex coming out of a Pyash sentence:

1. Look up `hnuc` in `compositionalByHnuc`.
2. Recover:

   * which **context** it belongs to,
   * which **axis** it expresses,
   * and how to gloss it (`prep`).

#### `contextKeywords`

This is a small helper map that ties together:

* the internal context key (`"space"`, `"time"`, `"state"`, etc.),
* the corresponding `*_context_` word in `pyashWords.json`,
* and a few keyword hints that Codex can use when deciding which context to choose.

Example:

```js
export const contextKeywords = {
  space: {
    key: "space",
    contextWord: "space_context_",
    hints: ["space", "spatial", "path", "location", "place", "motion"],
    default: true,
  },
  time: {
    key: "time",
    contextWord: "time_context_",
    hints: ["time", "before", "during", "after", "until", "when"],
  },
  state: {
    key: "state",
    contextWord: "state_context_",
    hints: ["state", "condition", "mode", "type", "representation"],
  },
  // others...
};
```

This keeps the compositional layer **discoverable** for the LLM and for any meta-tools you build later.

---

### How Codex should think about it

When generating or modifying Pyash-related code:

1. **Prefer the compositional view.**
   Choose **context** and **axis** first, then look up the case hex using `compositionalGrid`.

2. **Use hex as the unifier.**
   When you see a case coming out of parsing or JSON, treat `hnuc` as the truth and recover `(context, axis)` using `compositionalByHnuc`.

3. **Use `space` as the default context.**
   If nothing is said about context, treat cases as “from / via / to” in space.

4. **Use `state` context for types / representations.**
   For things like `compile`, casting, or format conversions, use:

   * `state + way`  → “as TYPE” (source type)
   * `state + destination` → “into TYPE” (target type)

That is enough for Codex to follow the system without needing to know anything about ASTs or internals, while still keeping everything grounded in the hex codes and `pyashWords.json`.
