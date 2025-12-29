Here’s a cleaned-up `signature.md` focused only on signatures, with no `typeWords`, no mood assumptions, and using `name num` / `name vec num` so it lines up with C/C++ pointer semantics and your JS naming convention.

You can paste this straight over the old file.

---

````markdown
# Signature Matching in Pyash

This note defines how **signatures** work in Pyash and how we use them for deterministic verb dispatch.

The goal:

- Every Pyash **sentence** has a **official signature**.
- Every **ceremony definition** (a `be ... def` block) declares one **signature** it implements.
- Dispatch conceptually is: *build the sentence signature → look it up → run that ceremony*.

There are **no optional cases** at the signature level.  
If a verb supports multiple patterns, each pattern has its **own** signature and ceremony.

---

## 1. Sentences at runtime (shape only)

At the JS bridge level, a sentence is a plain object:

```ts
type NameRef = {
  name: string; // e.g. "w", "inputs", "acc"
};

type Sentence = {
  mood: string; // e.g. "do", "ya", ...
  be: string;   // the verb, e.g. "add", "neuron", "twice crescent"

  // cases as properties; may or may not be present on a given sentence
  su?: any;
  ob?: any;
  from?: any;
  by?: any;
  fromstate?: any;
  to?: any;

  // future cases can be added here
  [k: string]: any;
};
````

The important idea: the **verb** is in `be`, and **cases** are fields like `ob`, `from`, `by`, `fromstate`, `to`, etc.
Names are represented simply as `{ name: "variable name" }`.

This document only specifies the **signature format**; it does not dictate how the rest of the runtime works.

---

## 2. Signature format (official word list)

A **signature** is a flat list of **words**, in the same spirit as Pyash sentences:

> `["be", VERB, CASE₁, TYPE WORDS..., CASE₂, TYPE WORDS..., ...]`

Rules:

1. The signature **always starts** with:

   ```txt
   "be", <normalised verb>
   ```

2. Each **case** appears as:

   ```txt
   CASE, TYPE WORDS...
   ```

   where **TYPE WORDS** is one or more words, such as:

   * `["num"]`
   * `["vec","num"]`
   * `["name","num"]`
   * `["name","vec","num"]`
   * `["text"]`

3. The **case chunks are sorted by case name** so that the original word order in the sentence does not matter.

4. There are **no optional cases** inside a single signature.
   If a sentence omits or adds a case, it produces a different signature.

The signature is defined by the **ceremony** (see below). Sentences that match a ceremony’s cases and types share that ceremony’s signature.

---

## 3. Type words and C compatibility

Type information is expressed as **words**, never with extra symbols.

Some core examples:

* Scalar number value: `num`
* Vector of numbers (value): `vec num`
* Name pointing to a number: `name num`
* Name pointing to a vector of numbers: `name vec num`
* Text string value: `text`

These can be mapped naturally to C/C++:

| Pyash type words | C/C++ style            | Meaning                  |
| ---------------- | ---------------------- | ------------------------ |
| `num`            | `double` (etc.)        | numeric value            |
| `name num`       | `double *`             | pointer to numeric value |
| `vec num`        | `double *` + length    | vector of values         |
| `name vec num`   | `double **` or similar | pointer to vector        |
| `text`           | `const char *`         | string value             |

This document does not enforce a particular C type, only the **word shapes**.

---

## 4. Examples of signatures

### 4.1. Neuron

Conceptual sentence (roughly):

```text
from      name vec num weights
by        name vec num inputs
fromstate num         bias
to        name num    output
be neuron
<some mood>
```

Type expectations:

* `from`: `name vec num`
* `by`: `name vec num`
* `fromstate`: `num`
* `to`: `name num`

Signature (cases sorted: `by`, `from`, `fromstate`, `to`):

```txt
["be","neuron",
 "by","name","vec","num",
 "from","name","vec","num",
 "fromstate","num",
 "to","name","num"]
```

### 4.2. Add

```text
ob num 3
to  name num acc
be add
<mood>
```

Signature:

```txt
["be","add",
 "ob","num",
 "to","name","num"]
```

### 4.3. Divide

```text
from name num w
by   num       x
to   name num  z
be divide
<mood>
```

Signature:

```txt
["be","divide",
 "by","num",
 "from","name","num",
 "to","name","num"]
```

### 4.4. Activation (“twice crescent”)

```text
ob num 0
be twice crescent
<mood>
```

Signature:

```txt
["be","twice crescent",
 "ob","num"]
```

---

## 5. Ceremonies and signatures

A **ceremony definition** for a verb declares the **cases and types** it expects to receive, using the same words that appear in signatures.

Example neuron ceremonies:

```text
be neuron def
  from      name vec num
  by        name vec num
  fromstate num
  to        name num
ceremony
  ...
end

be neuron def
  from      name vec num
  by        name vec num
  to        name num
ceremony
  ...
end
```

These define two distinct signatures:

```txt
["be","neuron",
 "by","name","vec","num",
 "from","name","vec","num",
 "fromstate","num",
 "to","name","num"]

["be","neuron",
 "by","name","vec","num",
 "from","name","vec","num",
 "to","name","num"]
```

There are **no optional cases** inside a single signature:
each ceremony is tied to **exactly one** verb/case/type pattern.

A loader or compiler can:

1. Read each `be ... def` block.
2. Collect its case + type words.
3. Sort those cases by case name.
4. Form the flat signature word list.
5. Register the ceremony implementation under that signature.

The runtime uses the same signature shape when matching sentences to ceremonies.

---

## 6. Core function naming (JS and C)

Core implementations can be named directly from the signature words, using underscores between words and keeping the order of the signature (after sorting cases).

Pattern:

```text
core_<verb>_<case>_<typeWords>_<case>_<typeWords>_...
```

Examples:

* Signature:

  ```txt
  ["be","add",
   "ob","num",
   "to","name","num"]
  ```

  JS/TS core:

  ```ts
  function core_add_obj_num_to_name_num(/* ... */) { /* ... */ }
  ```

* Signature:

  ```txt
  ["be","divide",
   "by","num",
   "from","name","num",
   "to","name","num"]
  ```

  Core:

  ```ts
  function core_divide_by_num_from_name_num_to_name_num(/* ... */) { /* ... */ }
  ```

* Signature:

  ```txt
  ["be","neuron",
   "by","name","vec","num",
   "from","name","vec","num",
   "fromstate","num",
   "to","name","num"]
  ```

  Core:

  ```ts
  function core_neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num(/* ... */) { /* ... */ }
  ```

A C or C++ implementation can export functions with **the same names** so linkage and dispatch stay consistent across JS and C:

```c
void core_add_obj_num_to_name_num(double ob, double *to);
void core_divide_by_num_from_name_num_to_name_num(double by, double *from, double *to);
void core_neuron_by_name_vec_num_from_name_vec_num_fromstate_num_to_name_num(
    double *by,
    double *from,
    double  fromstate,
    double *to
);
```

This document does not prescribe the argument order or const-ness; the key point is that the **function names** are derived from the same signature words.

---

## 7. Signature keys and lookup

The **official form** of a signature is the flat word list:

```txt
["be","neuron",
 "by","name","vec","num",
 "from","name","vec","num",
 "fromstate","num",
 "to","name","num"]
```

An implementation can choose how to use this list as a **key**:

* Join the words into a single string, for example:

  ```txt
  "be neuron by name vec num from name vec num fromstate num to name num"
  ```

* Or store the list as-is and use a custom comparison.

Possible lookup structures include:

* A hash map / dictionary keyed by the joined string.
* A sorted array of `[key, implementation]` pairs, using binary search on the key.
* Any other structure that uses the same official word sequence as the basis of equality.

This document does not require a particular data structure; it only specifies:

* The **word order**.
* The **content** of the signature.

Any lookup mechanism that treats the same word sequence as the same signature is valid.

---

## 8. Summary

* A **signature** is a flat list of words:

  ```txt
  ["be", verb, case₁, type words..., case₂, type words..., ...]
  ```

* Cases are sorted by case name.
  Types are word sequences like `num`, `vec num`, `name num`.

* **Names** are represented by `name ...` type words (for example `name num`), which can map cleanly to pointers in C/C++.

* There are **no optional cases** inside a signature: each verb/case/type pattern corresponds to one ceremony and one signature.

* **Ceremony definitions** use the same case and type words, and their `def` blocks directly determine the signature.

* Core JS and C functions are named from the signature words using underscores, so the whole pipeline stays consistent and readable.

```

---

## 9. Current runtime status (January 2025)

The runtime now uses **signature-first dispatch**:

- Built-in verbs register their signatures at startup (`program/verbs/index.mjs` → `builtInSignatures` → registry in `program/bridge/signature.mjs`).
- Imperatives derive a signature from the call (case/type words, sorted by case) and dispatch to the registered handler; ceremony `def` headers register their signatures and are invoked the same way.
- Conditionals (`then` mood) use the same signature registry for truth-evaluable verbs (`giant`/`tiny`/`equally`).
- Legacy verb-map fallback has been removed entirely; only signature handlers/definitions are used. A missing signature now throws `Unknown verb: X`.
- Sandpit write-back is strict: numeric signatures must return/merge a value; non-numeric signatures do not get fabricated defaults.

---

## 10. TODO for future Codex

1. Reduce signature variant sprawl by improving type inference (e.g., names → vec/text when remembered) and pruning unused variants.
2. Generate signatures from ceremony `def` headers once case/type info is captured there.
3. Keep docs/examples in sync with strict signature dispatch (unknown/mismatched signatures surface as `Unknown verb`).
