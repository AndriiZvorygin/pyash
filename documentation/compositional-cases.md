### Compositional case system

Pyash treats cases as **compositional** rather than as one big flat list.

Every case is understood as:

> **axis × context**, realised by a single 16-bit case code.

* The **axis** tells you *what role* the marked phrase plays:

  * **SOURCE** → “from-like” (origins, sources)
  * **WAY** → “via / at / with-like” (paths, manners, modes)
  * **DESTINATION** → “to / into / for-like” (goals, targets, endpoints)

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

So for example (semantically):

* “from file” is **SOURCE + space**
* “to file” is **DESTINATION + space**
* “as C” is **WAY + state** (canonical keyword `via`)
* “into LLVM IR” is **DESTINATION + state** (canonical keyword `become`)

All of those are backed by specific case codes, but the system thinks of them as part of a regular grid.

---

### `library/pyashWords.json`

This file is the **raw dictionary of words** that Pyash knows, including all the human-style case names and context names.

Each entry looks like:

```json
{"en":"source_case_",       "hnuc":"0x313E", "pya":"so"}
{"en":"way_case_",          "hnuc":"0x265E", "pya":"ga"}
{"en":"destination_case_",  "hnuc":"0x243E", "pya":"ma"}

{"en":"space_context_",     "hnuc":"0x315E", "pya":"to"}
{"en":"time_context_",      "hnuc":"0x2D3E", "pya":"se"}
{"en":"state_context_",     "hnuc":"0x31DE", "pya":"ro"}
````

* `en`   → English-ish name of the word (used as a stable key).
* `hnuc` → 16-bit code in hex, the canonical symbol ID in the language.
* `pya`  → the Pyash phonological shape (syllable / cluster).

There are two versions of most cases:

* `nominative_case` / `nominative_case_`
* `genitive_case` / `genitive_case_`, etc.

The version with a trailing `_` is the **pure grammatical morpheme**. That is the one used in the compositional grid.

`pyashWords.json` itself does **not** know about SOURCE / WAY / DESTINATION or contexts.
It is just the base lexicon. The compositional meaning is layered on top.

---

### `library/compositionalCases.mjs`

This module explains *how the cases combine*.

It exports three main things:

1. `compositionalGrid`
2. `compositionalByHnuc`
3. `contextKeywords`

and the keyword grid for axis + context + object.

---

#### `compositionalGrid`

This is the **primary specification** of the compositional system.

It is a table:

* **rows** = contexts (`space`, `interior`, `surface`, `under`, `time`, `state`, `person`, `social`, `discourse`)
* **columns** = axes (`source`, `way`, `destination`)

Each cell chooses a canonical `*_case_` word from `pyashWords.json` and ties it to:

* its `hnuc` hex,
* its `pya` syllable,
* a single-token English-ish **keyword** used by the keyword layer (no spaces).

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
      keyword: "from",   // SOURCE + space
    },

    way: {
      axis: "way",
      case: "way_case_",
      hnuc: "0x265E",
      pya: "ga",
      keyword: "at",     // WAY + space
    },

    destination: {
      axis: "destination",
      case: "destination_case_",
      hnuc: "0x243E",
      pya: "ma",
      keyword: "to",     // DEST + space
    },
  },

  state: {
    context: { name: "state_context_", hnuc: "0x31DE", pya: "ro" },

    source: {
      axis: "source",
      case: "fromstate_case_",       // exessive family
      hnuc: "0x4757",
      pya: "txih",
      keyword: "fromstate",          // SOURCE + state
    },

    way: {
      axis: "way",
      case: "essive_case_",
      hnuc: "0x414F",
      pya: "swih",
      keyword: "via",                // WAY + state (semantically “as”)
    },

    destination: {
      axis: "destination",
      case: "to_case_",
      hnuc: "0x5F17",
      pya: "kxeh",
      keyword: "become",             // DEST + state (semantically “into (being)”)
    },
  },

  // other contexts...
};
```

This grid is **compositional first**:

* it treats “space vs time vs state vs discourse” as the main choice,
* then SOURCE / WAY / DESTINATION on top of that,
* and only then picks a specific hex case code.

The old human-style case names (elative, illative, essive, etc.) are used as building blocks *inside* this grid.

---

#### Axis + context + object keyword table

For the keyword layer and JSON encoding, we use a regular grid of **single-token keywords** per `(axis, context)` plus an **object slot** per context.

Columns:

* `source` keyword (SOURCE axis)
* `way` keyword (WAY axis)
* `destination` keyword (DESTINATION axis)
* `object` slot name (for `obj …` payloads)

Rows:

* contexts.

```text
| context     | source       | way          | destination | object   |
|------------|--------------|-------------|-------------|----------|
| space      | from         | at          | to          | obat     |
| interior   | outof        | inside      | into        | obin     |
| surface    | offof        | along       | onto        | obon     |
| under      | fromunder    | under       | beneath     | obun     |
| time       | since        | during      | until       | obti     |
| state      | fromstate    | as          | become      | obsta    |
| person     | fromperson   | with        | for         | obson    |
| social     | fromgroup    | among       | intogroup   | obgroup  |
| discourse  | fromtext     | accordingto | totext      | obtext   |
```

Usage patterns:

* axis keywords (for adverbials etc.):

  * `from space …`, `at space …`, `to space …`
  * `via state "qwen3:8b"`, `become state "llvm_ir"`

* object slots (JSON-side):

  * `obj discourse message.content` → `obtext: "<content>"`
  * `obj interior  message.thinking` → `obin: "<thinking>"`
  * `via time time` → commonly serialised as `obti: "<timestamp>"` or a separate `time` field.

Codex can round-trip like:

```js
export const axisContextToKeyword = {
  space:     { source: "from",      way: "at",          destination: "to",        object: "obat" },
  interior:  { source: "outof",     way: "inside",      destination: "into",      object: "obin" },
  surface:   { source: "offof",     way: "along",       destination: "onto",      object: "obon" },
  under:     { source: "fromunder", way: "under",       destination: "beneath",   object: "obun" },
  time:      { source: "since",     way: "during",      destination: "until",     object: "obti" },
  state:     { source: "fromstate", way: "via",         destination: "become",    object: "obsta" },
  person:    { source: "fromperson",way: "with",        destination: "for",       object: "obson" },
  social:    { source: "fromgroup", way: "among",       destination: "intogroup", object: "obgroup" },
  discourse: { source: "fromtext",  way: "accordingto", destination: "totext",    object: "obtext" },
};

export const keywordToAxisContext = {
  // source
  from:        { axis: "source", context: "space" },
  outof:       { axis: "source", context: "interior" },
  offof:       { axis: "source", context: "surface" },
  fromunder:   { axis: "source", context: "under" },
  since:       { axis: "source", context: "time" },
  fromstate:   { axis: "source", context: "state" },
  fromperson:  { axis: "source", context: "person" },
  fromgroup:   { axis: "source", context: "social" },
  fromtext:    { axis: "source", context: "discourse" },

  // way
  at:          { axis: "way",    context: "space" },
  inside:      { axis: "way",    context: "interior" },
  along:       { axis: "way",    context: "surface" },
  under:       { axis: "way",    context: "under" },
  during:      { axis: "way",    context: "time" },
  via:         { axis: "way",    context: "state" },
  with:        { axis: "way",    context: "person" },
  among:       { axis: "way",    context: "social" },
  accordingto: { axis: "way",    context: "discourse" },

  // destination
  to:          { axis: "destination", context: "space" },
  into:        { axis: "destination", context: "interior" },
  onto:        { axis: "destination", context: "surface" },
  beneath:     { axis: "destination", context: "under" },
  until:       { axis: "destination", context: "time" },
  become:      { axis: "destination", context: "state" },
  for:         { axis: "destination", context: "person" },
  intogroup:   { axis: "destination", context: "social" },
  totext:      { axis: "destination", context: "discourse" },
};

export const objectKeyToContext = {
  obat:    "space",
  obin:    "interior",
  obon:    "surface",
  obun:    "under",
  obti:    "time",
  obsta:   "state",
  obson:   "person",
  obgroup: "social",
  obtext:  "discourse",
};
```

---

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
    keyword: "from",
  },
  "0x5f17": {
    context: "state",
    axis: "destination",
    case: "to_case_",
    pya: "kxeh",
    keyword: "become",
  },
  // ...
};
```

This is what the Node code and Codex should use when they see a case hex coming out of a Pyash sentence:

1. Look up `hnuc` in `compositionalByHnuc`.
2. Recover:

   * which **context** it belongs to,
   * which **axis** it expresses,
   * and which canonical **keyword** it corresponds to.

---

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
  discourse: {
    key: "discourse",
    contextWord: "discourse_context_",
    hints: ["text", "prompt", "quote", "document", "corpus", "message"],
  },
  // others...
};
```

---

### How Codex should think about it

When generating or modifying Pyash-related code:

1. **Pick context + axis first.**
   Use `contextKeywords` + `axisContextToKeyword` to choose the right combination.

2. **Use `compositionalGrid` / `compositionalByHnuc` for case codes.**
   The hex `hnuc` is the canonical identity of a case.

3. **Use the object keywords for multi-object sentences.**
   Map:

   * `obj discourse X` → `obtext: X`
   * `obj interior Y` → `obin: Y`
   * etc.

4. **Treat `space` as the default context**
   when nothing else is specified.

```
