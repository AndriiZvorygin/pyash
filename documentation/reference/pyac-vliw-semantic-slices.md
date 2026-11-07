# Pyac VLIW semantic slices

The normative encoding and execution boundary is
`documentation/specifications/27-pyash-vliw-isa.md`. This reference records the
currently proven semantic slices and their fixtures.

## Numeric plus

The first executable slice uses:

```pyash
ob num 1 to num 1 be plus do
```

The JavaScript reference backend accepts unsigned 16-bit `ob num A to num B`
plus, preserving the legacy instrumental and accusative operands. Numeric plus
saturates at `0xFFFF`, subtract floors at zero, divide returns the integer
quotient, and divide by zero is an explicit execution error.

The fixed 16-word codelet has this nine-word prefix:

```text
0149 881D A 287E 881D B 245E 8A64 295E
```

Seven zero words complete the vector. The decoder validates markers, numeric
quote fields, and the zero tail before returning the canonical sentence. The
reference implementation is `program/library/vliw/plus.mjs`; its fixture is
`examples/pyash/vliw-numeric-plus.pya`, with conformance in
`quiz/vliw_plus_semantics.test.mjs`.

## Quote descriptors and surface rendering

The legacy quote-denote is `0x001D`, with `0x881D` numeric, `0x081D` letter,
and `0x0E1D` paragraph-letter classes. `decodeQuoteHeader` exposes region,
pointed, sequence, vector-width, scalar-width, and sort fields. Numeric and
letter quotes consume one 16-bit payload; paragraph-letter quotes consume an
explicit length and character words. The uint sort also carries 32-bit and
64-bit scalars, and a vector thickness above zero states how many elements the
quote holds, so `0x981D` is a uint64 and `0x8F1D` is a uint16 vector of three
elements.

Quote markers describe value representation. Lexical Pyash spellings remain HNUC
table entries; the shared decoder combines typed values with case markers. The
plus golden vector renders as `hyikdoyu hyikdoka plustu`, while its canonical
semantic form remains `ob num 1 to num 1 be plus do`.

The decoder accepts unsigned numeric, single-character, and paragraph-letter
payloads. Surface number rendering currently covers legacy zero through twenty;
larger numbers remain structured until compound surface composition is added.

## Generic fixed-slot decoding

`program/library/vliw/codelets.mjs` losslessly decodes the existing 16-word slot,
delegating quote words to the shared decoder and resolving known lexical words
through HNUC. Unknown non-quote words remain raw. The first standalone zero marks
the used boundary and all following slots must be zero. `renderLegacyCodelet`
preserves raw words and supported typed values without claiming arbitrary codelets
are executable.

`program/library/vliw/word_code.mjs` ports lwonprom's
`neo_word_code_encode` shape: glyph length and placement select word class, then
consonant, vowel, tone, and final-consonant fields are packed. The inverse decodes
to Pyac. `pyashWords.json` supplies vocabulary membership and English glosses,
not HNUC calculation. Phrase codelets use this through `phrase.mjs`.

## Typed literals

The second slice covers:

```pyash
ob num 7 be number ya
ob text "A" be text ya
```

The five-word prefixes are:

```text
0019 881D value 245E 217E
0019 081D code-unit 245E 217E
```

Numeric values use unsigned 16-bit payloads; letters use one UTF-16 code unit;
paragraph letters use an explicit length and bounded UTF-16 payload. Decoding
returns the canonical `ya` sentence and execution returns the same typed fact.
The implementation is `literal.mjs`, with fixtures
`vliw-typed-literals.pya` and `vliw-extended-values.pya` and quizzes
`vliw_literal_semantics.test.mjs` and `vliw_extended_values.test.mjs`.

## Named scalar facts

Named facts use the legacy index, name, nominative case, typed quote/payload,
accusative case, and realis mood:

```text
0065 name 24DE 881D value 245E 217E
0065 name 24DE 081D code-unit 245E 217E
```

`named_literal.mjs` supports one or more legacy vocabulary words per name,
unsigned numeric values, and bounded paragraph-letter text. Unknown names, wider
text, and unsupported quote widths retain explicit rejection reasons. The runnable
fixture is `examples/pyash/vliw-named-literals.pya`.

`buildVliwDatabaseFromTranslation(lines, options)` resolves an existing
translation adapter, preserves one source record per translated sentence, and
passes canonical sentences through catalog, pack, query, and replay contracts.
Records retain language, locator, line index, sentence index, and original text.

## Numeric operators

The binary numeric operators share one nine-word prefix. The operator word at
slot 7 names the operation, and the head word at slot 0 is the legacy parse
index for that shape:

```text
0149 881D A 287E 881D B 245E operator 295E
```

`arithmetic.mjs` covers `subtract` (`0xABD2`), `multiply` (`0xEC90`),
`divide` (`0x8893`), `xor` (`0xA810`), `exponential` (`0x8C29`), and `remains`
(`0xE82A`). `plus` keeps its own adapter because it saturates at `0xFFFF`.

`exponential` and `remains` are Pyash-native semantics in the legacy binary
operator layout: the legacy has no power or remainder verb, so the vocabulary
word is normative but no legacy sentence exists for them. The right operand
comes from `from` or `by`, because in those two verbs `to` is the result
target. The result saturates into the unsigned 16-bit range, and a zero
divisor is a `division-by-zero` execution error.

## Numeric invert

The legacy invert codelet carries the value in the accusative phrase and the
bound it is inverted about in the dative phrase:

```text
0149 881D A 245E 881D B 207E AAD2 295E
```

The legacy computes `not value + bound`. Pyash inverts a number by negating
it, so the bound is fixed at zero and the legacy phrase shape is kept. A
codelet whose dative phrase names a bound is the legacy's own form; Pyash has
no verb for it, so the decoder rejects it rather than inventing a meaning.
The implementation is `program/library/vliw/invert.mjs`, with conformance in
`quiz/vliw_invert.test.mjs`.

## Head and index words

The head word at slot 0 is the legacy index. Bit 0 says whether the vector
completes the codelet, and every other bit marks one slot that holds a
phrase-closing case word or a codelet-ending mood word. The legacy VM reads a
slot as a boundary when its bit equals bit 0, so the head carries the
completion bit plus one bit per boundary slot. `indexWordFor` in
`program/library/vliw/codelets.mjs` computes that word, and the legacy golden
vectors agree with it: the numeric plus head `0x0149` marks the instrumental,
accusative, and deontic slots, and the named-literal head `0x0065` marks the
nominative, accusative, and realis slots.

## Date literals

A date is a uint64 count of milliseconds since the Unix epoch. The legacy quote
format reserves the 64-bit scalar thickness for exactly this, so the value
travels in a uint quote with four payload words:

```text
00C1 981D word0 word1 word2 word3 245E 217E
```

The date string must be ISO-8601 and reproducible: a plain day is midnight UTC,
and a date-time needs an explicit timezone. `now`, `today`, and local times are
rejected, because their lowering would not be reproducible. Decoding renders the
canonical Pyash form, which is a plain day when the value is midnight UTC and
the full ISO form otherwise. The implementation is
`program/library/vliw/date.mjs`, with conformance in
`quiz/vliw_date.test.mjs`.

## Vector literals

A numeric vector travels as a uint quote whose vector thickness states how
many 16-bit elements it holds. The legacy has fixed thicknesses for two, three,
four, eight, and sixteen elements and an explicit length form for every other
width:

```text
0061 8F1D element element element 245E 217E
0301 8E1D length element element element element element 245E 217E
```

A one-element vector is refused, because its quote is identical to a numeric
literal and the format cannot tell the two apart. A vector holds at most
eleven elements, the widest that still fits in one codelet. Only numeric
vectors have a proven encoding; other element types keep an explicit rejection
reason. The implementation is `program/library/vliw/vector.mjs`, with
conformance in `quiz/vliw_vector.test.mjs`.

Both literal families share the layout in
`program/library/vliw/literal_layout.mjs`: head, optional name phrase with its
nominative case, quote, payload, accusative case, and realis mood. The legacy
format has no slot for the `exists` keyword, so a declared literal is written
without it and a name outside the legacy vocabulary is refused.

## Reference facade

`program/library/vliw/index.mjs` exposes:

- `lowerSentence(sentence)` and `lowerParagraph(paragraph)`;
- `decodeCodelet(words)`;
- `executeCodelets(codelets)`; and
- `scheduleCodeletDependencies(instructions)`, which rejects unresolved
  references and duplicate writers.

The proven facade supports numeric `plus`, scalar `subtract`, `multiply`,
`divide`, `xor`, `exponential`, and `remains`; numeric `invert`; anonymous and
named numeric/text/boolean literals; multiword legacy names; bounded
paragraph-letter text; and numeric vector and date literals. Valid but unknown
codelets decode losslessly and are then rejected explicitly.

The Rust crate in `rust/pyac/` mirrors the numeric operator set, the invert
codelet, and the date and vector literal families, so the two implementations
agree on the bytes and on the values they compute. Its pack executor still
covers the arithmetic slice only; it reports an unsupported operator for a
codelet outside that slice rather than guessing.
