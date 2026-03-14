# Hymn Manuscript Refinery Profile

Status: reference profile for module-level `be hymn manuscript do` behavior in `module/hymn_manuscript.pya`.

## 1. Purpose

`be hymn manuscript do` builds a short educational spiritual song from source text by composing:
- a fixed hook phrase,
- a short intro,
- verse one,
- a stable chorus,
- verse two,
- a bridge,
- a final chorus,
- a short outro.

The target is a singable, memorable teaching song rather than a prose summary in lyric clothing.

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
2. generate one fixed hook phrase (`2..5` words),
3. generate intro using the hook phrase,
4. generate verse one with concrete imagery and a distinct opening role,
5. generate chorus using the exact hook phrase,
6. deterministically verify chorus contains the exact hook phrase,
7. generate verse two with a distinct supported aspect and concrete imagery,
8. generate bridge with a source-grounded turn or resolution,
9. generate final chorus that keeps the exact hook phrase and remains close to the main chorus,
10. deterministically verify final chorus contains the exact hook phrase,
11. generate short outro that repeats the hook phrase or directly reinforces it,
12. assemble final hymn,
13. deterministically verify total hook recurrence in the final hymn,
14. verify source-thrust against source text,
15. verify positive-language / negation constraint,
16. return final manuscript text.

## 4. Prompt contract

The module maintains separate prompt facts for:
- hook phrase,
- intro,
- verse one,
- chorus,
- verse two,
- bridge,
- final chorus,
- outro,
- imagery verifier,
- imagery verdict parser,
- chorus-stability verifier,
- chorus-stability verdict parser,
- source-thrust verifier,
- source-thrust verdict parser.

Prompt requirements:
- plain text only,
- no markdown/bullets/labels,
- strong singability bias,
- source-derived wording preferred over canned devotional vocabulary,
- negative phrasing (`not`, `never`, `cannot`, `don't`, `won't`, etc.) discouraged unless source absolutely requires it,
- chorus and final chorus must include the exact fixed hook phrase.

## 5. Structural constraints

The stable target contract is:
- one clear core message,
- one fixed hook phrase,
- hook phrase repeated at least three times in the finished hymn,
- chorus repetition by design,
- short memorable lines,
- verses should not merely restate each other,
- verses should include at least one concrete image or action,
- intro/outro stay short and refrain-like,
- at least one excerptable 15–30 second clip candidate should exist.

First-pass implementation priorities:
1. fixed hook phrase consistency,
2. chorus stability,
3. hook recurrence,
4. shorter line bias,
5. stronger verse progression and imagery.

## 6. Output contract

- output target is `to name text manuscript out`,
- final output is plain text with section labels:
  - `[intro]`
  - `[verse 1]`
  - `[chorus]`
  - `[verse 2]`
  - `[chorus]`
  - `[bridge]`
  - `[chorus]`
  - `[outro]`
- second chorus currently repeats the original chorus exactly,
- final chorus may expand or refresh wording, but must preserve the exact hook phrase.

## 7. Verification contract

Deterministic and verifier checks should enforce:
- bounded word count per section,
- bounded line count per section,
- hook phrase present where required,
- total hook recurrence in the final hymn,
- no unsupported concrete source-teaching claims,
- concrete imagery in verses,
- final-chorus stability against the main chorus,
- positive-language / negation guard on final output,
- later strengthening may include:
  - syllable caps,
  - verse similarity rejection,
  - hook timing checks,
  - chorus token-delta threshold,
  - clip-candidate scoring.

## 8. Integration note

`better compare` can wrap hymn-manuscript generation through clause-mode invocation to choose stronger hymn candidates.
The compare judge may use a richer virality / singability rubric, but the generator itself should already obey this structural contract before pairwise judging.
