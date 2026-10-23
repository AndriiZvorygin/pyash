# lwonprom C and Pyash style analysis

Status: working reference, based on the detached pre-October-2025 worktree at
`/home/htaf/lwonprom-pre-oct-2025`.

Snapshot analyzed: `origin/dev` / `origin/emscripten`, commit
`356b32b03a1d7f628149bab1299737ff3d492b09` (`2024-10-04`, “the interpreter
works now”). The original `/home/htaf/lwonprom` checkout remains unchanged on
`master` at `b6ef5eefcea4d10b5a0f09680976377ccfb28a35`.

This is an analysis of the project’s existing style and architecture, not a
claim that every historical file is internally consistent.

## 1. The central relationship

The C implementation is unusually close to Pyash because it does not put a
generic imperative AST between language meaning and execution. Its main data
carrier is already a linguistic object: a `Phrase` is a view into an encoded
page, and the project aliases the same representation for `Sentence`,
`Paragraph`, and `Paragraphs`:

```c
#define Sentence Phrase
#define Paragraph Phrase
#define Paragraphs Phrase
```

The type name changes with the semantic role, while the representation stays
small and composable:

```c
struct Phrase {
  struct Page page;
  txik_t begin;
  uint8_t length;
};
```

This is the C equivalent of keeping Pyash sentences and paragraphs as the
same sentence-shaped ABI while allowing a caller to describe the current view
as a sentence, a paragraph, a phrase, or a result. The `begin` and `length`
fields make a phrase a bounded slice rather than a new heap object. Most
operations can therefore accept a view, derive another view, and return it by
value.

The code is best understood as a typed linguistic dataflow system implemented
with C structs, bit fields, explicit lengths, and naming conventions. The
semantic composition is stronger than the surface C style.

## 2. Semantic objects in the C implementation

| Pyash idea | `lwonprom` C artifact | Composition rule |
| --- | --- | --- |
| sentence/paragraph | `struct Phrase`, aliased as `Sentence`/`Paragraph` | Pass a bounded view with `page`, `begin`, and `length`. |
| page/storage | `struct Page` and `line_t` arrays | A page owns the encoded words; a phrase points into it. |
| case role | grammar words plus `grammaticalCase_word_sequence` | Case discovery is table-driven, not string-based. |
| mood/perspective | perspective words and final index markers | The terminal grammatical word controls interpretation. |
| quoted value | quote marker plus following encoded words | The quote marker determines how many words and what type to read. |
| name/reference | word code and phrase position | References are found by scanning phrase boundaries and grammar words. |
| knowledge/history | `struct Paragraph knowledge_phrase` | Results are appended or replace the matching variable phrase. |
| verb dispatch | `code_name_derive`, command interpreters, and word tables | Cases and verb identity derive a command shape before execution. |
| result/return | `produce` phrase or paragraph parameter/result | Helpers preserve sentence-shaped output instead of returning unrelated scalars. |

The important point is that a C function does not usually receive an arbitrary
object graph. It receives a phrase view plus explicit context and produces a
phrase view. That is why the implementation can compose many small helpers
without introducing a separate AST or object framework.

## 3. The composition pipeline

The main path has several reversible or near-reversible stages:

```text
Pyash text
  -> Text { letters, length, max_length }
  -> Page of line_t[16] words with index bits
  -> Phrase slices found by grammar/perspective markers
  -> case/verb/mood interpretation against knowledge
  -> updated knowledge and produce Phrase
  -> translated Pyash/foreign text
```

### 3.1 Text to encoded phrases

`NewTextPhrase` is a semantic constructor macro. It creates a page, copies the
text into a bounded `Text`, calls `neo_text_encoding`, and returns a `Phrase`
view over the resulting page. The encoding path is layered rather than one
monolith:

1. `neo_text_encoding` owns the whole text/page boundary and remainder check.
2. `text_encoding` walks the text by independent-clause-sized regions and
   places each result into successive page lines.
3. `neo_independentClause_encoding` owns one clause and delegates full-word
   handling, quote handling, and end-condition handling.
4. `process_full_word`, `word_encoding`, and the `code_ACC_*` functions classify
   phonotactic glyphs and assemble a 16-bit word.
5. `tablet_word_write` and `tablet_grammar_write` write the result while
   maintaining index/phrase metadata.

The caller passes the remainder explicitly. This is characteristic of the
project: each stage has one bounded responsibility and returns both a semantic
result and enough cursor state for the next stage.

### 3.2 Encoded phrases to semantic regions

The `found.c` family is the structural reader. It does not guess phrase
boundaries from source strings. It reads index bits and grammatical word
sequences:

- `final_phrase_found` locates the surrounding grammatical boundary;
- `forward_htin_found` and `retrospective_*_found` create bounded phrase views;
- `final_perspective_found` identifies the mood/perspective terminator;
- `retrospective_verb_phrase_found` identifies the verb region; and
- `*_grammar_read` and `*_word_read` walk encoded words while updating the
  caller’s index finger.

This is a direct analogue of Pyash case lookup. The encoded page is the
sentence memory, the grammar-word sequences are the role vocabulary, and a
phrase view is the result of resolving one case or clause.

### 3.3 Interpretation as sentence-shaped rewriting

`knowledge_interpret` is the central rewrite loop. Its shape is:

1. find the next input independent clause;
2. call `neo_independentClause_interpret` with knowledge and a produce view;
3. inspect the resulting perspective/mood;
4. if it is a realis/declarative result, call
   `reform_theParagraph_byTheVariable` to replace the matching knowledge
   phrase and update the produce paragraph;
5. otherwise route control to the non-result/control path; and
6. repeat until the input is consumed or the done flag is set.

`reform_theParagraph_byTheVariable` shows the project’s functional/composable
shape even though the implementation is mutable underneath:

```text
find variable cousin
  -> hollow old cousin
  -> addenda new variable phrase
  -> return updated paragraph view
```

The operation is conceptually “latest sentence for this subject wins,” but it
preserves the encoded paragraph and its history rather than making a separate
map object. The caller can therefore chain it for knowledge and produce with
the same helper.

At the outer boundary, `pyash_to_pyash_interpret` composes the complete path:

```text
NewTextPhrase(input)
  -> NewPagePhrase(produce)
  -> knowledge_interpret(knowledge, input, produce)
  -> tablet_translate(result)
  -> produce_text
```

That is close to a Pyash ceremony: an evoking sentence enters a bounded frame,
helpers derive intermediate sentence-shaped facts, and a final sentence or
paragraph is returned.

## 4. Why the function names matter

The project’s long names are not random verbosity. They encode composition
and direction. Common pieces include:

- `fyakyi` — add/produce a phrase-like result;
- `tlatka` — word/code or translation action;
- `dva2ttu` — append/addenda direction;
- `hvatci` / `rwekci` — forward/upcoming versus retrospective traversal;
- `htinka` — phrase/sentence positioning or handling;
- `ri` — a predicate/query-like result; and
- `ryantu` / `hfantu` — transformation or completion-style endings.

The exact morphology is domain-specific, but the design consequence is
important: callers can often read a function family as an axis of composition.
For example, `fyakyi_fyakka_dva2ttu` is a phrase-addition operation, while
`retrospective_*_found` and `upcoming_*_found` are paired search directions.

The English aliases/macros in headers are a second surface over the same
function. They make the C call resemble a Pyash sentence while keeping the
implementation symbol stable. This is why replacing all names with generic
`parse`, `process`, and `handle` names would lose architectural information.

## 5. How complexity is kept low

The project treats cyclomatic complexity as a build concern, not merely a
review preference:

- `quiz/complexity.sh` runs `complexity --horrid=10 --thresh=0 --scores
  --histogram program/*c`;
- `complexity.test` makes that check part of the TAP-style quiz; and
- CI runs `make check`, alongside Clang/OpenCL compilation and Valgrind.

The history shows a sustained reduction campaign. In September 2024 the
project made focused commits such as:

- `2a18939` — lowered the maximum complexity to 14;
- `90c8e5d` — reduced `old_derive_word` complexity;
- `5ef8f0f` — reduced `sort_array_establish` complexity;
- `0cdaa3a` — reduced `code_ACC_vowel` complexity;
- `6ec1d05` — reduced `code_file_translation` complexity;
- `8d24aee` — reduced `first_word_derive` complexity;
- `2d77adb` — reduced `slogan_argument_translate` complexity;
- `85c991f` — reduced `establish_ACC_binary_phrase_list` complexity;
- `7fb3a28` — reduced `interpret_return_number`; and
- `1280edb` — reduced `dictionary_database_word_found`.

These refactors reveal the preferred technique:

1. keep the public semantic function and its data shape;
2. split one grammar/word/control case into a named helper;
3. return a clear success/failure or updated-length signal;
4. preserve the caller’s explicit cursor and buffer ownership; and
5. let the outer function sequence those helpers.

For example, `old_derive_first_word` delegates `CCV(T)C`/`CCVT` handling to
`process_CCV_pattern` and `CV(T)` handling to `process_CV_pattern`. The
function’s semantic contract remains “derive one word,” but the branch tree
is distributed across phonotactic cases. `neo_independentClause_encoding`
similarly delegates full-word work to `process_full_word` and termination to
`handle_end_condition`.

The low complexity is therefore compositional, not object-oriented. The code
does not create a parser class, visitor hierarchy, or generic dispatch table
for every operation. It uses small functions over a shared phrase/page ABI,
then composes them explicitly.

### 5.1 The important caveat

Low cyclomatic complexity does not mean low total complexity. The semantic
load is distributed into:

- packed index bits and 16-bit word formats;
- macros such as `repeat`, `conditional`, and `down_repeat`;
- pointer-plus-length views;
- manually maintained page invariants;
- mutually dependent `found`, `compile`, `interpret`, and `translation`
  helpers; and
- long domain names that carry meaning outside ordinary C vocabulary.

At the 2024 snapshot, `encoding.c`, `translation.c`, `found.c`, and `quiz.c`
are still large files. The project keeps individual decision trees bounded,
but it does not eliminate the complexity of the language/VM itself. A style
analysis that only counts lines or branches would miss this encoded semantic
complexity.

## 6. C style that is actually Pyash-like

The following conventions should be preserved when extending the baseline:

### 6.1 Explicit semantic roles in parameters

Parameters frequently use names such as `knowledge`, `input`, `produce`,
`phrase`, `tablet`, `text_remainder`, `indexFinger`, and `*_long`. These are
not generic names in context: they identify the sentence role, storage view,
or cursor role. An output buffer is usually paired with an explicit capacity
or produced length.

This resembles Pyash’s case-bearing sentence more than ordinary C APIs. A new
function should make its semantic roles visible in its signature rather than
hide them in a generic context struct.

### 6.2 Small transformations over a common ABI

The preferred function is a transformation such as:

```c
struct Phrase transform(const struct Phrase input, struct Phrase produce);
```

or a bounded scanner with explicit cursor/output arguments. This makes a
helper easy to compose into the next phrase operation and keeps the caller in
control of storage. It also mirrors Pyash’s sentence-in/sentence-out ABI.

### 6.3 Preconditions are executable semantics

`guarantee(...)` checks non-null pages, valid lengths, valid code ranges, and
non-aliasing between knowledge/input/produce pages. These checks are part of
the language implementation’s semantic contract. New code should retain them
at boundaries and use ordinary branches for expected parse rejection.

### 6.4 Macros are language adapters, not general convenience utilities

Macros such as `NewTextPhrase`, `NewPagePhrase`, `tablet_read`, and the
English/Pyash aliases encode domain operations. They should not be expanded
into a generic macro framework. Their value is that a call site reads like a
semantic operation while still compiling for C and OpenCL variants.

### 6.5 Formatting is secondary to semantic grouping

The core tends toward K&R braces and two-space indentation, but the tree has
historical four-space blocks, tabs, commented-out experiments, and legacy
helpers. There is no formatter configuration. Preserve local formatting and
avoid whole-tree reformatting; make new helpers consistent with their
neighboring module while keeping the semantic naming and parameter roles.

## 7. What a compatible future change should look like

For a new parser, encoder, interpreter, or VLIW operation:

1. identify the Pyash sentence/case/mood operation first;
2. choose the existing `Phrase`/`Page`/`Text` carrier that represents it;
3. keep input, knowledge, produce, and cursor ownership explicit;
4. split branch families by semantic case or phonotactic pattern;
5. use existing `found`, `compile`, `interpret`, and `translation` helpers;
6. preserve C/OpenCL-compatible types and fixed-width lengths;
7. add a focused quiz and keep the complexity check passing; and
8. document any new invariant beside the function or header contract.

Avoid generic modernizations that would obscure the language model: a large
AST class hierarchy, hidden heap ownership, string-based case dispatch, or a
single “process everything” function would be less compatible with both the
C style and Pyash’s compositional design.

## 8. Snapshot and recovery conclusion

There is no local evidence that a post-October-2025 GPT coding pass was
committed and then lost. `master` and `origin/master` remain at the 2022
merge; `origin/dev` and `origin/emscripten` stop at the 2024-10-04 commit;
the reflog only records the clone; and `git fsck` found no unreachable
commits. The detached worktree at
`/home/htaf/lwonprom-pre-oct-2025` is the safe working copy for the latest
available pre-October-2025 development snapshot.
