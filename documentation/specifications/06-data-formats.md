# 06. Data Formats

Purpose: define deterministic map/series model and format exchange contracts.

## 1. Format keyword table

| Format | Meaning | Typical use |
| --- | --- | --- |
| map | keyed sentence/value object | configuration, structured facts |
| series | ordered sentence list | logs, pipelines, session lines |
| JSON | structured external interchange | APIs, canonical machine export |
| CSV | row/column tabular data | ledgers/imports/exports |
| YAML | human-readable structured config | config/spec inputs |
| INI | sectioned key/value profile | system service mappings |

## 2. Canonical conversion shapes

JSON to map:
```pyash
from filename "input.json" become wo map to name map json map be read do
```

Map to JSON:
```pyash
from name json map to filename "output.json" as wo json be write do
```

CSV to map:
```pyash
from filename "input.csv" become wo map to name map csv map be read do
```

## 3. Deterministic rules

- canonical map ordering on emit,
- explicit overwrite semantics,
- stable parse/emit roundtrip for supported subsets,
- sentence-shaped errors for malformed inputs.

## 4. INI service profile note

INI mapping supports system-service style sections (for example `unit`, `service`, `install`) and must roundtrip deterministically through map form.

## 5. Conformance

Implementation conforms when supported format subsets roundtrip deterministically through canonical map/series model.

## 6. Full draft reference

`documentation/recipes/spec-archive/06-data-formats.full.md`
