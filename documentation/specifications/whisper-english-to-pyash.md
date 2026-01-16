## Spec: Whisper Surface Form for Pyash Sentences (v0.1 draft)

### 0. Purpose

Define a speech-friendly surface syntax that roundtrips deterministically into the existing Pyash sentence model: a sentence has a mood, a `be` verb, and keyworded cases. 

This spec adds a *surface* layer only. The internal sentence object, canonical case keywords, signature derivation, and official ordering remain the source of truth.  

---

## 1. Invariants

1. **Full reversibility**: `speech -> parse -> canonical emit -> parse` yields the same canonical sentence.
2. **Punctuation independence**: parsing ignores punctuation; tokens drive structure.
3. **Keyword-first structure**: every structural boundary is introduced by a keyword that exists in the grammar keyword lists. 
4. **Official ordering on emit**: emitted Pyash uses official compositional case order and official formatting so signatures stay stable.  

---

## 2. Tokenisation and normalisation

Input: a Whisper transcript.

Normalisation steps:

* lowercase
* replace punctuation `[.,;:!?]` with spaces
* collapse repeated whitespace
* split into space-delimited tokens

Quoted block delimiters are spoken as tokens, not punctuation:
* `quoted <lang>` opens a block
* `<lang> quoted` closes a block
Punctuation is stripped before this scan, so `quoted.<lang>.` and `.<lang>.quoted` collapse to the same token pairs.

Quoted blocks are collapsed into a single internal token (`__QUOTED_TEXT__:<text>`). The `<lang>` token is only used to find the closing delimiter and is not preserved. Because normalization lowercases and strips punctuation before collapsing, quoted content is lowercased and punctuation removed.

No reliance on commas, semicolons, or periods.

---

## 3. Keyword sets (source of truth)

The implementation MUST load these keyword sets from `program/library/grammar/keywords.mjs`. 

Required sets:

* **moods** (includes `ya`, `do`, `def`, `prah`, `then`, plus others)
* **cases** (includes `su`, `ob`, and compositional cases like `fromstate`, `fromindex`, `totext`, etc.)  
* **type tokens** (includes at least `num`, `text`, `date`, `filename`, `name`, `wo`, `la`, etc.) 
* clause delimiters: `la` and `ko` for subordinate clauses 

---

## 4. Surface aliases for Whisper

### 4.1 Subject and object aliases

The parser already accepts `subj` and `obj` at the surface and canonicalizes to `su` and `ob`. 

Extend this idea for speech:

* accept `subject` as alias of `su`
* accept `object` as alias of `ob`

Canonical emission always uses `su` and `ob`.

### 4.2 Split-form compositional cases

Compositional cases are single tokens canonically (example: `fromstate`), yet the parser may accept split forms and normalizes them (example: `from state` -> `fromstate`). 

For Whisper, accept split forms for compositional cases:

* `from state` -> `fromstate`
* `to state` -> `become`
* `to text` -> `totext`
* plus any other split forms already accepted by the core parser. 

---

## 5. Speech sentence shape

### 5.1 Canonical speech form (recommended for emission)

Emit speech in Pyash-like order because it is already keyworded and signature-stable:

```
[exists] <case>* be <verb> <mood>
```

This matches the sentence model that always has `be`, plus any number of cases. 

### 5.2 Accepted input variants (for convenience)

To reduce friction for commands, accept mood as a prefix during speech input:

```
<mood> [exists] <case>* be <verb>
```

Normalise internally to the canonical form with mood suffix.

Rules:

* If the first non-quoted token is a mood, treat it as `moodPrefix`.
* Else, require a mood token at the end as `moodSuffix`.
* If both appear, raise a parse error.
* Prefix moods are normalized to suffix moods.

`exists` is not enforced by the Whisper normalizer; enforcement remains a core/runtime concern.

---

## 6. Case payload parsing

A case begins at a case keyword and consumes a value.

### 6.1 Typed payloads

Typed payloads follow the existing pattern:

* `su name <x>` identifies a subject name 
* `ob num <n>` and `ob text <t>` are typed payloads 
* typed name references: `name <type> <literal>` where `<type>` immediately follows `name` and `<literal>` may be multi-word until the next keyword boundary 

Speech mapping keeps these tokens explicit:

* “object number 5” -> `ob num 5`
* “to name num counter” -> `to name num counter`

For multi-word or free-form text payloads, use quoted blocks (`quoted <lang> ... <lang> quoted`) to avoid keyword collisions.

### 6.2 Literal-word dispatch (`wo`)

Support `wo` in speech exactly, since it affects signature words and strict literal dispatch.  

Example speech:

* “from wo microphone be record do”

### 6.3 Subordinate clauses (`la … ko`)

Speech MUST include the delimiters `la` and `ko` as spoken tokens. Everything between them is exactly one embedded sentence form. 

Example speech:

* “object la subject name clause object text ok be text ya ko be evoke ya” 

### 6.4 Quoted blocks (`quoted <lang>` / `<lang> quoted`)

Speech MUST include the two-token delimiters `quoted <lang>` and `<lang> quoted`. Everything between them is treated as text and may include keywords; the Whisper normalizer lowercases and strips punctuation before collapsing the block.

Example speech:

* “object quoted pyash su name alpha ob num 1 be number ya pyash quoted”

---

## 7. Parsing algorithm (deterministic)

Given token stream:

1. Normalise aliases:

   * `subject` -> `su`
   * `object` -> `ob`
   * `subj` -> `su`
   * `obj` -> `ob`
2. Normalise split compositional cases as per core rules.
3. Determine mood:

   * prefix mood if the first non-quoted token is in moods
   * else suffix mood must exist as final non-quoted mood token
   * if both appear, error
   * prefix moods are normalized to suffix moods
4. Parse optional `exists` (Whisper normalizer does not validate mood).
5. Parse a sequence of cases:

   * read a case keyword
   * read its value as a typed payload, name reference, `wo` literal, subordinate clause, or quoted block
   * value ends at the next case keyword, the token `be`, or the mood suffix boundary
6. Require `be <verb>`.
7. Emit canonical Pyash:

   * canonical case keywords (single-token forms) 
   * official case ordering for formatting and signatures 

---

## 8. Canonical emission back to speech

Emit in canonical speech form:

```
[exists] <cases in official order> be <verb> <mood>
```

Cases appear in official compositional keyword order, matching dispatch and signatures.  

---

## 9. Examples

### 9.1 Your command example, speech-first mood

Speech input (Whisper-friendly):

* “do be plus object number 5 to name result”

Normalised canonical Pyash:

```pyash
ob num 5 to name result be plus do
```

If you prefer the “be plus … do” ordering during emission, keep it consistent with your formatter, since signature derivation uses canonical ordering anyway. 

### 9.2 Subject included without using `by`

Speech input:

* “subject name alice do be plus object number 5 to name result”

Canonical Pyash:

```pyash
su name alice ob num 5 to name result be plus do
```

This uses `su` and `ob` via speech aliases, avoiding overload of `by` which remains available as a true case keyword (`by` in the quantity context). 

### 9.3 Literal dispatch word

Speech input:

* “from wo microphone be record do”

This preserves literal-word signature behaviour. 

---

## 10. Error handling

All speech-parse failures surface as the standard error sentence contract when observed, and propagate as `be error do` internally. 

Include source context fields when available, including `from filename`, `by num`, and `at la … ko`. 

---

If you want this spec to plug into dispatch cleanly, emit canonical order and canonical case keywords before deriving signature words, since dispatch is signature-first and case order is normalised. 
