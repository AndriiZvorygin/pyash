# Learning Distillation Refinery Profile

Status: draft reference profile for teaching-focused source distillation via `be learn do`.

## 1. Purpose

`be learn do` distills source material into a reusable teaching artifact.

The goal is not summary for its own sake. The goal is to extract:
- the central teaching seed,
- the main orthogonal features of that teaching,
- the concrete affairs or activities it calls for,
- the causative and consequence structure of those activities,
- the cardinal scenes and idioms that carry the teaching,
- and brief memory phrases that can later support hooks, choruses, captions, or teaching lines.

This refinery should be source-first, teaching-first, and reusable by downstream generators such as hymn manuscript, teaching video, or compare judges.

## 2. Canonical signature

Primary filename-source form:

```pyash
su name lesson from filename source ob text learning focus to name teaching lesson be ceremony def
```

Canonical invocation shape:

```pyash
su name lesson from filename "know/input/source.txt" ob text "armor of light" to name teaching lesson be learn do
```

Interpretation:
- `from filename` supplies the source text,
- `ob text` supplies the learning focus,
- `to name teaching ...` receives the distilled teaching artifact,
- `be learn do` performs the distillation.

Recommended alias direction later, if needed:
- `to name course ...`
- `to name teaching ...`

But the first implementation should keep one canonical output contract and avoid alias drift.

## 3. Meaning of learning focus

`learning focus` is a lens, not a freeform generation prompt.

It should be:
- short,
- source-relevant,
- and centered on a teaching theme, practice, image, or question.

Examples:
- `armor of light`
- `humility`
- `forgiveness`
- `daily discipline`
- `inner silence`

Rules:
- the focus may narrow attention,
- but it must not authorize unsupported claims,
- and it must not force the refinery away from the actual source.

If the requested focus is only partly supported:
- the refinery may narrow to the nearest supported teaching lane,
- but should stay explicit and faithful.

If the requested focus is absent or materially unsupported:
- the refinery should fail clearly rather than hallucinate a teaching.

Suggested failure shape:
- `learning focus unsupported by source`

## 4. Output contract

The result should be one plain-text structured teaching block with these required headings, in this order:

```text
SEED CONCEPT

CARDINAL TRAINING SENTENCE

ORTHOGONAL FEATURES

AFFAIRS OR ACTIVITIES

CAUSATIVE AND CONSEQUENCE

CARDINAL SCENES AND IDIOMS

BRIEF MEMORY PHRASES
```

The meanings are:

### `SEED CONCEPT`

The single most important insight in the source, under the requested focus.

Rules:
- exactly one short paragraph or one to two sentences,
- central, not decorative,
- understandable in plain language,
- should name the teaching clearly rather than merely gesture at mood.

### `CARDINAL TRAINING SENTENCE`

One plain sentence stating the core training, discipline, or practice.

Rules:
- exactly one sentence,
- understandable by a 12-year-old,
- actionable or observable when possible,
- should sound like something a listener could remember and restate.

### `ORTHOGONAL FEATURES`

Three to five clear statements of what should be understood about the teaching.

Rules:
- each item should add a distinct feature,
- items should not merely paraphrase one another,
- avoid decorative uplift or duplicate claims,
- each line should be short and direct.

### `AFFAIRS OR ACTIVITIES`

Two to five concrete things a person does, cultivates, notices, or practices.

Rules:
- prefer observable activity over vague aspiration,
- include inward practices when the source is inward, but name them concretely,
- do not invent activities absent from the source.

### `CAUSATIVE AND CONSEQUENCE`

Two to five explicit practice-to-result relationships.

Rules:
- each line should clearly show cause and consequence,
- prefer `practice -> result` or equivalent concise relation,
- results must stay faithful to the source teaching.

### `CARDINAL SCENES AND IDIOMS`

Two to six central images, symbols, metaphors, or idiomatic source expressions.

Rules:
- keep only source-central imagery,
- exclude flashy but incidental details,
- include repeated or structurally important images before rare ones.

### `BRIEF MEMORY PHRASES`

Four to ten very short phrases that capture the teaching.

Rules:
- each phrase should be 2 to 8 words,
- source-faithful and memorable,
- suitable as teaching anchors, hook seeds, chorus seeds, or captions,
- avoid generic filler language.

## 5. Prompt contract

The generator prompt should enforce:
- source-first distillation,
- focus relevance,
- plain language,
- no decorative summary padding,
- no unsupported doctrinal expansion,
- no metadata, greetings, speaker labels, or transcript junk,
- no canned uplift wording unless the source truly carries it.

The generator should be told:
- prefer teaching clarity over broad summary,
- prefer practices and consequences over mood description,
- prefer the source's own symbolic world over generic spirituality,
- prefer phrasing a learner could restate after one reading.

## 6. Structural constraints

The distillation should obey:
- all required headings must exist,
- headings must appear in fixed order,
- no empty sections,
- no duplicate section items,
- `ORTHOGONAL FEATURES` must have `3..5` items,
- `AFFAIRS OR ACTIVITIES` must have `2..5` items,
- `CAUSATIVE AND CONSEQUENCE` must have `2..5` items,
- `CARDINAL SCENES AND IDIOMS` must have `2..6` items,
- `BRIEF MEMORY PHRASES` must have `4..10` items,
- each brief memory phrase must be `2..8` words,
- `CARDINAL TRAINING SENTENCE` must be exactly one sentence.

## 7. Verification contract

Deterministic checks should verify:
- required headings exist,
- heading order is correct,
- required list counts are satisfied,
- memory phrase length bounds are satisfied,
- sections are non-empty,
- duplicate list lines are rejected.

LLM verification should judge:
- source fidelity,
- focus relevance,
- clarity of teaching,
- non-generic wording,
- whether activities and consequences are actually supported,
- whether the seed concept and training sentence match the real center of the source.

The verifier should reject:
- unsupported teachings,
- invented practices,
- decorative metaphors treated as central when the source does not support them,
- vague inspiration with no clear teaching,
- distillations that ignore the requested focus when the focus is in fact supported.

## 8. Downstream use

This output is meant to feed later generators.

Recommended downstream mapping:
- `SEED CONCEPT` -> chorus teaching target
- `CARDINAL TRAINING SENTENCE` -> clear teaching line / child-level restatement
- `ORTHOGONAL FEATURES` -> verse teaching support
- `AFFAIRS OR ACTIVITIES` -> practice lines
- `CAUSATIVE AND CONSEQUENCE` -> bridge and consequence logic
- `CARDINAL SCENES AND IDIOMS` -> image system for lyrics, thumbnails, and video prompts
- `BRIEF MEMORY PHRASES` -> hook pool seeds, refrain candidates, caption seeds

## 9. Non-goals

This refinery should not:
- write finished lyrics,
- write finished prose scripts,
- compare multiple source interpretations,
- optimize for virality directly,
- invent modernized teachings that are not in the source.

Its job is disciplined teaching extraction, not final creative packaging.
