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
4. generate verse one with concrete imagery and an opening struggle/setup role,
5. generate chorus using the exact hook phrase,
6. generate verse two with a transformation / awakening role distinct from verse one,
7. generate bridge that lands in the healed or illuminated state,
8. generate final chorus that keeps the exact hook phrase and remains close to the main chorus,
9. generate short outro that repeats the hook phrase or directly reinforces it,
10. assemble final hymn,
11. verify source-thrust against source text,
12. verify positive-language / goal-state constraint,
13. return final manuscript text.

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
- source-thrust verifier,
- source-thrust verdict parser.

Prompt requirements:
- plain text only,
- no markdown/bullets/labels,
- strong singability bias,
- positive goal-state language preferred,
- negative phrasing (`not`, `never`, `cannot`, `don't`, `won't`, etc.) discouraged unless source absolutely requires it,
- chorus and final chorus must include the exact fixed hook phrase.

## 5. Structural constraints

The stable target contract is:
- one clear core message,
- one fixed hook phrase,
- chorus repetition by design,
- short memorable lines,
- verses should not merely restate each other,
- verses should include at least one concrete image or action,
- intro/outro stay short and refrain-like,
- at least one excerptable 15–30 second clip candidate should exist.

First-pass implementation priorities:
1. fixed hook phrase consistency,
2. chorus stability,
3. positive goal-state language,
4. shorter line bias,
5. stronger verse progression.

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
- no unsupported concrete historical claims,
- positive-language guard on final output,
- later strengthening may include:
  - syllable caps,
  - verse similarity rejection,
  - chorus token-delta threshold,
  - imagery heuristics,
  - clip-candidate scoring.

## 8. Integration note

`better compare` can wrap hymn-manuscript generation through clause-mode invocation to choose stronger hymn candidates.
The compare judge may use a richer virality / singability rubric, but the generator itself should already obey this structural contract before pairwise judging.
