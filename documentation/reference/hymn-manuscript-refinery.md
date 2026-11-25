# Hymn Manuscript Refinery Profile

Status: reference profile for module-level `be hymn manuscript do` behavior in `module/hymn_manuscript.pya`.

## 1. Purpose

`be hymn manuscript do` builds a short educational spiritual song from source text by composing:
- a fixed hook phrase,
- verse one,
- verse two,
- verse three,
- a chorus,
- a bridge,
- a second chorus that escalates the first,
- a short outro.

The song follows the shape of the Yiniana reference song: verse-first, three
verses, one chorus, a bridge, a second chorus that returns with a deepened
echo, and an outro that carries the crux. There is no intro — the sheet opens on
the first verse.

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
2. generate one fixed hook phrase (`4..8` words),
3. generate verse one with concrete imagery and a distinct opening role,
4. generate the chorus echo line and assemble hook / echo / hook,
5. deterministically verify the chorus contains the exact hook phrase,
6. generate verse two with a distinct supported aspect and concrete imagery,
7. generate verse three with a third distinct supported aspect,
8. generate bridge with a source-grounded turn or resolution,
9. generate the final chorus echo line — a new line that escalates the first chorus echo — and assemble hook / echo / hook,
10. deterministically verify the final chorus contains the exact hook phrase,
11. verify the final chorus keeps the refrain identity while deepening the echo,
12. generate short outro whose first line turns the hook and whose second line carries the crux,
13. assemble final hymn,
14. deterministically verify total hook recurrence in the final hymn,
15. verify communal experiential voice,
16. verify source-thrust against source text,
17. verify positive-language / negation constraint,
18. return final manuscript text.

## 4. Prompt contract

The module maintains separate prompt facts for:
- hook phrase,
- verse one,
- verse two,
- verse three,
- chorus,
- final chorus,
- bridge,
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
- communal experiential voice preferred over command voice,
- prefer we / our / us or shared witness over direct listener instruction,
- negative phrasing (`not`, `never`, `cannot`, `don't`, `won't`, etc.) discouraged unless source absolutely requires it,
- chorus and final chorus must include the exact fixed hook phrase.

## 5. Structural constraints

The stable target contract is:
- one clear core message,
- one fixed hook phrase,
- hook phrase repeated between three and six times in the finished hymn,
- the second chorus is written, not copied: the echo line escalates,
- short memorable lines,
- verses should not merely restate each other,
- verses should include at least one concrete image or action,
- the lyric should sound like shared experience rather than directives,
- the outro stays short and crux-like rather than farewell-like,
- at least one excerptable 15–30 second clip candidate should exist.

First-pass implementation priorities:
1. fixed hook phrase consistency,
2. chorus refrain identity,
3. hook recurrence,
4. shorter line bias,
5. stronger verse progression and imagery.

## 6. Output contract

- output target is `to name text manuscript out`,
- final output is plain text with section labels:
  - `[verse 1]`
  - `[verse 2]`
  - `[verse 3]`
  - `[chorus]`
  - `[bridge]`
  - `[chorus]`
  - `[outro]`,
- the chorus is three lines: hook, echo, hook,
- the second chorus is three lines: hook, a new escalated echo, hook,
- the outro is two lines: the hook turned by one word, then the crux.

## 7. Verification contract

Deterministic and verifier checks should enforce:
- bounded word count per section,
- bounded line count per section,
- hook phrase present where required,
- total hook recurrence in the final hymn,
- no unsupported concrete source-teaching claims,
- concrete imagery in verses,
- final-chorus refrain identity against the main chorus, while allowing the
  echo line to differ,
- communal experiential voice across the finished hymn,
- positive-language / negation guard on final output,
- later strengthening may include:
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

## 9. Integration note

`better compare` can wrap hymn-manuscript generation through clause-mode invocation to choose stronger hymn candidates.
The compare judge may use a richer virality / singability rubric, but the generator itself should already obey this structural contract before pairwise judging.
