# Verify Count Modes

Status: reference profile for `be verify as wo word count`, `be verify as wo letter count`, and `be verify as wo sentence complete`.

## 1. Purpose

`verify` supports deterministic text guards through:
- `word count`,
- `letter count`.
- `sentence complete`.

All modes produce deterministic `map` output suitable for refinery retry gates.

## 2. Canonical forms

Word count:

```pyash
be verify as wo word count atleast num 8 atmost num 12 ob text "source text" to name map report do
```

Letter count:

```pyash
be verify as wo letter count atleast num 100 atmost num 180 ob text "source text" to name map report do
```

Sentence complete:

```pyash
be verify as wo sentence complete ob text "Families lost homes to debt traps" to name map report do
```

## 3. Source inputs

All modes accept:
- `ob text <literal>`,
- `from filename <file>`,
- `from name <fact name>` where remembered fact resolves to `ob text` or `ob filename`.

## 4. Bounds contract

- `word count` and `letter count` use inclusive `atleast num` / `atmost num` bounds.
- `sentence complete` does not use bounds.

## 5. Mode rules

Word count:
- token count from whitespace splitting (`\\S+` matching).

Letter count:
- Unicode code-point count from full source text,
- includes spaces and line breaks.

Sentence complete:
- deterministic heuristic,
- fails on empty text,
- fails on trailing continuation punctuation (`:`, `;`, `,`),
- fails on trailing connector endings (`and`, `or`, `but`, `so`, `because`, `if`, `when`, `while`, `than`, `that`, `which`, `who`, `whom`, `whose`, `a`, `an`, `the`),
- passes complete lines without terminal punctuation and returns `fixed` with a trailing period appended.

## 6. Output contract

Output is a `map`.

Count modes include:
- `pass` (`truth`/`lie`),
- metric field (`words` or `letters`),
- `atleast`,
- `atmost`,
- `source`,
- `mode`.

Sentence-complete mode includes:
- `pass` (`truth`/`lie`),
- `words`,
- `source`,
- `mode`,
- `reason`,
- `terminal`,
- `continuation`,
- `connector`,
- `fixed`.

Example result map:

```pyash
su name report be map ya
```

With map keys equivalent to:
- `pass`,
- `words` or `letters`,
- `atleast`,
- `atmost`,
- `source`,
- `mode`.
