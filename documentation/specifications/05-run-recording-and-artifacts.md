# `05-run-recording-and-artifacts.md` (merged)

Merged specification file. Original sources:
- `11-run-newspaper.md`
- `12-source-maps.md`
- `13-exchange-and-artifact.md`

---

## `11-run-newspaper.md` (draft v0.2)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define the **run newspaper**: the official, append-only record of one Pyash run.

The run newspaper exists to:

- make runs **againable**
- make runs **diffable**
- provide an official record for pipelines, tools, and auditing

The newspaper records **events as sentences**, including embedded sentence forms using subordinate clauses (`01-sentence-and-grammar.md`).

Thrown errors (`be error do`) NEVER appear in the newspaper. Only surfaced errors (`be error ya`) do.

The newspaper is an **official `.pya` artifact**. Other formats are optional exports and are not normative.

Tooling MAY choose to emit the newspaper only when explicitly requested (for example via a CLI flag). Runners MAY also auto-enable newspaper emission when a run includes mind/tool calls, if configured. When emission is enabled, all rules in this spec apply.

Canonical examples live in `documentation/examples/examples-list.md` (see `examples/pyash/again-newspaper.pya` and `examples/pyash/refinery-mind-say-hear.pya`).

---

## 2. Terms

- **run** — one execution of a Pyash program
- **run id** — the identifier of a run, expressed as `su name <run>`
- **newspaper** — the ordered sequence of newspaper records for a run
- **event** — one newspaper record (a sentence)
- **evoke** — requesting execution of a verb
- **surface** — converting a thrown error (`be error do`) into an observable error result (`be error ya`)
- **subordinate clause** — `la … ko` sentence embedding (see `01-sentence-and-grammar.md`)
- **embedded sentence** — the sentence structure inside `la … ko`

---

## 3. Global invariants (normative)

1. **Append-only**  
   Newspaper records MUST be written in order and MUST NOT be mutated or reordered.

2. **Deterministic emission**  
   For the same program, inputs, configuration, and seed (when applicable), the emitted newspaper MUST be byte-identical.

3. **Official ordering on write**  
   Every sentence written into the newspaper MUST be emitted using official ordering rules, including official `vyah` ordering. Vectors and maps follow their own official ordering specifications.

4. **Verbatim preservation after write**  
   After a record is emitted, it MUST be preserved verbatim (byte-for-byte) in storage and transmission. No rewriting, normalization, or re-ordering is permitted after emission.

5. **No thrown errors**  
   `be error do` sentences MUST NOT appear in the newspaper. Only surfaced `be error ya` sentences may be recorded.

6. **Multiline sentence blocks**  
   Some emitters (compiled JS/C via `run_with_newspaper`) may stream multi-line sentences using a block marker:

   ```
   PYA_NEWSPAPER:BEGIN
   <sentence bytes>
   PYA_NEWSPAPER:END
   ```

   The block contents MUST be treated as a single newspaper record, and MUST be written verbatim to storage.

---

## 4. Run start record

Each newspaper MUST begin with exactly one **run start** record.

### 4.1 Required fields (normative)

- `su name <run>` — run identifier (MUST be a name literal, not text)
- `be run ya` — declares the run start

### 4.2 Time reference (one required)

Exactly one of the following MUST be present:

- `from time <timestamp>`
- `since time <timestamp>`

These are equivalent in meaning. The choice of `from` vs `since` MUST be fixed by implementation/config policy and MUST NOT vary between runs.

### 4.3 Optional fields

- `outof name <seed>` — execution seed, if used
- additional run metadata may be added by later specifications

When again mode is enabled, the runner SHOULD emit a marker sentence:

```
su name <run> as name again be run ya
```

### 4.4 Example

su name run-42 from time 2025-01-12T10:00:00Z outof name seed-7 be run ya

---

## 4.5 Default storage path (normative)

When stored on disk, the default path for the run newspaper is:

newspaper/<run-id>.pya

This path is relative to the process working directory unless an explicit override is supplied by tooling.

## 5. Event kinds (minimum set)

The newspaper MUST support the following event kinds:

- `run` (start and end)
- `evoke`
- `result`
- `state`
- `tool`
- `artifact`

The `tool` event schema is defined in `08-tools-and-mcp.md`.

Later specifications may plus additional event kinds, but these MUST exist.

---

## 6. Event: evoke

Records the request to execute a verb.

### 6.1 Meaning

An **evoke** event records that execution was requested. It does not imply success or failure.

### 6.2 Sentence form (official)

The evoked sentence is recorded as an embedded sentence using a subordinate clause:

ob la <embedded sentence> ko be evoke ya

Rules:

- The embedded sentence MUST be emitted using official ordering rules.
- The embedded sentence MAY include a mood token. If present, it is part of the embedded sentence structure.
- Whether the embedded sentence includes a mood token (and which mood is used, if any) MUST be fixed by implementation/config policy and MUST NOT vary between runs.

### 6.3 Examples

Without explicit mood inside the clause:

ob la su name S3 vyah eval be chip ko be evoke ya

With an explicit mood inside the clause (allowed by policy):

ob la su name S3 vyah eval be chip ya ko be evoke ya

(Host sentence mood remains `ya` regardless; the clause contains embedded structure only.)

---

## 7. Event: result

Records the observable outcome of an evoke.

### 7.1 Meaning

A **result** event records exactly one surfaced outcome sentence.

### 7.2 Sentence form (official)

A result event records exactly one sentence:

- on success: the normal result sentence
- on failure: a surfaced error sentence (`be error ya`)

No additional envelope (such as `be result ya`) is used.

### 7.3 Examples

Success:

ob text "ok" vyah eval sloh be text ya

Failure (surfaced error):

su name stream exhausted ob text "no more chips" from name runtime be error ya

---

## 8. Event: state

Records the creation or update of a runtime primitive.

### 8.1 Meaning

A **state** event records an observable runtime primitive sentence becoming true as a fact for this run.

---

### 8.2 Sentence form (official)

State is recorded as the primitive sentence itself, for example:

Duty:

su name L7 as name running be duty ya

Stream:

su name S3 as name open be stream ya

Chip:

su name S3 atindex num 0 ob text "he" as name notfinal be chip ya

Rules:

- State sentences MUST be emitted using official ordering rules.
- State sentences MUST include all required fields for that primitive as defined in `04-runtime-primitives.md`.

---

## 9. Event: tool

Records a tool call and its result as an event in the newspaper.

### 9.1 Meaning

A **tool** event captures the evoked sentence and the surfaced result sentence for
one tool call.

### 9.2 Sentence form (official)

su name tool event <counter>
ob la <evoked sentence> ko
to la <result sentence> ko
be tool ya

Rules:

- Both embedded sentences MUST be emitted using official ordering rules.
- The result sentence MUST be a surfaced sentence (`ya`), including `be error ya`
  for failures.
- The counter MUST be stable and increment per tool event in a run.

---

## 10. Event: artifact

Records creation or reference of a persisted external object.

### 10.1 Meaning

An **artifact** event declares a durable external object used or produced by the run.

### 10.2 Sentence form (minimum)

Minimum required fields:

su name <artifact> to filename <path-or-uri> from name <producer> be artifact ya

Additional artifact fields (hash, size, mime, etc.) are defined in `05-run-recording-and-artifacts.md`.

---

## 11. Run end record

Each newspaper MUST end with exactly one **run end** record.

### 11.1 Sentence form (official)

su name <run> be end ya

`<run>` MUST be the same run id recorded in the run start record.

---

## 12. Ordering rules (official)

1. **Journal ordering**  
   Records are ordered by emission order.

2. **Sentence ordering on write**  
   Every sentence written in the newspaper MUST be emitted using official ordering rules:
   - official case ordering
   - official `vyah` ordering
   - vectors and maps follow their own official ordering specifications

3. **Embedded sentence ordering**  
   Embedded sentences inside `la … ko` MUST be emitted using official ordering rules.

4. **Verbatim preservation after write**  
   After emission, records MUST be preserved verbatim byte-for-byte. This rule applies to the entire record, including embedded sentences.

---

## 13. Again requirements

An implementation MUST be able to:

- run again using only the newspaper and referenced artifacts
- reproduce the same sequence of result sentences
- verify artifact hashes during again (hash rules defined in `05-run-recording-and-artifacts.md`)

Again MUST fail if:

- an artifact hash does not match
- an again result sentence differs byte-for-byte from the newspaper’s recorded result sentences

---

## 13.1 Again strict subset (normative)

When `--again` is enabled, the newspaper MUST include the following required records:

- run start (`su name <run> ... be run ya`)
- run root (`ob filename "<run-root>" be run root ya`)
- again marker (`su name <run> as name again be run ya`)
- evoke + result for each executed sentence
- artifact declarations + exchange events for any bytes read/written
- tool events (`be tool ya`) when tools are used
- checkpoint/retry lines when refinery is used and checkpointing/retry are enabled

Optional records are allowed (state/debug) as long as ordering and required lines are preserved.

---

## 14. Conformance

An implementation conforms to this spec if it:

- emits exactly one run start record and one run end record
- records `evoke`, `result`, `state`, `tool`, and `artifact` events as specified
- never records `be error do` sentences in the newspaper
   - emits deterministic, byte-stable newspapers using official ordering on write
- preserves emitted records verbatim
- supports again verification rules

---

## 15. Canonical golden path example (normative)

The following sequence MUST be emitted in this order in the run newspaper:

```pyash
su name tools be map def
su name say ob text "" be say can
prah
su name helper request 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "messages": [
    {
      "role": "system",
      "content": "TOOLS:\nsu name say ob text \"\" be say can"
    },
    {
      "role": "user",
      "content": "use the say tool to say hello world"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "be_say_ob_text",
        "description": "su name say ob text \"\" be say can",
        "signature": "be say ob text",
        "parameters": {
          "type": "object",
          "properties": {
            "ob": { "type": "string" }
          },
          "required": ["ob"]
        }
      }
    }
  ],
  "stream": false
}.json.quoted from name mind be write ya
su name helper response 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      { "function": { "name": "be_say_ob_text", "arguments": "{\"ob\":\"hello world\"}" } }
    ]
  },
  "done": true
}.json.quoted from name mind be write ya
su name tool event 000001 ob la ob text "use the say tool to say hello world" for name helper to name text helper-out with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

### Summary rule

> The run newspaper is the ordered list of sentences that made a run observable.

---
## 16. Implementation pointers

- Interpreter runner: `program/command/run_pya_program.mjs` (`pushNewspaper`, `emitToolEvent`, `nextToolCounter`).
- Run wrapper: `program/command/run_with_newspaper.mjs` (PYA_NEWSPAPER capture and file write).
- Compiled JS runtime: `program/verbs/exchange/compile/js/runtime_helpers.mjs` (`newspaperRuntimeHelper`, `pyaEmitNewspaper`).
- Compiled C runtime: `program/verbs/exchange/compile/c/helpers_c.mjs` (`pya_emit_exchange`, PYA_NEWSPAPER block markers).

---

## 17. Conformance checks

- Tests: `node --test quiz/run_newspaper*.test.mjs`
- Again marker presence: `node --test quiz/again_mode_run.test.mjs`
- Tool event presence: `rg "be tool ya" newspaper/*.pya`


---

## Source Maps (JS + C)

**File:** `12-source-maps.md`  
**Status:** v0.1  
**Intent:** Provide stable, single-file source maps for compiled JS and line mapping for compiled C.

---

## 1. Goals

- Single-file outputs (no external map files).
- Line-accurate mapping from emitted code back to Pyash lines.
- Deterministic output across interpreter and compiled backends.

---

## 2. JS source maps (inline)

### 2.1 Mapping rule

- Each emitted JS statement block corresponds to one Pyash sentence.
- The compiler records the Pyash line number for each emitted line group.
- The JS emitter produces an inline source map (base64 data URL).

### 2.2 Source name + content

- `sources[0]` is the Pyash filename (basename) when compiling from filename.
- Otherwise `sources[0]` is `"<pyash>"`.
- `sourcesContent[0]` is the original Pyash text when available.

### 2.3 Internal marker

Compilers may insert a sentinel comment to mark source lines before emitting the JS for a sentence:

```js
// @pyash-line 12
```

The source map builder removes these markers and uses them to build the line mapping.

---

## 3. C line mapping (`#line`)

### 3.1 Mapping rule

When compiling from filename, the C emitter inserts `#line` directives before emitted blocks:

```c
#line 12 "example.pya"
```

This ensures compiler diagnostics and debug tooling point back to the original Pyash line.

### 3.2 Source name

Use the Pyash filename (basename) as the `#line` file string.

---

## 4. Error reporting contract

- JS uses inline source maps for runtime stack traces and tooling.
- C uses `#line` for compiler errors and debug tools.
- No special runtime error shape changes are required; the mapping is a compile-time aid.



---

## `13-exchange-and-artifact.md` (draft v0.2)

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
- how exchange and artifacts appear in the run newspaper (`05-run-recording-and-artifacts.md`)

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
su name <artifact> to filename <locator> from name <producer> be artifact ya
```

- `<artifact>` is the artifact name for this run
- `<locator>` is a normalized path or uri (see §5)
- `<producer>` identifies who produced/declared it (examples: `exchange`, `runtime`, `tool:<name>`, `module:<name>`)

### 4.2 Optional fields

Evoker linkage (recommended when available):

```
ob name <evoke-id>
```

Fallback when evoker identity is unavailable:

```
ob text <locator>
```

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
ob filename "<content-address-path>"
```

Example (fully specified):

```
su name artifact-0 ob name evoke-0 to filename "data/input.csv" as name file accordingto name sha256 fromtext text "3a0b...ff" by num 2190 from name exchange be artifact ya
```

### 4.3 Ordering

All fields (including optional fields) MUST follow official sentence ordering rules. This is governed by the case ordering and compositional case specifications.

---

## 5. Locator rules (normative)

A locator is recorded in `to filename <locator>`.

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

### 5.5 Artifacts + newspaper directory contract (runner policy)

The runner persists artifacts and newspapers relative to the current working
directory. No platform subdirectories are required.

Canonical content-addressed layout:

```
artifacts/sha256/<first2>/<next2>/<hex><ext>
```

Canonical run-root alias layout (symlink to the content-addressed blob):

```
artifacts/<run-id>/<artifact-name>
```

Notes:

- `<run-id>` is the run identifier from the run start record.
- `<artifact-name>` is the `su name` value from the artifact sentence.
- The artifact sentence records the original locator in `to filename` and the
  evoker name in `ob name`. The content-addressed blob path is derived from the
  `fromtext` sha256 hash and the locator extension, not recorded in the sentence.
- The run-root alias SHOULD be a symlink to the content-addressed blob.
- These layouts are runner policy; they MUST NOT change evaluation semantics.

Canonical newspaper layout:

```
newspaper/<run-id>.pya
```

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

Embedded sentence behavior follows `01-sentence-and-grammar.md`.

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

Failures related to exchange and artifacts MUST follow `02-core-execution.md`:

- thrown as `be error do`
- surfaced as `be error ya` at observation boundaries

Recommended stable error names for this spec (plus to `02-core-execution.md` if not already present):

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

## 13. Canonical golden path example (normative)

```pyash
su name tools be map def
su name say ob text "" be say can
prah
su name helper request 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "messages": [
    {
      "role": "system",
      "content": "TOOLS:\nsu name say ob text \"\" be say can"
    },
    {
      "role": "user",
      "content": "use the say tool to say hello world"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "be_say_ob_text",
        "description": "su name say ob text \"\" be say can",
        "signature": "be say ob text",
        "parameters": {
          "type": "object",
          "properties": {
            "ob": { "type": "string" }
          },
          "required": ["ob"]
        }
      }
    }
  ],
  "stream": false
}.json.quoted from name mind be write ya
su name helper response 000001 ob text quoted.json.{
  "model": "qwen3-vl:8b-instruct",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      { "function": { "name": "be_say_ob_text", "arguments": "{\"ob\":\"hello world\"}" } }
    ]
  },
  "done": true
}.json.quoted from name mind be write ya
su name tool event 000001 ob la ob text "use the say tool to say hello world" for name helper to name text helper-out with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

## 14. Implementation pointers

- Exchange recorder: `program/bridge/exchange.mjs` (`recordArtifact`, `recordExchange`, `normalizeLocator`).
- Interpreter verbs: `program/verbs/exchange/write.mjs`, `program/verbs/exchange/read.mjs`, `program/verbs/exchange/read_from_filename.mjs`.
- Compiled JS runtime: `program/verbs/exchange/compile/js/runtime_helpers.mjs` (`exchangeRuntimeHelper`, `pyaRecordArtifact`).
- Compiled C runtime: `program/verbs/exchange/compile/c/helpers_c.mjs` (`pya_exchange_record_bytes`, `pya_exchange_record_file`).

---

## 15. Conformance checks

- Tests: `node --test quiz/run_newspaper_exchange*.test.mjs`
- Hash mismatch handling: `node --test quiz/run_newspaper_exchange_hash_mismatch*.test.mjs`
- Artifact declarations: `rg "be artifact ya" newspaper/*.pya`
