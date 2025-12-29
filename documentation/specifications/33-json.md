# `33-json.md`

**Status:** v0.2 (determinism locked)

## 1. Purpose

Define **JSON map values** in Pyash.

A **JSON map** is a constrained map form whose contents represent a **JSON value tree** and can be exported as **official JSON**.

This specification defines JSON map syntax, semantics, access rules, enumeration, arrays, nesting, JSON loading, and JSON export behaviour.

Pyash maps (`be map def`) are specified in `30-maps.md`.

---

## 2. Terms

* **json map**: declared with `be json map def … prah`.
* **entry**: a `ya` sentence inside a JSON map definition block.
* **switch**: the entry subject (`su name …`), used as a JSON object key.
* **contents**: the entry payload (`ob …`), used as the JSON value.
* **json value**: one of string, number, boolean, null, object, array.
* **vector**: a sequence container created with `ve` (`ob ve … be vector`), used to represent JSON array values.
* **official JSON**: JSON text output following RFC 8785 key ordering rules.

---

## 3. Syntax (normative)

Inline map literals are unsupported. `def … prah` is the official JSON map form.

### 3.1 JSON map definition

```
su name <M> be json map def
  <entry>...
prah
```

### 3.2 Entry form (json map)

A JSON map entry is a `ya` sentence inside the definition block with both `su` and `ob`:

```
su name <switch> ob <contents> ya
```

Rules:

* Each entry MUST contain `su name <switch>`.
* Each entry MUST contain `ob <contents>`.
* If a sentence lacks `su`, raise `json map sentence lost su`.
* If a sentence lacks `ob`, raise `json map sentence lost ob`.

Notes:

* Switches derive from `su`.
* Contents derive from `ob`.

---

## 4. JSON map meaning (normative)

### 4.1 Map creation

`be json map def … prah` produces a **json map value** stored under `<M>`.

### 4.2 Entry aggregation

Inside a JSON map definition block, each entry contributes one association:

* `switch = entry.su`
* `contents = entry.ob`

### 4.3 Excess switches

If the same switch appears more than once:

* The later entry takes priority (last write wins).
* A warning may be emitted.

This situation is permitted and does not raise an error.

### 4.4 Access (genitives)

JSON map access uses standard genitive rules:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

Access resolves to the associated **contents**.

### 4.5 Lost switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

---

## 5. Enumeration (normative)

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

* `all su of <map>`, `all ob of <map>`, and `all of <map>` are the official forms.
* Implementations MAY also accept fully explicit equivalents using `su name all` / `ob name all` where grammar requires disambiguation.

Ordering:

* Enumeration order SHALL follow **official JSON key order** (RFC 8785).

Result types:

* `all su of <map>` returns `ve text`.
* `all ob of <map>` returns a vector whose elements are JSON values (heterogeneous).
* `all of <map>` returns a vector of 2-item vectors, where each inner vector is `[switch, contents]`.

`unspecified` omission:

* If an entry’s contents are `unspecified`, that entry is omitted from enumeration results (`all su`, `all ob`, and `all`).

Errors:

* Applying `all` (or `all su` / `all ob`) to a non-JSON map raises `json map enumeration defective` as an exception.

---

## 6. JSON value model (normative)

A JSON map represents a JSON object stored under the map sentence’s `ob`.

Switches become JSON object keys. Contents become JSON values.

### 6.1 Switch constraints

* Switches originate from `su name <switch>`.
* Switches must be representable as JSON object keys.

### 6.2 Contents constraints

Allowed contents:

* string: `ob text "…"`
* number: `ob num …`
* boolean: `ob bool truth|lie`
* null: `ob hollow`
* object nesting: `ob name <json-map>`
* array: vector values (§6.3)

`unspecified` may appear during access or building, and exports via omission rules (§6.5).

If contents fall outside allowed contents, raise `json map contents defective`.

### 6.3 Arrays via vectors (normative)

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

### 6.4 Nested objects (map referential)

```
su name <switch> ob name <json-map> ya
```

Rules:

* The referenced name must resolve to a previously-defined JSON map.
* During export, the referenced map expands inline.

### 6.5 `unspecified` and `hollow`

* `hollow` exports as JSON `null`.
* `ve hollow` exports as `[]`.
* `unspecified` indicates absence.

During JSON export:

* Entries whose contents are `unspecified` are omitted.

This preserves:

* `hollow` → present → `null`
* `unspecified` → absent → omitted

---

## 7. Loading JSON as JSON maps (normative)

When JSON is loaded into Pyash:

* JSON objects load as `be json map`.
* JSON arrays load as vectors (`ve`).

For arrays of objects:

* The loader MAY generate a vector referential by assigning generated names to each object.

Generated names must avoid collisions; numeric suffixes are appended if needed.

---

## 8. Exporting JSON (normative)

JSON export is official by default.

### 8.1 Official JSON (RFC 8785)

* to text:

  ```
  ob name <map> to state json to name <out> be write do
  ```
* to file:

  ```
  ob name <map> to state json to filename <path> be write do
  ```

Official JSON is byte-stable and suitable for hashing, signing, replay, and goldens.

### 8.2 Human-readable JSON

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

### 8.3 Default `write`

```
ob name <map> be write do
```

Prints the `be json map def … prah` chain, rather than JSON text.

---

## 9. Errors (normative)

Errors are thrown as `be error do` sentences.

Stable error names:

* `json map sentence lost su`
* `json map sentence lost ob`
* `json map contents defective`
* `json map referential defective`
* `json map export self referential`
* `json map enumeration defective`

Errors are raised only for structural violations.

---

## 10. Tests that define truth

* `quiz/json_map_export.test.mjs`
* `quiz/import_json_map.test.mjs`
* `quiz/compile_json_to_pyash.test.mjs`
* `quiz/json_map_enumeration.test.mjs`
