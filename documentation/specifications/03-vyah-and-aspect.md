# 03. Vyah And Aspect

Purpose: define `vyah` modifiers (aspect, tense, outcome, attitudinal) and their canonical emission rules.

## 1. Scope

`vyah` attaches lifecycle/time/state modifiers to a sentence without changing the base verb.

It is used for:
- execution/lifecycle control (`start`, `await`, `cancel`, ...)
- scheduling/recurrence (`schedule`, `habit`, `poll`)
- temporal anchoring (`past`, `future`, `today`, ...)
- run outcomes and stance markers (`success`, `fail`, ...)

## 2. Runtime source of truth

The implemented inventories are defined in:
- `program/library/grammar/keywords.mjs`

This spec must stay aligned with:
- `VYAH_ASPECT_MODIFIERS`
- `VYAH_ASPECT_ALIASES`
- `VYAH_TENSE_MODIFIERS`
- `VYAH_OUTCOME_MODIFIERS`
- `VYAH_ATTITUDINAL_MODIFIERS`

## 3. Aspect inventory (implemented)

Canonical aspect words currently accepted:

| Grammatical aspect name | Word | Purpose |
| --- | --- | --- |
| Perfective | `eval` | Execute as a bounded unit and return a value. |
| Progressive | `start` | Start work and return running handle/state. |
| Imperfective | `stream` | Return ongoing chunks/updates. |
| Retrospective | `await` | Wait for completion/result of started work. |
| Completive | `finish` | Finalize/flush and complete cleanly. |
| Cessative | `cancel` | Stop/abort ongoing work. |
| Delimitative | `timebox` | Run with explicit time boundary. |
| Delimitative (alias form) | `dweh` | Alternate token for timebox-like bounded run. |
| Prospective | `schedule` | Mark work to occur in planned future execution. |
| Habitual | `habit` | Mark recurring/customary execution pattern. |
| Frequentative | `poll` | Mark repeated probe/check behavior. |
| Inchoative | `init` | Enter/start service or state. |
| Continuative | `status` | Report ongoing/current state snapshot. |
| Gnomic | `rule` | Mark invariant/lawlike rule semantics. |
| Semelfactive | `emit` | Single-shot event/chunk emission. |
| Momentane | `step` | Single atomic step in a larger process. |

Alias normalization:
- `cron` parses as alias and must emit canonically as `habit`.

## 4. Tense inventory (implemented)

Canonical tense words currently accepted:

| Grammatical tense/time reference | Word | Purpose |
| --- | --- | --- |
| Present reference | `now` | Anchor meaning to current moment. |
| Past reference | `past` | Anchor meaning to prior time. |
| Future reference | `future` | Anchor meaning to later time. |
| Same-day reference | `today` | Anchor meaning to current day window. |
| Prior-day reference | `yesterday` | Anchor meaning to previous day window. |
| Near-past reference | `recent` | Mark near-past relevance. |
| Distant-past reference | `long_ago` | Mark far-past relevance. |
| Near-future reference | `soon` | Mark near-future intent. |
| Distant-future reference | `far_future` | Mark far-future intent. |
| Next-day reference | `tomorrow` | Anchor meaning to next day window. |

## 5. Outcome and attitudinal inventory (implemented)

Outcome modifiers:

| Outcome class | Word | Purpose |
| --- | --- | --- |
| Positive completion | `success` | Mark successful result/completion. |
| Negative completion | `fail` | Mark failed result/completion. |

Attitudinal modifiers:

| Attitudinal class | Word | Purpose |
| --- | --- | --- |
| Satisfaction | `satisfied` | Mark satisfied stance. |
| Positive stance | `success` | Mark favorable/positive stance. |
| Negative stance | `fail` | Mark unfavorable/negative stance. |
| Epistemic positive | `hope` | Mark hopeful expectation. |
| Epistemic uncertainty | `doubt` | Mark uncertainty/skepticism. |
| Threat stance | `fear` | Mark concern/fear. |
| Affinity | `love` | Mark strong positive affinity. |
| Adversarial affect | `anger` | Mark hostile/frustrated stance. |
| Exploratory stance | `curious` | Mark curiosity. |
| High-energy positive | `enthusiasm` | Mark energetic positive stance. |
| Low-reactive composure | `patience` | Mark waiting/composed stance. |
| Investigative awe | `wonder` | Mark wonder/inquiry stance. |
| Negative affect | `despair` | Mark severe negative outlook. |
| Achievement stance | `pride` | Mark pride/ownership stance. |
| Balanced composure | `equanimity` | Mark neutral steady stance. |
| Reflective sadness | `melancholy` | Mark subdued sadness. |
| Positive affect | `joy` | Mark joy/happiness stance. |
| Self-critical affect | `shame` | Mark shame/regret stance. |
| Surprise | `surprise` | Mark unexpectedness stance. |

## 6. Canonical rules

1. Aspect orthogonality:
- verb chooses action family,
- `vyah` chooses lifecycle/time/stance modifiers.

2. Aspect count:
- at most one aspect modifier per sentence.
- multiple aspect modifiers are invalid.

3. Canonical emission:
- aliases parse, but emitted form must use canonical token (`cron` -> `habit`).

4. Determinism:
- given same base sentence + same `vyah` list, runtime must emit identical normalized `vyah` output.

5. Recurrence guidance:
- for periodic calendar scheduling, use `per` with units (`second`, `minute`, `hour`, `day`);
  use `vyah habit` to mark habitual behavior semantics when needed.

## 7. Canonical examples

Single aspect:
```pyash
su name intake vyah poll be status do
```

Aspect + tense:
```pyash
su name scheduler vyah status now be health do
```

Alias normalization (`cron` -> `habit`):
```pyash
su name matrix probe vyah cron be schedule do
```

Outcome/attitudinal marker:
```pyash
su name run result vyah success be text ya
```

Temporal reminder style:
```pyash
su name reminder vyah future tomorrow be memory ya
```

## 8. Conformance

Implementation conforms when it:
- parses implemented `vyah` inventories from runtime keywords,
- enforces at-most-one-aspect rule,
- emits normalized canonical aspect tokens,
- preserves `vyah` facts in surfaced sentences and recording paths where enabled.

## 9. Extended reference

Long-form rationale and historical tables are preserved at:
`documentation/recipes/spec-archive/03-vyah-and-aspect.full.md`
