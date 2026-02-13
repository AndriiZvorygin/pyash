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

## 3. Mood table

| Mood | Meaning | Example |
| --- | --- | --- |
| `do` | execute | `ob num 1 by num 2 be plus do` |
| `ya` | surfaced fact/value | `su name total ob num 3 be plus ya` |
| `def ... prah` | definition block | `su name flow be refinery def ... prah` |
| `ko` | embedded clause boundary | `ob la ... ko` |

## 4. Canonical ordering and normalization

Rules:
- parser accepts valid flexible case order,
- emitter normalizes to canonical case ordering,
- quoted text stays opaque payload,
- compositional cases (`fromtext`, `fromstate`, `totext`, ...) are first-class grammar tokens.

## 5. Defaults and matching

Defaults may target clause patterns and fill missing cases only.

A default must not overwrite explicitly supplied call values.

## 6. Canonical usage examples

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

## 7. Error surface

Grammar defects surface sentence-shaped errors (`be error ya`), not raw parser strings.

Minimum defect classes:
- unknown keyword/case
- invalid mood placement
- malformed quote/clause
- invalid block boundaries

## 8. Conformance

Implementation conforms when it:
- parses and emits canonical sentence forms deterministically,
- preserves quoted payloads,
- normalizes case ordering,
- surfaces sentence-shaped errors.

## 9. Full draft reference

`documentation/recipes/spec-archive/01-sentence-and-grammar.full.md`
