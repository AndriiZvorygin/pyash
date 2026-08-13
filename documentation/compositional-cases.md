# Compositional case system

Pyash models a compositional case as an axis in a context:

> `source | way | destination` × context

The canonical contract is [`program/library/compositionalCases.mjs`](../program/library/compositionalCases.mjs). It owns the context order, axis order, 12×3 keyword grid, lexicon identities, parser keyword maps, formatter order, and reverse indexes.

## Canonical grid

The contexts are ordered as follows:

`space`, `interior`, `surface`, `under`, `time`, `state`, `person`, `social`, `discourse`, `quantity`, `limit`, `sequence`.

The axes are ordered `source`, `way`, `destination`. Their 36 keyword mappings are:

| Context | Source | Way | Destination |
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

Every cell parses in the form `from|via|to <context> num N`; `via` selects the `way` axis. The parser stores the resulting canonical keyword (`during`, `times`, `fromindex`, and so on), and signature derivation uses that keyword with the `num` type.

## HNUC and lexicon status

Assigned cells select a trailing-underscore grammatical lexeme from `program/library/pyashWords.json`. The validator requires exact agreement for its `case`, `hnuc`, and `pya` fields. `hnuc` must be an assigned 16-bit hexadecimal identity; `0x0000` is never valid.

The following eight axis cells are intentionally unassigned and are represented by `status: "unassigned"` with `case`, `hnuc`, and `pya` set to `null`:

| Context | Unassigned cells |
| --- | --- |
| `quantity` | `way`, `destination` |
| `limit` | `source`, `way`, `destination` |
| `sequence` | `source`, `way`, `destination` |

The context identities for `quantity`, `limit`, and `sequence` are also not allocated yet. These eleven known unassigned identities are deterministic warnings, not successful fabricated mappings. Authoritative HNUC allocation and lexicon additions remain a later bounded tranche.

## Reverse lookup

`compositionalByHnuc` maps a lowercase HNUC to an array of mappings. A grammatical morpheme may be reused: for example, `0x313E` / `source_case_` occurs in the `space`, `person`, `social`, and `discourse` source cells, while `0x495F` / `perlative_case_` occurs in the `interior`, `surface`, and `under` way cells.

The array is intentional. A HNUC identifies the grammatical morpheme, but a reused morpheme cannot uniquely recover the context. Reuse is accepted only when all mappings identify the same lexicon morpheme; conflicting lexicon identities are validation errors.

## Validation and operator workflow

`program/library/compositional_case_validation.mjs` is a pure host-side validator. It accepts injected grid and lexicon inputs for deterministic defect tests and returns `{ ok, errors, warnings, summary }`. Its report lines have stable `SEVERITY CODE context.axis: explanation` form.

The vocabulary-valid built-in sentence is:

```pyash
be verify hnuc grammar do
```

It returns deterministic counts and the known unassigned list on success. If a contract or lexicon defect is found, it raises the sentence-shaped `hnuc grammar defective` error with the readable report. The runnable example is [`examples/pyash/verify-hnuc-grammar.pya`](../examples/pyash/verify-hnuc-grammar.pya).

Conformance requires the canonical grid to cover all 12 contexts and all three axes, every cell keyword to parse and derive signatures deterministically, and the validator to reject missing/invalid mappings, malformed or zero HNUCs, absent lexemes, and lexicon mismatches. This is a parser/signature guard; it does not allocate missing HNUCs or alter `pyashWords.json`.
