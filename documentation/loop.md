Here’s a self-contained overview you can hand to Codex as “this is how tloh / until are supposed to work in Pyash, given the current architecture”.

I’ll write it as if it were a design doc in your repo.

---

# Pyash Control Model: `tloh` (multiplicative) and `until`

## 0. Context and constraints

* Pyash sentences are currently parsed into objects with fields:

  * `subj`, `obj`, `to`, `from`, `be`, `mood`
* Memory is an **append-only log** of sentence objects; “current value” = last matching sentence.
* Ceremonies are multi-line blocks:

  * `subj name X be ceremony def` … body … `subj name X be ceremony prah`
  * invoked imperatively with `be X do`.
* There is **no support for subordinate clauses or inline arithmetic** yet. All updates must be done as separate sentences.

The control model below must fit inside this framework.

---

## 1. Conceptual model: `tloh` and `until` as control registers

We introduce two conceptual registers:

* **`tloh`** – *multiplicative register* (“number of times / step index”)
* **`until`** – *limit / goal register* (“stop when we reach this state”)

These are *not* new fields in the AST. Instead, they are expressed as **ordinary Pyash sentences** stored in memory and interpreted by a **supervisor** that wraps ceremony calls.

### Core invariants

1. When a ceremony is invoked in “repeat mode”, the supervisor maintains a pair `(tloh, until)` for that loop.
2. The loop runs while the relationship between `tloh` and `until` signals **not done**.
3. Termination is an **equilibrium condition**, not a special keyword:

   * simplest form: stop when `tloh = 0`
   * general form: stop when `tloh = until` (or another fixed relation)

---

## 2. Representation in the current workflow

For compatibility with the current memory model, `tloh` is **stored and read** as a normal declarative sentence.

### 2.1. `tloh` value = a sentence in memory

The register’s numeric value is encoded as a sentence of the form:

```pyash
subj multiplicative_case be number ya
```

More concretely (in line with the existing “number” fact style):

* `mood: "ya"`
* `be: "number"`
* the **multiplicative case** (tloh) holds the numeric value

In practice you’ll want helpers like:

* `getTloh(memory) → number | null`
* `setTloh(memory, number) → void`

which internally:

* search memory from **back to front** for the last “`tloh is number`” sentence,
* treat that as the current multiplicative value,
* append a new sentence whenever `tloh` is updated.

> Important: the `tloh` register is **not** a magic field on the sentence object; it is a convention about how a particular *fact* (“current multiplicative value”) is stored in memory.

### 2.2. Invocation sugar

To keep the surface language ergonomic, we allow sugar:

> **“Having `tloh` have a value in the call” automatically seeds the register.**

For example, a call like (surface shape, exact tokens up to you):

```pyash
tloh num 5 to name add two be add two do
```

is interpreted by the supervisor as:

1. Append or update the `tloh` register sentence (`subj multiplicative_case be number ya` with value `5`).
2. Invoke the `add two` ceremony in **repeat mode**, so the `tloh`/supervisor logic applies.

Codex shouldn’t hard-code the exact string; it should wire whatever sugar you choose into:

* “set tloh to N in memory”
* “invoke ceremony F with loop supervision”

using helper functions rather than ad-hoc logic.

---

## 3. Supervisor semantics

The **supervisor** is an abstract layer that:

* wraps calls to ceremonies,
* maintains `(tloh, until)` for that loop,
* enforces the default decrement,
* enforces the termination condition.

### 3.1. Roles

* **Caller** – chooses a ceremony and sets initial `tloh` (and optionally `until`), usually via sugar.
* **Callee** (ceremony) – runs its body; may or may not be aware that a loop is in effect.
* **Supervisor** – repeatedly calls the ceremony until the `(tloh, until)` condition says stop.

### 3.2. Default decrement rule

To keep **any ceremony usable as a loop body**, we adopt:

> If a ceremony is under a `tloh` loop and it does not explicitly set a new `tloh` value, the supervisor **automatically decrements** `tloh` by 1 after the call.

In more precise terms:

1. Supervisor snapshots `oldTloh` from memory before calling the ceremony.
2. Supervisor calls the ceremony once.
3. After the call:

   * If the ceremony **explicitly produced** a new `tloh` fact, use that as `newTloh`.
   * Otherwise, `newTloh = oldTloh - 1`.
4. Supervisor appends a new `tloh` sentence for `newTloh`.

This gives two classes of ceremonies:

* **Loop-ignorant**: never touch `tloh`. They’re called N times and then stop by default.
* **Loop-aware**: explicitly manipulate the `tloh` register inside their body to lengthen, shorten, or end the loop.

### 3.3. Ceremony override

A `tloh`-aware ceremony can:

* **Cancel the default decrement** by effectively “adding one back”:

  * e.g. set `tloh := oldTloh` or increment it internally.
* **End the loop early** by driving `tloh` straight to the termination condition:

  * e.g. set `tloh := 0` in countdown mode.
* **Reshape the loop** (increase iterations, skip ahead) by setting `tloh` to any other value.

Codex must respect this:

* If a new `tloh` fact appears in memory during the ceremony execution, supervisor must not apply its own decrement on top; the ceremony’s value wins.

---

## 4. Termination conditions

There are two levels.

### 4.1. Equilibrium with `until` (current)

* `tloh` and `until` live on the evoking sentence (treat that sentence as the source of truth; avoid separate register facts).
* The supervisor moves `tloh` toward `until`:
  * if `tloh > until` → decrement by 1
  * if `tloh < until` → increment by 1
  * if `until` is absent → treat `until = 0` (default countdown)
* Stop when `tloh == until`.

You get:

* descending loops: start > until, decrement towards it.
* ascending loops: start < until, increment towards it.
* dynamic loops: ceremony can move `until` or `tloh` mid-loop to reshape behaviour.

---

## 5. Interaction with ceremonies and `def` / `prah`

Ceremonies don’t change structurally for loops. The only extra expectations are:

1. A ceremony **may** be called in “repeat” mode if `tloh` is set at invocation time.
2. Inside a ceremony, any sentence that encodes “`tloh is number`” is interpreted as the ceremony **taking control** of the loop’s multiplicative register.

Because there’s no subordinate expressions yet, any update is done as **two steps**:

1. Mutate some working variable (e.g. `prev`) with a normal `do` sentence.
2. Reflect that into the `tloh` register by writing a new “tloh is number” sentence.

The spec for Codex is:

* Don’t introduce new AST fields.
* Implement helpers that translate between:

  * “current tloh as number” ↔ “most recent tloh sentence in memory”.
* Implement the supervisor loop as a wrapper around existing `interpret` / ceremony execution.

---

## 6. Summary for Codex

What Codex needs to implement / preserve:

1. **Leave core sentence structure intact**
   Sentences still have `subj`, `obj`, `to`, `from`, `be`, `mood`. No new fields.

2. **Represent `tloh` as a fact in memory**

   * “tloh register = the numeric value stored in the last `multiplicative_case be number ya` sentence”.
   * Access via helper functions instead of ad-hoc lookups.

3. **Add a supervisor layer for repeat calls**

   * When a call is marked as having a `tloh` value, wrap it in a loop:

     * read `tloh`,
     * call ceremony,
     * detect whether ceremony wrote a new `tloh` fact,
     * if not, decrement automatically,
     * check termination (at least: `tloh == 0` stops),
     * repeat or stop.

4. **Default decrement behaviour**

   * If ceremony is loop-ignorant: supervisor decrements `tloh` by 1 each iteration.
   * If ceremony is loop-aware (writes `tloh`): supervisor uses that value without further modification.

5. **Future-proof for `until`**

   * Keep room for a second register `until` handled in the same style (as a sentence in memory).
   * Termination rule will eventually generalize to equilibrium `tloh == until`.

6. **No subordinate expressions**

   * All arithmetic on counters must be modelled as sequences of simple sentences, not `prev - 1` inline.
   * That’s a language limitation, not the supervisor’s problem.

If Codex follows these rules, we get:

* A repeatable, Turing-complete loop model that fits the existing Pyash architecture.
* Backwards compatibility with current facts (`ya` statements).
* A clear path to adding `until` and more sophisticated control later without breaking the core design.
