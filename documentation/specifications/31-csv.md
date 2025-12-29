# `31-csv.md`

**Status:** draft v0.1 (real-world inputs tranche)

## 1. Purpose

Define CSV interop for Pyash using **official, speakable** `def … prah` constructions (no literals), with **deterministic ordering** for parsing, iteration, and emission.

This spec defines:

* the CSV value model in Pyash
* parsing rules (v0.1 subset)
* emission rules (deterministic)
* ordering rules that avoid depending on general map enumeration

---

## 2. CSV value model (normative)

A parsed CSV is represented as a **Pyash csv map** that stores the table “sideways” (columns).

The CSV map has:

* `header raw` : `ve text`
  Original header cells as read from the file, in file order.
* `header` : `ve text`
  Official header keys used as Pyash switches, in the same order.
* one entry per official header key, where each value is a `ve text` column of equal length.

Official construction shape:

```pyash
su name <csv> be csv map def
  su name header raw ob ve text <h0> <h1> ... ya
  su name header     ob ve text <k0> <k1> ... ya

  su name <k0> ob ve text <c00> <c10> <c20> ... ya
  su name <k1> ob ve text <c01> <c11> <c21> ... ya
  ...
prah
```

### 2.1 Why both `header raw` and `header`

CSV headers are messy. `header raw` preserves what humans wrote so roundtrip output stays readable. `header` gives stable, speakable keys for access and tooling.

---

## 3. Official header key rules (normative)

Given a raw header cell text `h`, the official key `k` is produced by:

1. trim leading and trailing whitespace
2. collapse runs of whitespace to a single space
3. lowercase

Constraints:

* `k` must be non-empty
* official keys must be unique within the header

If any key is empty or duplicates occur after officialisation, raise `csv header defective`.

---

## 4. Parsing (v0.1 subset)

### 4.1 Inputs

Two entry forms via `read` with `from state csv`:

* `from filename <path> from state csv`
* `from text <csv text> from state csv`

### 4.2 Dialect

* delimiter: comma `,`
* quote: double quote `"`
* escaped quote inside quoted field: `""`
* newline: accept `\n` and `\r\n`
* first row is the header row (required in v0.1)

### 4.3 Row width rules

Let `H = len(header)`.

For each data row:

* if it has exactly `H` fields: ok
* if fewer than `H`: pad missing fields with empty text `""` until `H`
* if more than `H`: raise `csv row defective`

### 4.4 Empty fields

An empty field becomes `ob text ""` (empty string).

---

## 5. Deterministic ordering (normative)

This spec defines ordering using explicit vectors and construction order.

### 5.1 Column order

Column order is the order of keys in `<csv> ti header`.

### 5.2 Row order

Row order is the index order within each column vector: `0..R-1`.

### 5.3 Official construction order

When constructing the CSV map via `def … prah`, implementations MUST emit entries in this order:

1. `header raw`
2. `header`
3. each column entry in `header` order (`k0`, `k1`, …)

This makes the official `def` chain stable across interpreter, JS, and C outputs.

### 5.4 Deterministic row reconstruction

A row at index `i` is reconstructed by reading columns in `header` order:

* for each `k` in `<csv> ti header`:

  * `col = k of <csv>`
  * `cell = col[i]`

---

## 6. Emission (CSV write) (v0.1)

### 6.1 Header emission

Emit the header row from `header raw` when present. Otherwise emit from `header` verbatim.

### 6.2 Data emission

Let `R` be the length of the first column vector (or zero if there are no columns).

For `i` from `0` to `R-1`, emit one CSV row by reconstructing cells in `header` order.

### 6.3 Quoting rules

A field MUST be quoted if it contains:

* comma
* quote
* newline (`\n` or `\r`)

Inside quoted fields:

* `"` becomes `""`

---

## 7. Validation rules (normative)

### 7.1 Column length consistency

All column vectors MUST have the same length `R`.

If any column is missing or any column length differs, raise `csv columns defective`.

### 7.2 Header and columns alignment

For each key `k` in `header`, the CSV map MUST contain an entry `su name k ob ve text … ya`. Otherwise raise `csv columns defective`.

---

## 8. Errors (normative)

Errors are raised as standard error sentences. Stable error names:

* `csv lost` (file missing or unreadable)
* `csv defective` (general parse failure)
* `csv header defective` (invalid header or duplicate official keys)
* `csv row defective` (row has too many fields)
* `csv columns defective` (missing columns or mismatched lengths)

Recommended payload fields:

* `ob text <message>`
* row index and column index where available
* `from name interpret csv` for runtime parsing
* `from name compile csv` for compile-time expansion

Example shape:

```pyash
be error do
  su name csv header defective
  ob text "duplicate header key: total cad"
  from name interpret csv
prah
```

---

## 9. Minimal ceremonies (surface API) (v0.1)

Behaviour is normative, surface wording may vary.

### 9.1 Parse

* `from filename <path> to name <csv> be csv parse do`
* `from text <csv text> to name <csv> be csv parse do`

### 9.2 Header key helper (recommended)

* `ob text <raw> to name <key> be csv key do`

Returns the official key produced by §3, so tooling can explain key mapping.

### 9.3 Row view helper (optional, for later group-by work)

* `ob name <csv> ob num <i> to name <row> be csv row do`

Returns a row map constructed in header order, where each key maps to the cell text at index `i`.

---

## 10. Deterministic tests (recommended)

* parse determinism: same input yields identical official `def … prah` ordering and content
* roundtrip: parse → emit → parse preserves:

  * `header raw` text values
  * `header` official keys
  * all cell text values
  * column and row counts
* errors:

  * missing file triggers `csv lost`
  * duplicate official header triggers `csv header defective`
  * wide row triggers `csv row defective`
  * mismatched columns triggers `csv columns defective`
