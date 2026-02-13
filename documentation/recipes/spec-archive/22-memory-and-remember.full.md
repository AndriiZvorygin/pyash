## Memory and Remember (MemCube-lite, file-only)

### 0. Purpose

Define a deterministic, file-only memory model for Pyash that is:

1. append-only,
2. auditable,
3. replayable,
4. compatible with agent loops and non-agent runtimes.

This spec defines memory lifecycle and retrieval behavior for `be memory` / `be remember`.

---

## 1. Terms

* **memcube**: one atomic memory record represented as one stored sentence.
* **memory store**: append-only `.pya` file containing memcubes.
* **version chain**: records sharing the same memory identity with increasing version.
* **retired**: a record marked as no longer eligible for default retrieval.
* **retrieval window**: filter constraints applied before ranking.

---

## 2. Canonical shape

Each memcube is represented as a stored sentence (`ya`) with these canonical roles:

* identity: `su name <id>`
* payload: `ob <type> <value>`
* scope/audience: `for name <scope-type> <scope-name>` (optional but recommended)
* creation time: `since date <ISO-8601>`
* retention: `during ...`
* provenance/evidential shell: discourse/evidential cases (for example `accordingto`, `fromtext`)

Example:

```text
su name mem 4f2c v 1
ob text "User prefers file-only memory"
for name project pyash
since date 2026-02-09
during wo always
accordingto text "direct"
be memory ya
```

Rules:

1. One stored sentence equals one memcube.
2. Memcubes are immutable after append.
3. A semantic update appends a new sentence with same identity and higher version marker.

---

## 3. Storage model

Default store is file-only and append-only, for example:

* `memory/store.pya` (runtime-defined path allowed)

Requirements:

1. No hidden database is required.
2. No per-memcube side files are required.
3. Writes are append-only for normal create/update operations.

---

## 4. Lifecycle

### 4.1 Create

`be memory ya` appends a new memcube sentence.

### 4.2 Update (supersede)

A superseding write:

1. keeps the same memory identity (`su` lineage),
2. increments version marker,
3. appends a new sentence instead of mutating prior bytes.

### 4.3 Retire

A runtime MAY support explicit retirement sentences.

If retirement is supported:

1. retired versions remain in the file,
2. default retrieval excludes retired versions,
3. replay mode MAY include retired versions for audit.

---

## 5. Temporal semantics (`during`)

Supported retention forms:

* `during date <YYYY-MM-DD>`: valid through end of that local date.
* `during date today`: valid through end of local day.
* `during date tomorrow`: valid through end of next local day.
* `during wo always`: no expiry.

Expiry behavior:

1. expired memcubes remain in store,
2. default retrieval skips expired memcubes,
3. audit/replay retrieval MAY include expired memcubes when requested.

---

## 6. Retrieval (`be remember do`)

`be remember do` is execution, not storage.

Minimal retrieval flow:

1. parse memcubes from configured store,
2. filter by scope (`for`), retention (`during`), retired/expired state,
3. rank deterministically,
4. return top-K results in deterministic order.

Deterministic ranking policy (default):

1. exact substring matches in payload (`ob`) first,
2. token overlap next,
3. recency tie-break (`since` newer first),
4. stable final tie-break by original append order.

Default `K` SHOULD remain small (for example 3-7) unless overridden.

`be remember do` MUST NOT mutate memory store as a side effect.

---

## 7. Provenance and evidentials

Memcubes SHOULD carry provenance fields for auditability.

Evidential category semantics MUST follow:

* `documentation/specifications/09-speech-and-hear.md` (evidential tagging section).

Policy:

1. primary/authoritative source -> direct evidential,
2. secondary reporting -> reported/news evidential,
3. multi-source corroboration -> optional factive promotion.

When promotion is used, source anchors SHOULD be recorded so promotion is auditable.

---

## 8. Replay determinism

A retrieval run is reproducible when the runtime records:

1. store file hash (or byte cutoff),
2. retrieval query sentence,
3. returned identity+version list in order.

Replay reuses the same cutoff/hash and query semantics.

---

## 9. Agent usage contract

Agent loops SHOULD call `be remember do` instead of scanning store files directly.

Runtime injection into prompts SHOULD include:

1. identity+version reference,
2. payload text,
3. provenance/evidential fields.

Agent-specific prompt assembly and session policies remain defined in:

* `documentation/specifications/18-pyash-agent.md`

---

## 10. Compliance checklist

A runtime is MemCube-lite compliant if it provides:

1. atomic sentence-level memory records,
2. append-only default storage,
3. versioned supersede behavior,
4. retention filtering by `during`,
5. provenance/evidential carriage,
6. deterministic retrieval order,
7. reproducible replay inputs.
