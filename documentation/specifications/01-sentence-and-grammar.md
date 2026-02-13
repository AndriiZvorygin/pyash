# 01. Sentence And Grammar

Purpose: define canonical sentence shape, case meaning, and parse/emit invariants.

## 1. Canonical sentence skeleton

```pyash
su name <subject> <cases...> be <verb> <mood>
```

## 2. Core keyword meanings

| Keyword | Meaning | How to apply |
| --- | --- | --- |
| `su` | sentence subject | identity of the sentence/fact/action |
| `ob` | primary object/payload | main value or command body |
| `from*` | source axis | where data/input/context comes from |
| `to*` | destination axis | where output/result is stored/sent |
| `for` | target actor/consumer | who should receive/perform work |
| `with` | companion/tool binding | attached helper/tool set |
| `as` | mode/typing qualifier | execution/read/write mode marker |
| `become` | conversion target | output state/format transformation |
| `during` | temporal bound | duration/validity window |
| `since` | start timestamp | provenance/start of validity |
| `vyah` | aspect/tense/outcome modifiers | lifecycle/time/stance overlay |
| `be` | predicate verb | action or fact predicate |

## 3. Compositional case table (axis x context)

Compositional cases are built from `axis x context` and emitted as single keywords.

| Context | Source axis | Way axis | Destination axis |
| --- | --- | --- | --- |
| `space` | `from` | `at` | `to` |
| `interior` | `outof` | `in` | `into` |
| `surface` | `offof` | `on` | `onto` |
| `under` | `fromunder` | `under` | `beneath` |
| `time` | `since` | `during` | `until` |
| `state` | `fromstate` | `as` | `become` |
| `person` | `fromperson` | `with` | `for` |
| `social` | `fromgroup` | `among` | `intogroup` |
| `discourse` | `fromtext` | `accordingto` | `totext` |
| `quantity` | `times` | `by` | `per` |
| `limit` | `atleast` | `exactly` | `atmost` |
| `sequence` | `fromindex` | `atindex` | `toindex` |

Alias notes:
- `inside` aliases to `in`
- `along` aliases to `on`

Common non-compositional/high-frequency cases:
- `su`, `ob`, `be`, `vyah`, `under`

## 4. Common case meaning table

| Case | Meaning | Example |
| --- | --- | --- |
| `su` | sentence subject | `su name plan` |
| `ob` | primary object/payload | `ob text "hello"` |
| `from` | generic source relation | `from filename "in.txt"` |
| `to` | generic destination relation | `to filename "out.txt"` |
| `fromtext` | discourse/text source | `fromtext text "prompt body"` |
| `totext` | discourse/text destination | `totext text "summary"` |
| `fromstate` | source-state qualifier | `fromstate wo web` |
| `for` | target actor/recipient | `for name helper` |
| `with` | companion/tool binding | `with name saddle tools` |
| `under` | policy/conduct context | `under name review loop configure` |
| `as` | way/state qualifier | `as wo web` |
| `become` | destination-state transform | `become wo markdown` |
| `at` | location/cwd context | `at filename "/workplace"` |
| `during` | active interval/window | `during date today` |
| `since` | start/provenance timestamp | `since date 2026-02-13` |
| `accordingto` | correlation/provenance id | `accordingto text "run-01"` |
| `by` | quantity/rate/step slot | `by num 5` |
| `atmost` | upper limit constraint | `atmost num 262144` |
| `until` | deadline/end bound | `until date "2026-02-14T00:00:00.000Z"` |
| `vyah` | aspect/tense/outcome modifiers | `vyah iterative` |
| `be` | predicate verb | `be interpret do` |

## 5. Mood table

| Mood | Meaning | Example |
| --- | --- | --- |
| `do` | execute | `ob num 1 by num 2 be plus do` |
| `ya` | surfaced fact/value | `su name total ob num 3 be plus ya` |
| `def ... prah` | definition block | `su name flow be refinery def ... prah` |
| `ko` | embedded clause boundary | `ob la ... ko` |

## 6. Canonical ordering and normalization

Rules:
- parser accepts valid flexible case order,
- emitter normalizes to canonical case ordering,
- quoted text stays opaque payload,
- compositional cases (`fromtext`, `fromstate`, `totext`, ...) are first-class grammar tokens.

## 7. Defaults and matching

Defaults may target clause patterns and fill missing cases only.

A default must not overwrite explicitly supplied call values.

## 8. Canonical usage examples

Basic fact:
```pyash
su name project ob text "pyash" be text ya
```

Execution with source and destination:
```pyash
ob text "hello" from filename "in.txt" to filename "out.txt" be write do
```

Clause payload:
```pyash
exists su name policy ob la be command fromstate text "safe" ko be default ya
```

## 9. Error surface

Grammar defects surface sentence-shaped errors (`be error ya`), not raw parser strings.

Minimum defect classes:
- unknown keyword/case
- invalid mood placement
- malformed quote/clause
- invalid block boundaries

## 10. Conformance

Implementation conforms when it:
- parses and emits canonical sentence forms deterministically,
- preserves quoted payloads,
- normalizes case ordering,
- surfaces sentence-shaped errors.
- keeps the common-case table in this chapter updated when new high-frequency signatures/cases are introduced.

## 11. Full draft reference

`documentation/recipes/spec-archive/01-sentence-and-grammar.full.md`
