# `13-exchange-and-artifact.md` (draft v0.2)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define **exchange** (external byte movement) and **artifact** (durable external objects) for Pyash runs.

This spec exists to make runs:

- deterministic across interpreter / JS / C
- again-verifiable when again mode is enabled
- portable across machines and operating systems

This spec defines:

- artifact identity and sentence form
- locator (path/uri) normalization rules
- official hashing rules for artifact bytes
- exchange event sentence forms (read/write/fetch/push)
- how exchange and artifacts appear in the run newspaper (`11-run-newspaper.md`)

---

## 2. Terms

- **exchange** — reading or writing bytes outside the evaluator (filesystem, tool adapters, network adapters)
- **artifact** — a durable external object referenced by name in a run
- **locator** — a text string identifying where an artifact lives (path or uri)
- **artifact bytes** — the exact bytes of the artifact content
- **hash** — a deterministic digest of artifact bytes
- **run root** — the directory used to resolve relative path locators (runner policy; see §5.1)
- **again mode** — a runner policy that requires recording and verification sufficient for again (see §10)

---

## 3. Global invariants (normative)

1. **Deterministic locators**  
   For the same run inputs and runner policy, recorded locators MUST be identical across backends.

2. **Deterministic hashing**  
   For the same artifact bytes, the recorded hash MUST be identical across backends.

3. **Stable artifact names**  
   Artifact names (`su name <artifact>`) MUST be stable within a run.

4. **Newspaper is optional**  
   Run newspaper emission is opt-in by runner flag/policy and MUST NOT change evaluation semantics.

5. **Replayable mode is stricter**  
   Replayable mode MAY require newspaper emission and additional recording (hashes, exchange events). This MUST NOT change evaluation semantics, only observability and verification.

---

## 4. Artifact sentence (official)

An artifact is declared with a single sentence.

### 4.1 Minimum required fields

```
su name <artifact> ob text <locator> from name <producer> be artifact ya
```

- `<artifact>` is the artifact name for this run
- `<locator>` is a normalized path or uri (see §5)
- `<producer>` identifies who produced/declared it (examples: `exchange`, `runtime`, `tool:<name>`, `module:<name>`)

### 4.2 Optional fields

Hash (recommended; required in again mode for again-critical artifacts):

```
accordingto name sha256 fromtext text "<hex>"
```

Size (optional):

```
by num <bytecount>
```

Kind/classification (optional):

```
as name <kind>
```

Content-addressed locator (optional but recommended when artifact bytes are persisted):

```
to filename "<content-address-path>"
```

Example (fully specified):

```
su name artifact-0 ob filename "data/input.csv" to filename "artifacts/sha256/3a/0b/3a0b...ff.csv" as name file accordingto name sha256 fromtext text "3a0b...ff" by num 2190 from name exchange be artifact ya
```

### 4.3 Ordering

All fields (including optional fields) MUST follow official sentence ordering rules. This is governed by the case ordering and compositional case specifications.

---

## 5. Locator rules (normative)

A locator is recorded in `ob text <locator>`.

### 5.1 Run root policy

Run root is a runner policy value, selected by runner configuration (flags and/or runner defaults).
If the runner provides an explicit run root flag, that flag determines run root. Otherwise, run root defaults to the process working directory at runner start time.
When run newspaper emission is enabled, the runner SHOULD record the effective run root in the run start record so again can use the same resolution base.

Recommended run start addition:
```
ob filename "<run-root-path>" be run root ya
```
(Emitted using official ordering.)

### 5.2 Locator kinds

Locators are either:

- **path** locators (filesystem paths), or
- **uri** locators (for example `https://…`, `file://…`)

A runner MAY restrict which kinds are permitted.

### 5.3 Path normalization

When the locator is a filesystem path, it MUST be recorded in the following normalized form:

- relative to run root, unless runner policy explicitly permits absolute paths
- path separator MUST be `/` (forward slash)
- `.` segments MUST be removed
- `..` segments MUST be resolved
- `..` MUST NOT escape run root unless runner policy explicitly permits escaping
- no trailing `/` for file paths

Example:

- input path: `.\data\..\data\input.csv`
- recorded locator: `data/input.csv`

### 5.4 URI preservation

When the locator is a uri, it MUST be preserved byte-for-byte as provided by the exchange subsystem. No rewriting is permitted.

### 5.5 Artifacts directory contract (runner policy)

If the runner chooses to persist artifacts on disk, it SHOULD store bytes in a
stable content-addressed layout and MAY also provide a run-root alias.

Recommended content-addressed layout:

```
artifacts/sha256/<first2>/<next2>/<hex><ext>
```

Recommended run-root alias layout:

```
artifacts/<run-id>/<artifact-name>
```

Notes:

- `<run-id>` is the run identifier from the run start record.
- `<artifact-name>` is the `su name` value from the artifact sentence.
- The content-addressed path SHOULD be recorded in `to filename` of the artifact sentence.
- The run-root alias SHOULD be recorded in `ob filename` of the artifact sentence.
- A filesystem symlink/hardlink MAY be created, but again MUST rely on the recorded
  hash + content-addressed bytes.
- These layouts are runner policy; they MUST NOT change evaluation semantics.

---

## 6. Artifact bytes and hashing (normative)

### 6.1 Official hash algorithm

The official artifact hash algorithm is:

- sha256
- encoded as lowercase hex (no prefixes)

### 6.2 Hash input

The hash is computed over the exact artifact bytes.

- No newline rewriting is permitted during hashing.
- No text normalization is permitted during hashing.

### 6.3 Text artifact writing rule (determinism)

When Pyash writes a text artifact (any artifact whose bytes are produced from text), implementations MUST:

- encode text as UTF-8
- write newline as `\n` (LF)
- write no UTF-8 BOM

This rule exists to prevent OS-dependent bytes.

### 6.4 Hash consistency within a run

If the same normalized locator is recorded more than once in a run, the artifact hash MUST be identical across all recordings. A mismatch MUST surface `hash inconsistency`.

---

## 7. Artifact naming (normative)

### 7.1 Names are `su name`

Artifacts MUST be identified using `su name <artifact>`.

### 7.2 Default naming policy

If a verb/module/tool does not provide an explicit artifact name, the runtime MUST assign one deterministically:

- `artifact-0`, `artifact-1`, `artifact-2`, … in the order artifacts are first declared

The counter increments on first declaration only (not on every exchange event).

If a new exchange event targets the same normalized locator within the same run, the runtime MUST reuse the existing artifact name for that locator (and MUST NOT emit a second artifact declaration for the same locator).

---

## 8. Exchange event sentences (official)

Exchange events record how an artifact was used: read/write/fetch/push.

Exchange events are separate from artifact declarations.

### 8.1 Exchange event form (minimum)

```
su name <artifact> as name <op> from name <producer> be exchange ya
```

Where `<op>` is one of:

- `read`
- `write`
- `fetch`
- `push`

Examples:

```
su name artifact-0 as name read from name exchange be exchange ya
su name artifact-1 as name write from name module:csv be exchange ya
su name artifact-2 as name fetch from name tool:web.fetch be exchange ya
```

### 8.2 Locator placement rule

Locators belong to the artifact declaration sentence (`be artifact ya`).

- Exchange event sentences MUST NOT repeat locators.
- If an exchange operation needs a different locator, it MUST declare a different artifact name.

### 8.3 Linking exchange to a causing sentence (optional)

If the implementation records the causing sentence, it MUST use a subordinate clause:

```
ob la <embedded sentence> ko
```

Example:

```
su name artifact-0 as name read ob la su name artifact-0 vyah eval be load ko from name exchange be exchange ya
```

Embedded sentence behavior follows `10-subordinate-clauses.md`.

---

## 9. Relationship to the run newspaper

### 9.1 When newspaper is enabled

When newspaper emission is enabled:

- every artifact declaration sentence (`be artifact ya`) SHOULD be recorded in the newspaper
- every exchange event sentence (`be exchange ya`) SHOULD be recorded in the newspaper

### 9.2 When newspaper is disabled

When newspaper emission is disabled:

- evaluation semantics MUST be identical
- implementations MAY still perform exchange, but no newspaper record is required

---

## 10. Replayable mode (normative)

Again mode is a runner policy intended to make again verification possible.

### 10.1 Requirements

When again mode is enabled:

1. Newspaper emission MUST be enabled.
2. Artifact declarations and exchange events that affect results MUST be recorded in the newspaper.
3. Replay-critical artifacts MUST include a sha256 hash in their artifact declaration sentence.
4. Replay MUST verify recorded sha256 hashes and MUST fail on inconsistency.

### 10.2 Network exchange

For network-backed exchange (`fetch`/`push`):

- deterministic again MUST NOT depend on live network behavior
- fetched bytes SHOULD be persisted as an artifact with sha256 so again can re-use recorded bytes

If again mode is enabled and the implementation cannot persist and hash fetched bytes deterministically, it MUST surface an error.

---

## 11. Errors

Failures related to exchange and artifacts MUST follow `06-errors.md`:

- thrown as `be error do`
- surfaced as `be error ya` at observation boundaries

Recommended stable error names for this spec (add to `06-errors.md` if not already present):

- `exchange defective`
- `artifact defective`
- `hash inconsistency`

---

## 12. Conformance

An implementation conforms to this spec if it:

- emits artifact declarations with the official sentence form (§4)
- normalizes locators deterministically using a deterministic run root policy (§5)
- computes sha256 over exact bytes (§6)
- assigns default artifact names deterministically and increments on first declaration only (§7)
- emits exchange event sentences with the official form and does not repeat locators (§8)
- supports again verification requirements in again mode (§10)
- behaves identically whether or not newspaper emission is enabled (§3.4)

---
