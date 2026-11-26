# Hymn Manuscript Refinery Profile

Status: reference profile for module-level `be hymn manuscript do` behavior in `module/hymn_manuscript.pya`.

## 1. Purpose

`be hymn manuscript do` builds a short educational spiritual song from source text.

**The model writes each distinct piece once. The code assembles the song.**
Seven pieces are generated:

- a fixed hook phrase,
- verse one,
- verse two,
- verse three,
- a chorus (four lines, the first of them the hook),
- a bridge,
- an outro,
- one closing line that becomes the third chorus's fourth line.

Everything else — the order, the repeats, the section tags — is code. The
arrangement is the Yiniana reference song's:

```
[Verse] [Verse] [Chorus] [Verse] [Chorus] [Bridge] [Chorus] [Outro]
```

The second chorus is the first chorus verbatim. The third chorus is the first
chorus's first three lines plus the rewritten closing line. There is no intro —
the sheet opens on the first verse.

The target is a singable, memorable teaching song rather than a prose summary in
lyric clothing.

## 2. Exported signatures

Text source form:

```pyash
su name hymn manuscript from text source to name text manuscript out be ceremony def
```

Filename source form:

```pyash
su name hymn manuscript from filename source to name text manuscript out be ceremony def
```

Alias forms:

```pyash
su name manuscript as wo hymn from text source to name text manuscript out be ceremony def
su name manuscript as wo hymn from filename source to name text manuscript out be ceremony def
```

The filename form reads source text first, then delegates to text-source form.

## 3. Stage shape

Current target stage sequence:
1. resolve source text,
2. read a compact writing brief out of the source,
3. pull the hook-worthy source lines,
4. generate a pool of hook candidates,
5. sieve the pool down to usable refrain lines,
6. choose the hook (`4..8` words),
7. verify the hook's shape, its positive wording and its faithfulness to the source,
8. generate verse one with concrete imagery and a distinct opening role,
9. generate the chorus as a four-line stanza,
10. deterministically verify the chorus contains the exact hook phrase,
11. generate verse two with a distinct supported aspect and concrete imagery,
12. generate verse three with a third distinct supported aspect,
13. generate bridge with a source-grounded turn or resolution,
14. generate the closing line that replaces the chorus's fourth line,
15. deterministically verify the final chorus contains the exact hook phrase,
16. generate the short outro that carries the crux,
17. assemble the sheet with `hymn sheet assemble`,
18. deterministically verify total hook recurrence in the final hymn,
19. verify communal experiential voice,
20. verify source-thrust against source text,
21. verify positive-language / negation constraint,
22. return final manuscript text.

Step 7, 10, 15 and 18 are checks, not verdicts: they rate, they do not fail.

## 4. Prompt contract

The module maintains separate prompt facts for:
- hook phrase,
- hook candidate pool,
- hook source focus,
- hook sieve,
- hook chooser,
- source brief,
- verse one,
- verse two,
- verse three,
- chorus,
- final chorus line,
- bridge,
- outro,
- imagery verifier,
- imagery verdict parser,
- communal voice verifier,
- communal voice verdict parser,
- source-thrust verifier,
- source-thrust verdict parser.

There is one prompt per piece of the song. The chorus-stability verifier is
gone: the chorus identity is guaranteed by the code, so there is nothing for a
model to check.

Prompt requirements:
- plain text only,
- no markdown/bullets/labels,
- strong singability bias,
- source-derived wording preferred over canned devotional vocabulary,
- communal experiential voice preferred over command voice,
- prefer we / our / us or shared witness over direct listener instruction,
- negative phrasing (`not`, `never`, `cannot`, `don't`, `won't`, etc.) discouraged unless source absolutely requires it,
- chorus and final chorus must include the exact fixed hook phrase,
- every verifier rates HIGH, MID or LOW rather than passing or failing.

## 5. Structural constraints

The stable target contract is:
- one clear core message,
- one fixed hook phrase,
- hook phrase repeated once per chorus, three times in the finished hymn,
- the second chorus is a verbatim repeat and the third chorus turns only its last line,
- eight sections in the reference's order,
- the reference's tag vocabulary: `[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`,
- every tag on its own line,
- about 350 words for a 175 second song, which is the reference's density,
- short memorable lines,
- verses should not merely restate each other,
- verses should include at least one concrete image or action,
- the lyric should sound like shared experience rather than directives,
- the outro stays short and crux-like rather than farewell-like.

First-pass implementation priorities:
1. fixed hook phrase consistency,
2. chorus refrain identity,
3. hook recurrence,
4. shorter line bias,
5. stronger verse progression and imagery.

## 6. Output contract

- output target is `to name text manuscript out`,
- final output is plain text with section labels:
  - `[Verse]`
  - `[Verse]`
  - `[Chorus]`
  - `[Verse]`
  - `[Chorus]`
  - `[Bridge]`
  - `[Chorus]`
  - `[Outro]`,
- each label opens its own line and the sections are separated by a blank line,
- the chorus is four lines, the first of them the hook,
- the second chorus is the first chorus verbatim,
- the third chorus is the first chorus's first three lines plus the rewritten closing line,
- the outro is three short lines that carry the crux.

The assembly itself is a ceremony, `hymn sheet assemble`, and it is exported.
The sheet format is therefore testable without a model in the loop, which is
what `quiz/hymn_manuscript_sheet.test.mjs` does.

## 7. Verification contract

Deterministic checks enforce:
- bounded word count per section,
- bounded line count per section,
- hook phrase present where required,
- total hook recurrence in the final hymn.

The model checks rate instead of fail:
- source-grounded teaching content is supported (HIGH / MID / LOW),
- concrete imagery in verses (HIGH / MID / LOW),
- communal experiential voice across the finished hymn (HIGH / MID / LOW).

HIGH and MID pass. A LOW is recorded as a note and the pipeline keeps the best
value it has. There is no fatal guarantee in the module: a song that is not
quite right still gets written, because the station needs songs more than it
needs perfect ones.

Later strengthening may include:
- syllable caps,
- verse similarity rejection,
- hook timing checks,
- chorus token-delta threshold,
- clip-candidate scoring.

## 8. Ceremony parameter note

A ceremony that receives its input through a `from` slot binds that slot to the
resolved value, which for a text source is a plain string, not a typed object.
Reaching back for it with `ob of <parameter>` therefore resolves to nothing and
fails with `typed genitive defective: resolved to [object Object]`.

Use the module-wide idiom instead, which reads the invoking sentence's own slot:

```pyash
ob text of from of this to name text some request be plus do
```

A global handle built with `to name text <handle> be text do` does carry a typed
object, so `ob of <handle>` works for those; only ceremony parameters need the
`of from of this` form.

## 9. Sheet format note

A section tag is written with a plain double-quoted string and an escaped
newline, not with a `quoted.text` block:

```pyash
su name sheet begin stage ob text "[Verse]\n" to name text sheet out be text do
```

A `quoted.text` block whose content starts with `[` is read as a JSON array,
and the block ends at the first `]`, so the newline after the tag is swallowed
and the tag ends up glued to the first lyric line. That is measurable in the
render, so the sheet uses the escaped-string form and
`quiz/hymn_manuscript_sheet.test.mjs` asserts that no tag is glued to its
first lyric line.

## 10. Integration note

`better compare` can wrap hymn-manuscript generation through clause-mode invocation to choose stronger hymn candidates.
The compare judge may use a richer virality / singability rubric, but the generator itself should already obey this structural contract before pairwise judging.
