# `30-maps.md`

## 1. Purpose

Define **map values** in Pyash.

Two forms are specified:

* **Pyash map**: a general container used by the runtime. Its exported form is the normal Pyash JSON AST produced by `understand`.
* **JSON map**: a constrained map form whose contents represent a **JSON value tree** and can be exported as **plain JSON**.

This specification defines syntax, semantics, access rules, arrays, nesting, and JSON-export behaviour.

---

## 2. Terms

* **map**: a container of entries indexed by switch.
* **pyash map**: declared with `be map def … prah`.
* **json map**: declared with `be json map def … prah`.
* **entry**: a `ya` sentence inside a map definition block.
* **switch**: the entry subject (`subj name …`), used as a JSON object key.
* **contents**: the entry payload (`obj …`), used as the JSON value.
* **json value**: one of:

  * object
  * array
  * string
  * number
  * boolean
  * null
* **unspecified**: absence or missing result (runtime), not a JSON value.
* **hollow**: null (exports as JSON `null`).
* **vector**: Pyash vector value (`obj ve … be vector`), used to represent JSON arrays.
* **referential**:

  * **map referential**: `obj name <pre-existing-json-map>` inside a JSON map entry, used for nesting objects
  * **vector referential**: `obj ve name <a> <b> …` where each name resolves to a JSON map, used for arrays of objects

---

## 3. Syntax

### 3.1 Pyash map definition

```
subj name <M> be map def
  <entry>...
subj name <M> be map prah
```

### 3.2 JSON map definition

```
subj name <M> be json map def
  <entry>...
subj name <M> be json map prah
```

### 3.3 Entry form (shared)

An entry is a `ya` sentence inside the definition block:

```
subj name <switch> obj <contents> ya
```

Notes:

* Entries inside `def` blocks do **not** write to global memory.
* Switches are derived from `subj`.
* Contents are derived from `obj`.

---

## 4. Shared semantics (normative)

### 4.1 Map creation

* A `be map def … prah` block produces a **pyash map value** and stores it under `<M>`.
* A `be json map def … prah` block produces a **json map value** and stores it under `<M>`.

### 4.2 Entry aggregation

Inside a map definition block:

* Each entry contributes one switch → contents association:

  * `switch = entry.subj`
  * `contents = entry.obj`

### 4.3 Duplicate switches

If the same switch appears more than once in the same map definition:

* The later entry takes priority (last-write-wins within the block).
* A warning may be emitted.

### 4.4 Access (genitives)

Map access uses standard genitive rules and supports both forms:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

The resolved result is the associated contents.

### 4.5 Missing switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

---

## 5. JSON map value model (normative)

A JSON map represents a **JSON object** stored under the map sentence’s `obj`.

Switches become JSON keys; contents become JSON values.

### 5.1 Switch constraints

* Switches originate from `subj name <switch>`.
* Switches must be representable as JSON object keys.

### 5.2 Contents constraints

Allowed contents for JSON maps are JSON values, expressed in Pyash forms:

* **string**: `obj text "…"`
* **number**: `obj num …`
* **boolean**: `obj bool …` (requires bool as a type token)
* **null**: `obj hollow` (requires `hollow` literal support)
* **object nesting (map referential)**: `obj name <pre-existing-json-map>`
* **array**: a vector value used as a JSON array (see §5.3)

`unspecified` is not a JSON value. It may appear during access (missing switch) and may appear in builders, but it does not export as a JSON value.

### 5.3 Arrays via vectors (normative)

JSON arrays are represented using Pyash vectors.

Two array forms are defined:

**A) Scalar arrays**
A vector whose element type is JSON-scalar-like exports as a JSON array of scalars:

* `vec num …` → JSON array of numbers
* `vec text …` → JSON array of strings
* `vec bool …` → JSON array of booleans

**B) Arrays of objects (vector referential)**
A vector of names exports as a JSON array of objects by resolving each name to a JSON map:

```
obj ve name <a> <b> <c> be vector
```

Export semantics:

* each element name must resolve to a `be json map` sentence
* each element exports as that map’s `obj` object

If any element name does not resolve to a JSON map, it is an error (`json map referential defective`).

### 5.4 Nested objects (map referential)

An entry of the form:

```
subj name <switch> obj name <pre-existing-json-map> ya
```

is a **map referential**.

Semantics:

* `<pre-existing-json-map>` must resolve to a previously-defined JSON map.
* During JSON export, the referenced map is expanded inline as a nested JSON object.

### 5.5 `unspecified` and `hollow`

* `hollow` exports as JSON `null`.
* `ve hollow` is the empty array literal (`[]`).
* `unspecified` indicates absence or missing lookup.
* During JSON export of a JSON map:

  * entries whose contents are `unspecified` are omitted from the resulting JSON object.

This preserves the distinction:

* `hollow` → present, empty → JSON `null`
* `unspecified` → not present → omitted

---

## 6. Loading JSON as JSON maps (normative)

When JSON is loaded into Pyash (typically via `be import` or `be compile ... fromstate json tostate pyash`):

* JSON objects load as `be json map` values (with their object stored in `obj`).
* JSON arrays load as vectors.

  * For arrays of JSON objects, the loader may produce a **vector referential** (`vec name …`) by assigning each object element a generated name and storing each object element as its own `be json map`.

Generated names must avoid collisions with existing memory; if a generated name conflicts, a suffix number is appended (example: `a1`, `a2`, `a3`).

### 6.1 `import` verb

`be import` loads JSON text or a JSON file into memory:

* `obj text "<json>" to name <map> be import do`
* `from filename <file.json> to name <map> be import do`

Rules:

* The root JSON object becomes a `be json map` sentence named `<map>`.
* Arrays at the root become vectors named `<map>`.
* Generated object names for array elements follow the pattern `<map> <switch> <number>`.

### 6.2 `compile` JSON to Pyash

`be compile` supports JSON → Pyash map definitions:

* `subj name <map> obj text "<json>" from state json to state pyash to name <out> be compile do`

The compiled output is a `.pya`-compatible chain of `be json map def` / `prah` blocks.

---

## 7. Pyash map behaviour (normative)

* Pyash maps impose **no JSON-compatibility constraints**.
* Their exported form is the normal Pyash JSON AST produced by `understand`.
* No automatic transformation to data-JSON is implied.

---

## 8. Errors (normative)

Errors are thrown as exceptions whose `err.sentence` is a `be error do` sentence.

Stable error names for this specification:

* `json map contents defective`
* `json map referential defective`
* `json map export self referential`

Errors are raised only for structural violations, never for absent switches.

---

## 9. Examples (existing files only)

(Links added when map examples are introduced.)

---

## 10. Tests that define truth

* `quiz/json_map_export.test.mjs`
* `quiz/import_json_map.test.mjs`
* `quiz/compile_json_to_pyash.test.mjs`

---

### Status

This specification defines **maps v0.1**.

* JSON maps represent real JSON objects under `obj`.
* Arrays are represented via vectors.
* Arrays of objects are representable via `vec name` referentials.
* Missing switches resolve to `unspecified`.
* Export semantics align with real-world JSON construction and keep `unspecified` distinct from `hollow`.
