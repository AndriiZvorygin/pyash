# 06. Data Formats

Purpose: define deterministic map/series and exchange formats (JSON, CSV, YAML, INI).

## 1. Normative value shapes

Supported core data shapes:
- map
- series (ordered list)
- scalar typed values

## 2. Deterministic map behavior

Rules:
- map writes must follow canonical ordering
- key collisions/overwrites follow explicit runtime semantics
- serialization and parse roundtrip must be stable for supported subset

## 3. JSON

- parse into canonical map/value model
- emit deterministic JSON from canonical model
- preserve numeric/bool/null semantics

## 4. CSV

- deterministic header key handling
- stable row/column mapping
- predictable validation errors for malformed rows

## 5. YAML

- supported subset mapped into canonical value model
- deterministic emission profile

## 6. INI (service profile)

INI mapping supports sectioned key/value conversion for service definitions (for example systemd-style unit/service/install blocks).

## 7. Errors

Each format family must expose stable, sentence-shaped parse/validation defects.

## 8. Conformance

Implementation conforms when supported format subset roundtrips deterministically through canonical map/value model.

## 9. Full draft reference

Detailed per-format rules are preserved at:
`documentation/recipes/spec-archive/06-data-formats.full.md`
