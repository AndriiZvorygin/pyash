Got it. If we start **at the mind** and go all the way through **again + artifacts dir**, you need a *closed loop* where:

* the mind only ever deals in **normal Pyash sentences** (`can` offered, `do` evoked),
* the runtime turns some `do` into **tool executions**,
* every tool execution yields **(a) againable facts** + **(b) againable artifacts**, and
* again runs with **zero real tool calls**, consuming only the newspaper + artifacts.

Below is the minimal end-to-end contract that makes that true.

---

## End-to-end againable tool calling

### Stage 0 — Runtime builds the capability set

Runtime discovers which tool-backed verbs are available (module backends can be local tools / MCP / HTTP / etc; that detail stays behind the module façade). (`40-aspect.md` “Backends may be implemented via local tools, MCP, HTTP, or anything else.”)

### Stage 1 — Offer capabilities to the mind (`can`)

Runtime sends the mind a **deterministically ordered list** of capability sentences.

**Rule: capability offer is informational only**

* `can` **does not mutate memory** and **does not execute tools**.
* Ordering is stable: sort by canonical printed bytes of the sentence.

**Shape**
Use the *same* sentence the mind would later evoke, but with mood `can`:

* `be say ob text become audio can`
* `be hear from state audio to text can`
* `be read from state web  become markdown from url to text can` (etc.)

(If you want to keep “tool-ness” explicit, add a stable marker *as a normal case*—e.g., `from name tool`—but it’s optional for again. The tool event record is where tool-ness becomes explicit.)

### Stage 2 — Mind evokes intent (`do`)

Mind chooses an action and emits a normal `do` sentence.

* `be say ob text "hello world" do` (perfective run; your existing style)
* `be fetch from url "http://example.com" to name example do`

This is the only “call” the mind does. Everything else is runtime.

(`02-moods-and-memory.md`: `do` executes; it doesn’t store a fact unless the verb returns one.)

### Stage 3 — Runtime executes (live mode)

If the dispatched verb is tool-backed, runtime:

1. Calls the backend (hidden behind module façade).
2. Normalizes the result into **a single returned fact sentence** (strongly recommended for determinism).
3. Applies that fact to memory (LWW by `su name …`).
4. Writes **newspaper entries** and stores any produced bytes into **artifacts/**.

(`02-moods-and-memory.md`: `ya` stores facts; memory is last-write-wins keyed by `su name`.)

---

## What must be recorded for again

You need **two recorded products**, both deterministic:

1. **Tool event record** in the newspaper (`ya`, newspaper-only)
2. **Returned fact sentence** (`ya`) that encodes the semantic result (including artifact references)

### A) Tool event record (newspaper-only `ya`)

This is the “what happened” audit line, and where `la … ko` shines (since you’re using it only for newspaper records right now).

**Normative tool event sentence schema**

```pyash
su name tool event 000001
ob la <evoking sentence form> ko
to la <returned fact sentence form> ko
be tool ya
```

Determinism rules:

* `000001` is a **global monotonic counter**, zero-padded (lexical == numeric order).
* `<evoking sentence form>` and `<returned fact sentence form>` inside `la … ko` are emitted in **official canonical sentence ordering** (your `10-subordinate-clauses.md` draft requirement).
* Tool event records are appended in **execution order** (even if you’re in a sandpit; use the same global counter so merge is stable).

### B) Returned fact sentence (`ya`) + artifact reference

The semantic result must be representable as ordinary facts.

Minimum requirement:

* a tool-backed verb must return **one** `ya` sentence (you can put maps/vectors inside it if needed).

Example pattern:

```pyash
su name last audio
ob filename artifacts/run-42/last-audio.wav
to filename artifacts/sha256/ab/cd/abcdef... .wav
by text sha256:abcdef...
be artifact ya
```

Notes:

* The artifact reference is a **logical path** (always `/` separators, relative to repo/run root).
* The hash is recorded as data (`by text sha256:…` is fine; use whatever case/value combos your value grammar supports consistently).
* The content-addressed path SHOULD be recorded in `to filename`.

---

## Artifacts directory contract

To make artifacts againable, the runtime must store them **content-addressed** and
record a **run-root locator** as an alias.

**Artifact path rules**

* `artifacts/sha256/<first2>/<next2>/<hex><ext>`
* `<ext>` is deterministic from tool-declared kind (`.wav`, `.png`, `.json`, else `.blob`).
* File bytes are exactly what the backend returned.

**Run-root alias**

* The artifact sentence SHOULD include a run-root locator (e.g. `artifacts/<run-id>/<name>`)
  as a logical alias for the content-addressed path.
* The alias is recorded in the artifact declaration sentence (manifest entry). A filesystem
  symlink/hardlink MAY be created, but again MUST rely on the recorded hash + content-addressed bytes.

**Artifact verification rule**

* On live run: compute sha256, write file, record the hash in the returned fact.
* On again: read file, recompute sha256, compare to recorded hash.

* inconsistency ⇒ throw `be error do` with stable name, e.g. `su name tool again artifact hash inconsistency …`
  * file not present ⇒ `su name tool again artifact lost …` (use “lost”, not “missing”)

(Errors must be structured `be error do` with `su name`, `ob text`, `from name` per `06-errors.md`.)

---

## Again mode (no tool calls)

When running in again mode:

1. For each tool-backed `do` sentence that would execute:
2. Consume the **next tool event record** in counter order (`000001`, `000002`, …).
3. Verify:

   * evoker structural equality (canonical bytes of embedded sentence form match)
4. Apply the embedded returned fact sentence form (`to la … ko`) as if it had just been produced.
5. Verify referenced artifacts (hash check) when/if accessed (or upfront—pick one and make it consistent).

Any divergence ⇒ deterministic `be error do`:

* `tool again lost event`
* `tool again inconsistency`
* `tool again artifact lost`
* `tool again artifact hash inconsistency`

---


## Minimal quizzes that define truth

1. **Live run writes both products**

* tool `do` ⇒ returned fact applied + tool event `be tool ya` appended + artifact stored

2. **Again run produces identical final memory**

* same program + newspaper + artifacts ⇒ same memory state, zero backend calls

3. **Mismatch detection**

* change the evoking sentence ⇒ `tool again inconsistency` error sentence

4. **Artifact integrity**

* corrupt artifact bytes ⇒ `tool again artifact hash inconsistency`
* remove artifact file ⇒ `tool again artifact lost`

If you want, I can turn the above into a tight spec patch (one section each for: capability offer, tool event record schema, artifacts pathing, again algorithm, error names) plus a parity checklist for interpreter/JS/C.
