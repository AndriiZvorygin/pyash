# `19-repair.md`

Status: draft v0.1

Purpose: define a first-class patch application verb for deterministic file edits in Pyash.

---

## 1. Overview

`be repair` applies textual file edits from a patch payload.

Design goals:
- deterministic behavior
- workspace-safe path handling
- machine-readable results
- dry-run validation before writes

This chapter defines sentence forms, validation, apply semantics, and error contracts.

---

## 2. Core verb

### 2.1 Apply patch text

`be repair ob text "<patch>" do`

### 2.2 Dry-run validation

`be repair ob text "<patch>" as wo check do`

Dry-run MUST parse and validate exactly as apply mode, but MUST NOT write files.

### 2.3 Source from name

`be repair ob name text <patch-name> do`

`be repair ob name text <patch-name> as wo check do`

---

## 3. Patch format

Implementations MUST accept unified-diff style text.

Minimum required structures:
- file header (`---` / `+++`) or explicit add/delete headers
- one or more hunks with context and changed lines

Implementations MAY accept structured patch wrappers (for example, `*** Begin Patch`), but MUST normalize to a single internal patch representation before validation.

v0.1 implementation profile (current):
- strict unified-diff parsing
- escaped `\n` in single-line text payloads are normalized to real newlines before parse
- rename/move patch headers are rejected in v0.1 (`repair path defective`)

---

## 4. Safety constraints

### 4.1 Path scope

Patched file paths MUST resolve inside the active workspace root.

Operations MUST reject:
- path traversal (`..`)
- absolute paths outside workspace root
- symlink escapes that resolve outside workspace root

### 4.2 Text-only edits

Binary patch payloads are out of scope for v0.1 and MUST fail.

### 4.3 Atomicity

If any file patch fails validation in apply mode, no file writes MUST be committed.

Implementations MAY stage writes in memory/temp files, then commit atomically.

---

## 5. Apply semantics

For each file target:
- locate source text
- apply hunks in order
- preserve unchanged bytes exactly
- write final text with original newline style unless explicitly replaced by patch content

Hunk matching rules:
- exact context match by default
- if fuzzy matching exists, it MUST be deterministic and documented

v0.1 recommendation: strict matching only.
v0.1 implementation profile: strict matching only.

---

## 6. Result contract

Successful result MUST be a `ya` sentence with `be map`.

Example shape:
- metadata fields:
  - mode: `apply` or `check`
  - files_total
  - files_changed
  - lines_added
  - lines_deleted
- per-file records with:
  - path
  - status (`updated`, `added`, `deleted`, `unchanged`)
  - lines_added
  - lines_deleted

Implementations MAY store this map under `to name map <target>` if provided by signature expansion.

---

## 7. Error contract

Failures MUST surface `be error ya` with stable names.

Required error names:
- `repair defective` (invalid sentence, missing patch text, unsupported mode)
- `repair parse defective` (cannot parse patch payload)
- `repair path defective` (unsafe or out-of-root path)
- `repair hunk defective` (context mismatch or malformed hunk)
- `repair apply defective` (write/stage failure)

Error message text MUST include enough detail for deterministic retry (file path + hunk or reason).

---

## 8. Determinism requirements

Given identical:
- input patch text
- workspace file state
- mode (`apply` or `check`)

`be repair` MUST produce identical outcome and identical result map content.

---

## 9. Examples

### 9.1 Dry-run check

`be repair ob name text patch text as wo check do`

### 9.2 Apply

`be repair ob name text patch text do`

### 9.3 Tooling agent usage

1. generate patch text
2. run dry-run check
3. if clean, apply
4. read result map for changed files and line stats
