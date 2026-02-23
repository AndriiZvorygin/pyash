# Verify Count Modes

Status: reference profile for `be verify as wo word count` and `be verify as wo letter count`.

## 1. Purpose

`verify` supports bounded text-length checks through count modes:
- `word count`,
- `letter count`.

Both modes produce deterministic `map` output suitable for refinery retry gates.

## 2. Canonical forms

Word count:

```pyash
be verify as wo word count atleast num 8 atmost num 12 ob text "source text" to name map report do
```

Letter count:

```pyash
be verify as wo letter count atleast num 100 atmost num 180 ob text "source text" to name map report do
```

## 3. Source inputs

Both modes accept:
- `ob text <literal>`,
- `from filename <file>`,
- `from name <fact name>` where remembered fact resolves to `ob text` or `ob filename`.

## 4. Bounds contract

- `atleast num` and `atmost num` define inclusive bounds.
- Runtime currently accepts signatures where both are present.
- If both are present, `atleast` must not exceed `atmost`.

## 5. Counting rules

Word count:
- token count from whitespace splitting (`\\S+` matching).

Letter count:
- Unicode code-point count from full source text,
- includes spaces and line breaks.

## 6. Output contract

Output is a `map` with:
- `pass` (`truth`/`lie`),
- metric field (`words` or `letters`),
- `atleast`,
- `atmost`,
- `source`,
- `mode`.

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
