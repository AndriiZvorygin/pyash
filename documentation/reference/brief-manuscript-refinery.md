# Brief Manuscript Refinery Profile

Status: reference profile for module-level `be brief manuscript do` behavior in `module/brief_manuscript.pya`.

## 1. Purpose

`be brief manuscript do` builds a short spoken manuscript for video-first workflows by composing:
- fact segment one,
- fact segment two,
- uplifting close,
- final hook line.

## 2. Exported signatures

Text source form:

```pyash
su name brief manuscript from text manuscript to name text manuscript out be ceremony def
```

Filename source form:

```pyash
su name brief manuscript from filename manuscript to name text manuscript out be ceremony def
```

The filename form reads source text first, then delegates to text-source form.

## 3. Stage shape

Current module stage sequence:
1. source resolve from input text,
2. generate fact one from source, then verify word count (`20..34`) and sentence completeness,
3. generate fact two from `fact one + source`, then verify word count (`20..34`) and sentence completeness,
4. generate uplifting close from `fact one + fact two + source`, then verify word count (`24..33`) and sentence completeness,
5. compose manuscript body,
6. generate hook from manuscript body, then verify word count (`6..9`) and sentence completeness,
7. assemble final manuscript as `hook + blank line + body`,
8. verify final manuscript total word count (`70..110`), fail deterministically if out-of-bounds,
9. verify source-thrust against transcript with a reviewer mind; reviewer output must include:
   - one short reasoning paragraph,
   - final line exactly `PASS` or `FAIL`.

Stage behavior details:
- fact one/fact two/uplift/hook generation now routes through `verify loop` (generator + verifier loop) before deterministic word-count guard checks.
- sentence-complete guard uses `be verify as wo sentence complete`; if a line is complete but missing terminal punctuation, it is auto-normalized by appending `.`.
- total manuscript check also retries once by rewriting body text under bounded decode.

## 4. Prompt contract

The module maintains separate prompt facts for:
- fact one,
- fact two,
- uplift,
- hook.

Each stage prompt requests plain prose output with no markdown/bullets/labels.
The source-thrust verifier prompt requires reasoning plus a terminal verdict line (`PASS`/`FAIL`).

## 5. Output contract

- output target is `to name text manuscript out`.
- final output is plain text manuscript suitable for downstream title/description/telling/draw stages.
- stage-level verify guards enforce bounded lengths before returning.

## 6. Integration note

`module/brief_video.pya` uses this module as a reusable manuscript generator.
`be better compare do` can wrap brief-manuscript generation through clause-mode invocation for iterative candidate improvement.
