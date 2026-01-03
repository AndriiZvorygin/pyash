# `11-run-newspaper.md` (draft v0.2)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define the **run newspaper**: the official, append-only record of one Pyash run.

The run newspaper exists to:

- make runs **againable**
- make runs **diffable**
- provide an official record for pipelines, tools, and auditing

The newspaper records **events as sentences**, including embedded sentence forms using subordinate clauses (`10-subordinate-clauses.md`).

Thrown errors (`be error do`) NEVER appear in the newspaper. Only surfaced errors (`be error ya`) do.

The newspaper is an **official `.pya` artifact**. Other formats are optional exports and are not normative.

Tooling MAY choose to emit the newspaper only when explicitly requested (for example via a CLI flag). When emission is enabled, all rules in this spec apply.

---

## 2. Terms

- **run** — one execution of a Pyash program
- **run id** — the identifier of a run, expressed as `su name <run>`
- **newspaper** — the ordered sequence of newspaper records for a run
- **event** — one newspaper record (a sentence)
- **evoke** — requesting execution of a verb
- **surface** — converting a thrown error (`be error do`) into an observable error result (`be error ya`)
- **subordinate clause** — `la … ko` sentence embedding (see `10-subordinate-clauses.md`)
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

The `tool` event schema is defined in `15-tool-envelope.md`.

Later specifications may add additional event kinds, but these MUST exist.

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
- State sentences MUST include all required fields for that primitive as defined in `09-runtime-primitives.md`.

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

Additional artifact fields (hash, size, mime, etc.) are defined in `13-exchange-and-artifact.md`.

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
- verify artifact hashes during again (hash rules defined in `13-exchange-and-artifact.md`)

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
su name tool event 000001 ob la ob text "use the say tool to say hello world" to name helper with name tools be write do ko to la su name helper answer 1 from name helper ob text "say hello world" be answer ya ko be tool ya
su name artifact-0 ob name evoke-0 to filename "out.txt" accordingto name sha256 fromtext text "3a0b...ff" by num 6 from name exchange be artifact ya
```

---

### Summary rule

> The run newspaper is the ordered list of sentences that made a run observable.

---
## 16. Implementation pointers

- Interpreter runner: `program/command/run_pya_program.mjs` (`pushNewspaper`, `emitToolEvent`, `nextToolCounter`).
- Run wrapper: `program/command/run_with_newspaper.mjs` (PYA_NEWSPAPER capture and file write).
- Compiled JS runtime: `program/verbs/exchange/compile.mjs` (`newspaperRuntimeHelper`, `pyaEmitNewspaper`).
- Compiled C runtime: `program/verbs/exchange/helpers_c.mjs` (`pya_emit_exchange`, PYA_NEWSPAPER block markers).

---

## 17. Conformance checks

- Tests: `node --test quiz/run_newspaper*.test.mjs`
- Again marker presence: `node --test quiz/again_mode_run.test.mjs`
- Tool event presence: `rg "be tool ya" newspaper/*.pya`
