# Instead Replacement Profile

Status: reference profile for proposed map-driven replacement verb `be instead do`.

## 1. Purpose

`be instead do` provides deterministic, allowlist-only text replacement using a caller-provided map.

Primary use case:
- module-local prompt packet assembly without hidden JS templating logic,
- speakable replacement contracts where keys/values are explicit Pyash facts.

## 2. Canonical forms

Literal source:

```pyash
be instead ob name replacement map in text "Hook: [[hook]]\nValue: [[value]]" to name text packet do
```

Remembered source text:

```pyash
be instead ob name replacement map in name text packet template to name text packet do
```

Optional shorthand form (same output semantics as other text-producing verbs):

```pyash
be instead ob name replacement map in name text packet template do
```

## 3. Replacement map shape

Map entries are explicit key/value text pairs:

```pyash
su name replacement map be map def
su text "[[hook]]" ob text "Debt was cancelled." ya
su text "[[value]]" ob text "Land caps restored ownership." ya
```

Notes:
- keys are literal match strings (no regex mode),
- keys may include symbols/brackets/whitespace,
- empty-string key is invalid.

## 4. Deterministic replacement rules

- input source resolves from `in text` or `in name text`,
- replacement keys are applied in map declaration order,
- each key replacement is global literal replacement within current text,
- replacement is single-pass by key order (no recursive re-expansion loop),
- keys not present in source are ignored.

## 5. Output contract

- output is `text`,
- if `to name text <target>` is present, store final text there,
- if `to` is omitted, output behaves like other text-producing imperative verbs (result attached to stage/subject fact).

## 6. Error contract

Suggested deterministic defects:
- `instead defective: requires replacement map`,
- `instead defective: replacement map invalid`,
- `instead defective: empty replacement key`.

## 7. Scope boundary

This profile is replacement-only. It does not define:
- conditional logic,
- looping expansion,
- regex capture groups,
- template-expression evaluation.
