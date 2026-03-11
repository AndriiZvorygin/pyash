# Chirp Refinery Profile

Status: redesign reference for the standalone `be chirp do` unit we want to stabilize next.

This document supersedes the older hook/value/question concept as the target shape for future chirp work. The existing example may still reflect the older shape until implementation catches up.

## 1. Purpose

`be chirp do` produces one short, source-grounded standalone social post.

The core goal is:
- compress one source into one useful idea,
- make the reader feel smarter, clearer, or more capable,
- preserve trust by avoiding unsupported claims,
- stay reusable over time instead of chasing platform gimmicks.

The target is not a reply pack, quote-post pack, or video summary. Those are downstream products for later, built from the same source atoms.

## 2. Canonical invocation

```pyash
su name chirp stage
  ob text "original source text"
  to name text chirp out
be chirp do
```

Source input modes:
- `ob text <source text>`
- `from name text <source text>`
- `from filename <source text file>`

Exactly one source mode should be present per run.

## 3. Output target

Final output:
- one standalone post,
- plain text only,
- no labels,
- no bullets,
- no markdown,
- no surrounding quotes.

Length target:
- 100-280 characters total, including spaces and line breaks.

The post does not need to end with a question.
A question is optional, not mandatory.

## 4. Core logic

The canonical chirp skeleton is:
- problem,
- hidden cause,
- insight.

This is the default cognitive arc because it:
- creates an information gap quickly,
- resolves that gap with a reframing or lever,
- stays useful longer than novelty-only formats.

In practical terms:
- line or clause 1 should name the visible pain, mistake, or false frame,
- line or clause 2 should reveal the hidden driver, constraint, or tradeoff,
- line or clause 3 should land the insight, rule, or action shift.

The exact punctuation and number of lines may vary.
The logical arc matters more than a rigid line count.

## 5. Source atoms

Before drafting, chirp should distill the source into five reusable atoms:
- `problem`
- `hidden cause`
- `insight`
- `proof hook`
- `boundary`

Definitions:
- `problem`: the visible pain, confusion, failure, or wrong frame
- `hidden cause`: the less obvious mechanism, constraint, or incentive
- `insight`: the upgraded frame, rule, or lever
- `proof hook`: one small supporting element such as a micro-example, tiny number, analogy, or vivid phrase
- `boundary`: a caveat, scope note, or limit that prevents overclaiming

For the standalone chirp unit, only the first three atoms are required in the final post.
`proof hook` and `boundary` are mainly support atoms for choosing stronger drafts and for future downstream outputs.

## 6. Template families

The default template set should stay small.

Allowed evergreen families:
1. `myth flip`
2. `symptom swap`
3. `definition pivot`
4. `hidden cost reveal`

Short definitions:
- `myth flip`: people think `X`, but really `Y`, so do/see `Z`
- `symptom swap`: the pain looks like `X`, but the constraint is `Y`, so pull lever `Z`
- `definition pivot`: `X` is the wrong label; the better frame is `Y`; that changes what to do
- `hidden cost reveal`: this looks beneficial, but the unseen cost is `Y`; use threshold/rule `Z`

These four are the stable core because they:
- age more slowly than hot takes,
- support useful compression,
- map well onto source-grounded verification,
- reduce wear-out risk compared with gimmick formats.

## 7. Template selection

Template selection should happen explicitly before final drafting.

Starter routing:
- use `definition pivot` when the source mainly corrects a label or frame
- use `symptom swap` when the source mainly explains a recurring pain through a hidden constraint
- use `hidden cost reveal` when the source mainly exposes a tradeoff or threshold
- use `myth flip` as the default fallback when the source mainly overturns a common belief

The selector should prefer:
- source fit,
- clarity,
- low overclaim risk,
- low repetition of stale phrasing.

## 8. Normative flow

1. resolve source text from the selected source mode
2. distill the source into `problem`, `hidden cause`, `insight`, `proof hook`, and `boundary`
3. choose one of the four evergreen template families
4. draft one standalone chirp from `problem + hidden cause + insight`
5. optionally weave in `proof hook` when it improves clarity or memorability without bloating the post
6. verify platform fit and total length
7. verify source thrust and no-overclaim behavior
8. retry only the failing drafting stage when needed
9. emit one final chirp text result
10. write the final result to `artifacts/<run id>/produce.txt`
11. when the source filename comes from `know/input/...`, runner also mirrors the final result to `know/produce/...`

## 9. Verification

The verifier should optimize for usable, trustworthy compression.

Pass when:
- the chirp is clear,
- the chirp fits the selected template well enough,
- the chirp preserves the source’s core meaning,
- the chirp sounds like something a person might actually post,
- the chirp stays within length bounds.

Fail when:
- it introduces unsupported concrete facts, actors, dates, statistics, policies, or mechanisms
- it bloats into a mini-thread
- it becomes too abstract to understand quickly
- it sounds templated, stale, or mechanically repetitive
- it loses the `problem -> hidden cause -> insight` arc unless the chosen template clearly supports an equivalent structure

Important verifier posture:
- be practical, not fussy
- allow rhetorical compression
- allow slight surprise and emphasis
- reject fabricated specificity

## 10. Retry scope

Retries should stay local.

Preferred retry boundaries:
- atom distillation stage
- template selection stage
- final chirp drafting stage

Do not rerun the whole refinery because one later stage draft is weak.

## 11. Anti-fatigue guidance

The long-run rule is:
- keep the skeleton,
- rotate the skin.

That means:
- vary hook type
- vary cause class
- vary proof style
- vary cadence and opener wording

Do not keep reusing the same opener family or cadence just because one version once worked.

## 12. Output contract

- `to name text <chirp out>` is required
- output is one final standalone post
- output is plain text only
- example runs also write `produce.txt` into the per-run artifact directory
- when invoked with a `know/input/...` source filename, runner additionally writes the final result under `know/produce/...` and adds `-02`, `-03`, ... on collisions
- intermediate refinery artifacts remain in `artifacts/<run id>/`; runner does not mirror them into `know/produce/`

## 13. Implementation note

The existing example [refinery-chirp-reply-run.pya](/workplace/examples/pyash/refinery-chirp-reply-run.pya) still follows the older hook/value/question structure.

That example should be treated as an implementation waypoint, not the final target specification.
