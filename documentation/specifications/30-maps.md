# `30-maps.md`

**Status:** v0.2 (determinism locked)

## 1. Purpose

Define **pyash map values** in Pyash.

A **pyash map** is a general container used by the runtime. Entries are **full Pyash sentences** keyed by their `su` switch.

This specification defines syntax, semantics, access rules, official write ordering, dynamic updates, and error behaviour for pyash maps.

JSON maps (`be json map def`) are specified in `33-json.md`.

---

## 2. Terms

* **map**: a container of entries indexed by switch.
* **pyash map**: declared with `be map def … prah`.
* **entry**: a `ya` sentence inside a map definition block.
* **switch**: the entry subject (`su name …`), used as a map key.
* **entry sentence**: the full `ya` sentence stored as the value for a switch.

---

## 3. Syntax

Inline map literals are unsupported. `def … prah` is the official map form.

### 3.1 Pyash map definition

```
su name <M> be map def
  <entry>...
prah
```

### 3.2 Entry form (pyash map)

A pyash map entry is any `ya` sentence inside the definition block that contains a subject:

```
su name <switch> … ya
```

Rules:

* Each entry MUST contain `su name <switch>`.
* If a sentence lacks `su`, raise `pyash map sentence lost su`.
* The `<switch>` values MUST be unique within the block.
* Entries MAY contain any other roles (including `ob`, or no `ob`).

---

## 4. Semantics (normative)

### 4.1 Map creation

`be map def … prah` produces a **pyash map value** stored under `<M>`.

### 4.2 Entry aggregation

Inside a map definition block, each entry contributes one association:

* `switch = entry.su`
* `value = entry` (the full entry sentence object)

### 4.3 Excess switches

If a switch appears more than once, this is an error.

Stable error name: `pyash map switch excess`.

### 4.4 Access (genitives)

Map access uses standard genitive rules:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

Access resolves to the stored **entry sentence object**.

To obtain a payload from that entry sentence, use standard role access, for example:

* `ob of <entry>`

### 4.5 Lost switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

---

## 5. Official `write` ordering (normative)

Pyash maps have no required enumeration order at runtime.

When writing a pyash map in `def … prah` form, implementations SHALL emit entries in **official JSON key order** (RFC 8785) using the switch text as the sort key.

This rule exists to keep config files and other pyash maps diff-friendly, even though runtime enumeration order remains unspecified.

---

## 6. Dynamic map updates (normative)

`be add` updates a **pyash map** entry whose key is the update sentence’s `su` value.

Example:

```
su text of ob of this ob num 1 to name wordmap be add do
```

Rules:

* `to name <map>` must resolve to a pyash map.
* `switch` is the value of the update sentence’s `su`.
* The target entry sentence’s numeric counter is stored in `ob num …`.

Update behaviour:

* If no entry exists for `switch`, treat the current value as `0`.
* If an entry exists and its `ob` is `num <old>`, the new value is `<old> + <delta>`.
* After update, the entry sentence stored for `switch` SHALL have `ob num <new>` (other roles MAY be preserved).

Errors:

* If an existing entry sentence for `switch` lacks `ob num …`, raise `pyash map add defective`.

---

## 7. Errors (normative)

Errors are thrown as `be error do` sentences.

Stable error names:

* `pyash map sentence lost su`
* `pyash map switch excess`
* `pyash map add defective`

Errors are raised only for structural violations.

---

## 8. Tests that define truth

* `quiz/pyash_map_core.test.mjs` (if present or to be added)
* `quiz/pyash_map_write_order.test.mjs` (if present or to be added)
* `quiz/pyash_map_add.test.mjs` (if present or to be added)

Notes:

* JSON map tests live under `33-json.md` and remain unchanged:

  * `quiz/json_map_export.test.mjs`
  * `quiz/import_json_map.test.mjs`
  * `quiz/compile_json_to_pyash.test.mjs`
  * `quiz/json_map_enumeration.test.mjs`
