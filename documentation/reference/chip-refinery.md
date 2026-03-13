# Chip Refinery

This note explains the intended high-level refinery contract for semantic chipping in Pyash.

## Goal

Provide one general chipper that can chip many source kinds by declared target shape rather than by one hardcoded source-specific parser.

Target source kinds include:

- channeling sessions,
- meeting minutes,
- transcripts,
- documentation,
- legal forms,
- other long structured or semi-structured text.

## High-level contract

The intended public surface is:

`be chip from <source> ob text <chip style prompt> to series <chips> do`

Interpretation:

- `from <source>` provides the material to chip.
- `ob text <chip style prompt>` describes what the final wise chips should be.
- `to series <chips>` receives the resulting semantic chip series.

The chip-style prompt is the main hint. It tells the refinery what kind of chip it is trying to produce.

Examples of target shapes:

- "Create wise chips that each contain one full question and its corresponding answer."
- "Create wise chips that each correspond to one agenda item with its discussion."
- "Create wise chips that each capture one topical block suitable for chapter titles."
- "Create wise chips that each correspond to one clause or duty."

## Why `be chip` exists

The repo already has lower-level chip primitives:

- `be gross chip`
- `be wise chip`

Those are useful, but they are not the full adaptive refinery.

`be chip` is meant to be the higher-level contract that decides how to achieve the requested final chips.

It should not assume one source type or one segmentation strategy.

## Strategy model

`be chip` should decide the best course of action for the source and requested chip shape.

Preferred decision order:

1. `programmatic`
2. `boundary proposal`
3. `mixed`

### 1. Programmatic

Use this when the source structure is explicit and reliable enough to extract final chips deterministically.

Examples:

- clear question/answer markup,
- repeated agenda heading format,
- explicit section heading syntax,
- stable transcript speaker markers with consistent separators.

In this mode, the refinery should avoid unnecessary LLM passes.

### 2. Boundary proposal

Use this when the source structure is real but not trivial to extract deterministically.

Flow:

1. create gross chips
2. analyze representative gross-chip text
3. create a boundary-detection prompt aligned to the requested chip style
4. map boundary proposals across gross chips
5. resolve final wise chips from the full source

This is the current gross-chip to wise-chip refinery style.

### 3. Mixed

Use this when part of the structure is explicit but some semantic resolution still benefits from model guidance.

Examples:

- explicit headings exist, but final chips should merge heading blocks into larger semantic units,
- a source exposes likely Q/A markers, but answer spans need limited interpretation.

## Channeling Q/A example

For L/L Research style channeling pages, the desired chip style may be:

"Create wise chips where each chip contains one full question and its full corresponding answer. Some answers may be large. Preserve complete Q/A units."

The refinery should then decide:

- if a reliable programmatic Q/A extraction is possible, use it,
- otherwise use gross chips and an LLM-guided wise-chip boundary flow aimed at Q/A unit boundaries.

The main point is that the requested chip shape is "question and answer pairs," not "roughly equal size chunks."

## Relationship to existing verbs

- `be gross chip`: coarse partitioning primitive
- `be wise chip`: lower-level semantic resolution primitive
- `be chip`: adaptive semantic chip refinery

`be chip` may call:

- `be gross chip`
- `be wise chip`
- deterministic programmatic extraction
- later supporting helpers

But those are implementation details. The public contract stays centered on the requested chip style.

## Required refinery stages

A proper `be chip` implementation should record explicit stages.

Recommended minimum stages:

1. source load
2. source normalization
3. strategy analysis
4. gross chip stage when needed
5. chip production stage
6. final chip series write

If a verifier or retry stage is later added, it should validate that the emitted chips match the declared chip-style prompt.

## Output expectations

The final output is a series of semantic chips, not a debug dump of gross chips or boundary markers.

Each final chip should:

- reflect the requested chip style,
- preserve semantic completeness,
- remain auditable against the source,
- maintain deterministic order,
- be usable as direct downstream input for manuscript, hymn, chapter, summary, or review refineries.

## Design rule

Do not overfit the chipper to one source family.

When a source-specific programmatic extractor exists, treat it as one possible strategy chosen by `be chip`, not as the meaning of `be chip` itself.
