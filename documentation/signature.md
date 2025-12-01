Here’s a complete rewrite of `signature.md` in the “all words, no weird symbols” style, and with ceremonies using the same case/type identifiers.

You can just replace the file contents with this.

---

````markdown
# Signature Matching in Pyash

This note defines how **signatures** work in Pyash and how we use them for fast, deterministic verb dispatch.

The goal:

- Every Pyash **sentence** has a **canonical signature**.
- Every **ceremony definition** (a `be ... def` block) declares one or more **signatures** it implements.
- Dispatch is just: *build the sentence signature → look it up in a table → run that ceremony*.

There are **no optional cases** at the signature level.  
If a verb supports multiple patterns, each pattern has its **own** signature and ceremony.

---

## 1. Sentences at runtime

At the bridge level (JS/TS), a parsed sentence is a plain object:

```ts
type Sentence = {
  mood: string; // e.g. "do", "ya", ...
  be: string;   // the verb, e.g. "add", "neuron", "twice crescent"

  // cases as properties; may or may not be present
  subj?: any;
  obj?: any;
  from?: any;
  by?: any;
  fromstate?: any;
  to?: any;

  // future cases can be added here
  [k: string]: any;
};
````

The important idea: the **verb** is in `be`, and **cases** are fields like `obj`, `from`, `by`, `fromstate`, `to`, etc.

---

## 2. Signature format (canonical word list)

A **signature** is defined as a flat list of **words**, in the same spirit as Pyash sentences:

> `["be", VERB, CASE₁, TYPE₁..., CASE₂, TYPE₂..., ...]`

Rules:

1. The signature **always starts** with:

   ```txt
   "be", <normalised verb>
   ```

2. Each **case** appears as:

   ```txt
   CASE, TYPE WORDS...
   ```

   where **TYPE WORDS** is one or more words, like:

   * `["num"]`
   * `["vec","num"]`
   * `["name"]`
   * `["text"]`

3. The **case chunks are sorted by case name** so that the original word order in the sentence does not matter.

4. There are **no optional cases** inside a single signature.
   If a sentence omits or adds a case, it produces a different signature.

### Examples

#### Neuron

Sentence (roughly):

```text
from name weights
by name inputs
fromstate num bias
to name output
be neuron
do
```

Type expectations:

* `from`: vector of numbers → `vec num`
* `by`: vector of numbers → `vec num`
* `fromstate`: number → `num`
* `to`: name → `name`

Signature:

```txt
["be","neuron",
 "by","vec","num",
 "from","vec","num",
 "fromstate","num",
 "to","name"]
```

#### Add

```text
obj num 3
to name acc
be add
do
```

Signature:

```txt
["be","add",
 "obj","num",
 "to","name"]
```

#### Divide

```text
from name w
by name x
to name z
be divide
do
```

Assuming both `from` and `by` refer to numbers:

```txt
["be","divide",
 "by","num",
 "from","num",
 "to","name"]
```

#### Activation (“twice crescent”)

```text
obj num 0
be twice crescent
do
```

Signature:

```txt
["be","twice crescent",
 "obj","num"]
```

---

## 3. Type words

Type information is also expressed as **words**, never with angle brackets or symbols.

Some basic examples:

* Scalar number: `num`
* Vector of numbers: `vec num`
* Name: `name`
* Text string: `text`

In JS/TS you can keep this as either:

* A list of words for each case (e.g. `["vec","num"]`), or
* Flattened into the global signature word list.

Internally, the bridge can use a helper like:

```ts
function typeWords(value: any): string[] {
  // These rules can be adjusted as the runtime grows.
  if (value?.ve && value.ve.type === "num") return ["vec","num"]; // Pyash vector literal
  if (typeof value === "number") return ["num"];
  if (value?.kind === "name" || value?.type === "name") return ["name"];
  if (typeof value === "string") return ["text"];

  return ["unknown"];
}
```

---

## 4. Building a signature from a sentence

We only consider a fixed set of case names for now:

```ts
const CASE_NAMES = ["subj","obj","from","by","fromstate","to"] as const;
```

Algorithm in words:

1. Take the verb from `sentence.be` and normalise it (for example, lower case).
2. For each known case name:

   * If `sentence[caseName]` exists:

     * Compute its type words with `typeWords(...)`.
     * Form a **case chunk**: `[caseName, ...typeWords]`.
3. Sort the chunks by the case name.
4. Start the signature as `["be", verb]`.
5. Append each chunk’s words in order.

Pseudocode:

```ts
type Sentence = { mood: string; be: string; [k: string]: any };

export function makeSignatureWords(sentence: Sentence): string[] {
  const verb = sentence.be.trim().toLowerCase();

  const caseChunks: string[][] = [];

  for (const caseName of CASE_NAMES) {
    const v = sentence[caseName];
    if (v === undefined) continue;

    const tw = typeWords(v); // e.g. ["vec","num"]
    caseChunks.push([caseName, ...tw]);
  }

  // Canonical order
  caseChunks.sort((a, b) => a[0].localeCompare(b[0]));

  const sig: string[] = ["be", verb];
  for (const chunk of caseChunks) {
    for (const w of chunk) sig.push(w);
  }

  return sig;
}
```

Any two sentences that are the “same pattern” should produce the same `sig`.

---

## 5. Ceremonies and signatures

A **ceremony definition** for a verb should declare the **same cases and types** it expects to receive.

Conceptually, in Pyash you might write something like:

```text
be neuron def
  from vec num
  by vec num
  fromstate num
  to name
ceremony
  ...
end
```

This simply says:

* There is a ceremony for the verb `neuron`.
* It expects the signature:

  ```txt
  ["be","neuron",
   "by","vec","num",
   "from","vec","num",
   "fromstate","num",
   "to","name"]
  ```

Another ceremony for a different pattern could exist under the same verb:

```text
be neuron def
  from vec num
  by vec num
  to name
ceremony
  ...
end
```

This describes a **different** signature:

```txt
["be","neuron",
 "by","vec","num",
 "from","vec","num",
 "to","name"]
```

There are **no optional cases** inside a single signature.
Instead, you have **multiple ceremonies** for different case/type combinations.

In the JS/TS bridge, the compiler / loader should:

1. Read each `be ... def` block.
2. Extract its signature words from the case and type lines.
3. Register that ceremony in the dispatch table under that signature.

---

## 6. Dispatch table

At runtime we maintain a dispatch table from signatures to implementation functions.

We treat the **word list** as the canonical shape and turn it into a simple string key inside JS/TS for lookup.

```ts
type SignatureWords = string[];
type ImplFn = (sentence: Sentence, ctx: { remember: any }) => any;

const DISPATCH = new Map<string, ImplFn>();

function sigKey(words: SignatureWords): string {
  // Internal representation only; you never see this in Pyash.
  // We just join on a space to get a stable key.
  return words.join(" ");
}

export function registerSignature(words: SignatureWords, impl: ImplFn) {
  DISPATCH.set(sigKey(words), impl);
}

export function dispatch(sentence: Sentence, ctx: { remember: any }) {
  if (sentence.mood !== "do") {
    throw new Error(`dispatch only handles mood "do" for now`);
  }

  const sig = makeSignatureWords(sentence);
  const key = sigKey(sig);

  const impl = DISPATCH.get(key);
  if (!impl) {
    throw new Error(`no implementation for signature: ${key}`);
  }

  return impl(sentence, ctx);
}
```

Registering ceremonies by hand (for now) looks like:

```ts
registerSignature(
  ["be","add","obj","num","to","name"],
  implAddNumToName
);

registerSignature(
  ["be","neuron",
   "by","vec","num",
   "from","vec","num",
   "fromstate","num",
   "to","name"],
  implNeuron
);

registerSignature(
  ["be","twice crescent","obj","num"],
  implTwiceCrescent
);
```

Later, this registration should be generated automatically from the `def` blocks.

---

## 7. Key choice: plain sentence vs fixed-length hash

Internally, we need a **key** for the `Map`. There are two main options:

### Option A (recommended for now): use the flat word sentence

This is what the example above does:

```ts
function sigKey(words: string[]): string {
  return words.join(" ");
}
```

Pros:

* Very simple to implement.
* Easy to debug (you can log the key and see the verb + cases directly).
* JavaScript engines already hash string keys internally for `Map`,
  so you still get O(1)-ish lookup.

Cons:

* Keys are longer strings, so they take a bit more memory than a short hash.
* The cost of `join` + hashing the resulting string may be slightly higher if you have **huge** numbers of signatures.

In practice, this is more than fine for a language runtime like Pyash.

### Option B: fixed-length hash of the signature sentence

If we ever find that string keys are a problem, we can swap `sigKey` for a small hash:

```ts
function hashString(s: string): string {
  // some small non-crypto hash, returning a short hex string
  // (e.g. a 32-bit integer turned into hex)
}

function sigKey(words: string[]): string {
  return hashString(words.join(" "));
}
```

Pros:

* Keys are shorter.
* Slightly smaller memory footprint in the dispatch table.

Cons:

* Harder to debug (you see `a3f9c7e2` instead of `"be neuron by vec num ..."`).
* You have to trust the hash; collisions must be rare but are possible.

**Recommended path:**

* Start with **Option A**: join the words into a string key.
* Only switch to a fixed-length hash later if profiling shows it matters.

---

## 8. Summary

* A **signature** is a flat list of words:

  ```txt
  ["be", verb, case₁, type words..., case₂, type words..., ...]
  ```

* Cases are sorted, types are word sequences like `num`, `vec num`, `name`.

* **No optional cases** inside a signature: each verb/case/type pattern is its own signature and ceremony.

* **Ceremony definitions** use the same case and type identifiers, and generate signatures that match this format.

* The JS/TS bridge builds the sentence’s signature, converts it to a key, and looks up the correct ceremony in a `Map`.

You can implement this step by step:

1. Add `makeSignatureWords(sentence)`.
2. Use `"be", verb, case, type words...` as the canonical format.
3. Add `registerSignature` and `dispatch` using a simple string key (`words.join(" ")`).
4. Gradually move ceremonies to declare their own signatures so they can be registered automatically.

