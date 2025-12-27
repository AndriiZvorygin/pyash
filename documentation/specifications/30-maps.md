# `30-maps.md`

**Status:** v0.2 (determinism locked)

## 1. Purpose

Define **map values** in Pyash.

Two forms are specified:

* **Pyash map**: a general container used by the runtime. Its exported form is the normal Pyash JSON AST produced by `understand`.
* **JSON map**: a constrained map form whose contents represent a **JSON value tree** and can be exported as **plain JSON**.

This specification defines syntax, semantics, access rules, enumeration, arrays, nesting, and JSON export behaviour.

---

## 2. Terms

* **map**: a container of entries indexed by switch.
* **pyash map**: declared with `be map def … prah`.
* **json map**: declared with `be json map def … prah`.
* **entry**: a `ya` sentence inside a map definition block.
* **switch**: the entry subject (`su name …`), used as a JSON object key.
* **contents**: the entry payload (`ob …`), used as the JSON value.
* **json value**: one of:

  * object
  * array
  * string
  * number
  * boolean
  * null
* **unspecified**: absence or missing result (runtime), outside the JSON value set.
* **hollow**: null (exports as JSON `null`).
* **vector**: Pyash vector value using `ve` (`ob ve … be vector`), used to represent JSON arrays.
* **referential**:

  * **map referential**: `ob name <json-map>` used for nesting objects
  * **vector referential**: `ob ve name <a> <b> …` used for arrays of objects

---

## 3. Syntax

Inline map literals are unsupported. `def … prah` is the canonical map form.

### 3.1 Pyash map definition

```
su name <M> be map def
  <entry>...
prah
```

### 3.2 JSON map definition

```
su name <M> be json map def
  <entry>...
prah
```

### 3.3 Entry form (shared)

An entry is a `ya` sentence inside the definition block:

```
su name <switch> ob <contents> ya
```

Notes:

* Entries inside `def` blocks write nowhere outside the block scope.
* Switches derive from `su`.
* Contents derive from `ob`.

---

## 4. Shared semantics (normative)

### 4.1 Map creation

* `be map def … prah` produces a **pyash map value** stored under `<M>`.
* `be json map def … prah` produces a **json map value** stored under `<M>`.

### 4.2 Entry aggregation

Inside a map definition block:

* Each entry contributes one association:

  * `switch = entry.su`
  * `contents = entry.ob`

### 4.3 Duplicate switches

If the same switch appears more than once:

* The later entry takes priority (last write wins).
* A warning may be emitted.

### 4.4 Access (genitives)

Map access uses standard genitive rules:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

The resolved result is the associated contents.

### 4.5 Missing switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

### 4.6 Enumeration (normative)

Enumeration is defined only for JSON maps.

The `all` switch yields vectors as follows:

* `all su of <map>`
  → vector of switches (keys)

* `all ob of <map>`
  → vector of contents (values), aligned with `all su`

* `all of <map>`
  → vector of entries, each entry a 2-item vector
  `[<switch>, <contents>]`

Surface form:

* `all su of <map>`, `all ob of <map>`, and `all of <map>` are the canonical forms.
* Implementations MAY also accept fully explicit equivalents using `su name all` / `ob name all` where grammar requires disambiguation.

Ordering:

* Enumeration order SHALL follow **canonical JSON key order** (RFC 8785).

Result types:

* `all su of <map>` returns `ve text`.
* `all ob of <map>` returns a vector whose elements are JSON values (heterogeneous).
* `all of <map>` returns a vector of 2-item vectors, where each inner vector is `[switch, contents]`.

`unspecified` omission:

* If an entry’s contents are `unspecified`, that entry is omitted from enumeration results (`all su`, `all ob`, and `all`).

Errors:

* Applying `all` (or `all su` / `all ob`) to a non-JSON map raises `json map enumeration defective` as an exception.


## 5. JSON map value model (normative)

A JSON map represents a JSON object stored under the map sentence’s `ob`.

Switches become JSON object keys. Contents become JSON values.

### 5.1 Switch constraints

* Switches originate from `su name <switch>`.
* Switches must be representable as JSON object keys.

### 5.2 Contents constraints

Allowed contents:

* string: `ob text "…"`
* number: `ob num …`
* boolean: `ob bool truth|lie`
* null: `ob hollow`
* object nesting: `ob name <json-map>`
* array: vector values (§5.3)

`unspecified` may appear during access or building, and exports via omission rules (§5.5).

### 5.3 Arrays via vectors (normative)

JSON arrays are represented using Pyash vectors (`ve`).

**A) Scalar arrays**

Vectors whose element type is JSON-scalar-like export as JSON arrays:

* `ve num …`
* `ve text …`
* `ve bool …`

**B) Arrays of objects (vector referential)**

```
ob ve name <a> <b> <c> be vector
```

Rules:

* Each name must resolve to a `be json map`.
* Each referenced map exports as a JSON object.
* Any non-map reference raises `json map referential defective`.

### 5.4 Nested objects (map referential)

```
su name <switch> ob name <json-map> ya
```

Rules:

* The referenced name must resolve to a previously-defined JSON map.
* During export, the referenced map expands inline.

### 5.5 `unspecified` and `hollow`

* `hollow` exports as JSON `null`.
* `ve hollow` exports as `[]`.
* `unspecified` indicates absence.

During JSON export:

* Entries whose contents are `unspecified` are omitted.

This preserves:

* `hollow` → present → `null`
* `unspecified` → absent → omitted

---

## 6. Loading JSON as JSON maps (normative)

When JSON is loaded into Pyash:

* JSON objects load as `be json map`.
* JSON arrays load as vectors (`ve`).

For arrays of objects:

* The loader MAY generate a vector referential by assigning generated names to each object.

Generated names must avoid collisions; numeric suffixes are appended if needed.

---

## 7. Exporting JSON (normative)

JSON export is canonical by default.

### 7.1 Canonical JSON (RFC 8785)

* to text:

  ```
  ob name <map> to state json to name <out> be write do
  ```
* to file:

  ```
  ob name <map> to state json to filename <path> be write do
  ```

Canonical JSON is byte-stable and suitable for hashing, signing, replay, and goldens.

### 7.2 Human-readable JSON

Human-readable output requires an explicit state:

* to text:

  ```
  ob name <map> to state beautiful json to name <out> be write do
  ```
* to file:

  ```
  ob name <map> to state beautiful json to filename <path> be write do
  ```

Pretty JSON has no byte-stability guarantee.

### 7.3 Default `write`

```
ob name <map> be write do
```

Prints the `be json map def … prah` chain, rather than JSON text.

---

## 8. Pyash map behaviour (normative)

* Pyash maps impose no JSON compatibility constraints.
* Enumeration order is unspecified.
* JSON export rules apply only to JSON maps.

---

## 9. Dynamic map updates (normative)

`be add` updates a map using the `su` value as the switch.

Example:

```
su text of ob of this ob num 1 to name wordmap be add do
```

Rules:

* `to name <map>` must resolve to a pyash map.
* Missing switches are treated as zero.
* Export uses the normal Pyash JSON AST produced by `understand`.

---

## 10. Errors (normative)

Errors are thrown as `be error do` sentences.

Stable error names:

* `json map contents defective`
* `json map referential defective`
* `json map export self referential`
* `json map enumeration defective`

Errors are raised only for structural violations.

---

## 11. Tests that define truth

* `quiz/json_map_export.test.mjs`
* `quiz/import_json_map.test.mjs`
* `quiz/compile_json_to_pyash.test.mjs`
* `quiz/json_map_enumeration.test.mjs`
