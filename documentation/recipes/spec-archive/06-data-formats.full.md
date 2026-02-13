# `06-data-formats.md` (merged)

Merged specification file. Original sources:
- `30-maps.md`
- `31-csv.md`
- `32-yaml.md`
- `33-json.md`
- `34-ini.md`

---

## `30-maps.md`

**Status:** v0.2 (determinism locked)

## 1. Purpose

Define **pyash map values** in Pyash.

A **pyash map** is a general container used by the runtime. Entries are **full Pyash sentences** keyed by their `su` switch.

This specification defines syntax, semantics, access rules, official write ordering, dynamic updates, and error behaviour for pyash maps.

JSON maps (`be json map def`) are specified in `06-data-formats.md`.

---

## 2. Terms

* **map**: a container of entries indexed by switch.
* **pyash map**: declared with `be map def … prah`.
* **entry**: a `ya` sentence inside a map definition block.
* **switch**: the entry subject (`su name …`), used as a map key.
* **entry sentence**: the full `ya` sentence stored as the value for a switch.

---

## 3. Syntax

Inline map literals are unsupported. `def … prah` is the official map form.

### 3.1 Pyash map definition

```
su name <M> be map def
  <entry>...
prah
```

### 3.2 Entry form (pyash map)

A pyash map entry is any `ya` sentence inside the definition block that contains a subject:

```
su name <switch> … ya
```

Rules:

* Each entry MUST contain `su name <switch>`.
* If a sentence lacks `su`, raise `pyash map sentence lost su`.
* The `<switch>` values MUST be unique within the block.
* Entries MAY contain any other roles (including `ob`, or no `ob`).

---

## 4. Semantics (normative)

### 4.1 Map creation

`be map def … prah` produces a **pyash map value** stored under `<M>`.

**Storage note:** the map definition block is compiled into a single stored **map sentence** (`mood: "ya"`, `be: "map"`, `ob.map = { switch -> entry }`). Header cases on the `be map def` sentence (e.g., `as`, `from`, `to`, `with`, `at`, `by`, `during`, `accordingto`, `become`) are preserved by copying them onto the stored map sentence. The original header sentence is not stored separately unless explicitly defined elsewhere.

### 4.2 Entry aggregation

Inside a map definition block, each entry contributes one association:

* `switch = entry.su`
* `value = entry` (the full entry sentence object)

### 4.3 Excess switches

If a switch appears more than once, this is an error.

Stable error name: `pyash map switch excess`.

### 4.4 Access (genitives)

Map access uses standard genitive rules:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

Access resolves to the stored **entry sentence object**.

To obtain a payload from that entry sentence, use standard role access, for example:

* `ob of <entry>`

### 4.5 Lost switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

---

## 5. Official `write` ordering (normative)

Pyash maps have no required enumeration order at runtime.

When writing a pyash map in `def … prah` form, implementations SHALL emit entries in **official JSON key order** (RFC 8785) using the switch text as the sort key.

This rule exists to keep config files and other pyash maps diff-friendly, even though runtime enumeration order remains unspecified.

---

## 6. Dynamic map updates (normative)

`be plus` updates a **pyash map** entry whose key is the update sentence’s `su` value.

Example:

```
su text of ob of this ob num 1 to name wordmap be plus do
```

Rules:

* `to name <map>` must resolve to a pyash map.
* `switch` is the value of the update sentence’s `su`.
* The target entry sentence’s numeric counter is stored in `ob num …`.

Update behaviour:

* If no entry exists for `switch`, treat the current value as `0`.
* If an entry exists and its `ob` is `num <old>`, the new value is `<old> + <delta>`.
* After update, the entry sentence stored for `switch` SHALL have `ob num <new>` (other roles MAY be preserved).

Errors:

* If an existing entry sentence for `switch` lacks `ob num …`, raise `pyash map plus defective`.

---

## 7. Errors (normative)

Errors are thrown as `be error do` sentences.

Stable error names:

* `pyash map sentence lost su`
* `pyash map switch excess`
* `pyash map plus defective`

Errors are raised only for structural violations.

---

## 8. Tests that define truth

* `quiz/pyash_map_core.test.mjs` (if present or to be added)
* `quiz/pyash_map_write_order.test.mjs` (if present or to be added)
* `quiz/pyash_map_add.test.mjs` (if present or to be added)

Notes:

* JSON map tests live under `06-data-formats.md` and remain unchanged:

  * `quiz/json_map_export.test.mjs`
  * `quiz/import_json_map.test.mjs`
  * `quiz/compile_json_to_pyash.test.mjs`
  * `quiz/json_map_enumeration.test.mjs`

---

## Series (ordered lists)

**Status:** v0.1 (draft)

Pyash **series** values are ordered lists of full sentences. They are used when
order matters and keys are optional, for example to carry a session history.

### Syntax

```
su name <S> be series def
  <entry>...
prah
```

### Entry form

Each entry is a full `ya` sentence. Series entries:

* preserve order
* MAY repeat or omit `su`
* MAY omit `ob`

Unlike maps, series entries are not keyed; order is the only index.

### Semantics (normative)

`be series def … prah` produces a **series value** stored under `<S>`:

* `be: "series"`
* `ob.series`: array of the entry sentence objects, in order

Series are opaque containers; verbs that consume them (for example mind history
in `08-tools-and-mcp.md`) define how to interpret their entries.


---

## `31-csv.md`

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


---

## `32-yaml.md`

**Status:** draft v0.1 (real-world inputs tranche)

## 1. Purpose

Define YAML interop for Pyash with strong compatibility for configuration YAML, including `docker-compose.yml`.

YAML is mapped into the existing JSON-map pipeline for code reuse and cross-runtime parity:
- YAML mappings become `be json map def … prah`
- YAML sequences become vectors (`ve`)
- YAML scalars become `text | num | bool | hollow`

Docker Compose explicitly supports YAML anchors and aliases (“fragments”), so this spec supports them. :contentReference[oaicite:4]{index=4}

---

## 2. Terms

- **YAML document**: one YAML top-level value.
- **JSON map**: a constrained map form whose contents represent a JSON value tree. :contentReference[oaicite:5]{index=5}
- **vector**: Pyash vector value (`ve`), used to represent YAML sequences and JSON arrays. :contentReference[oaicite:6]{index=6}
- **hollow**: null value. :contentReference[oaicite:7]{index=7}
- **unspecified**: runtime absence (outside the JSON value set). :contentReference[oaicite:8]{index=8}
- **anchor / alias**: YAML mechanisms for reusing a node in multiple places.

---

## 3. YAML value model (normative)

### 3.1 Target representation

A YAML document loads into Pyash as a JSON value tree:

- YAML mapping → `be json map def … prah`
- YAML sequence → vector (`ve … be vector`)
- YAML scalar → one of:
  - string → `ob text "…"`
  - number → `ob num …`
  - boolean → `ob bool truth|lie`
  - null → `ob hollow`

Allowed JSON map contents are defined in `06-data-formats.md`. :contentReference[oaicite:9]{index=9}

### 3.2 Root constraints (v0.1)

The YAML document root MUST be a mapping.
- If the root is a sequence or scalar, raise `yaml root defective`.

This matches common configuration shapes, including docker compose.

---

## 4. Parsing (v0.1)

### 4.1 Inputs (official)

Entry forms use `read` with `from state yaml`, mirroring CSV. :contentReference[oaicite:10]{index=10}

- `from filename <path> from state yaml to name <out> be read do`
- `from text <yaml> from state yaml to name <out> be read do`

Result:
- `<out>` resolves to a JSON map value.

### 4.2 Supported YAML features (v0.1)

Supported:
- mappings
- sequences
- scalars
- comments (ignored)
- anchors and aliases (resolved, see §4.6) :contentReference[oaicite:11]{index=11}

Optional support (recommended):
- merge key `<<` (see §4.7)

Excluded in v0.1 (raise `yaml defective`):
- explicit tags and custom schemas
- multi-document streams
- mapping keys that are sequences or mappings

### 4.3 Mapping key rules (compat-first)

YAML mapping keys are accepted when the key is a scalar.

Accepted key scalar kinds:
- string
- number
- boolean
- null

Key coercion:
- keys are coerced to **text** for JSON map switches, using this function `keyText(s)`:
  - if `s` classifies as null → `"null"`
  - if `s` classifies as boolean → `"true"` or `"false"`
  - if `s` classifies as JSON-number → the original scalar text (trimmed) as written
  - otherwise → the scalar text as written (after YAML escape processing)

Implementation note: parsers MUST preserve access to the original scalar token text for keys
and scalars. If a library only returns typed numbers/booleans, the implementation should
capture the raw token during parse or reconstruct from the original source slice to ensure
deterministic key text and scalar classification.

If the coerced key text is empty, raise `yaml key defective`.

Duplicate keys:
- later value takes priority (last write wins), consistent with map behaviour. :contentReference[oaicite:12]{index=12}

### 4.4 Scalar classification (deterministic)

Goal: preserve YAML compatibility while keeping cross-runtime determinism.

Rule:
- parser libraries may produce typed scalars or plain strings
- Pyash applies its own deterministic classification to the scalar text

Classification order:
1. null tokens (case-insensitive): `null`, `~`, empty value → `hollow`
2. booleans (case-insensitive): `true`, `false` → `bool`
3. JSON-number grammar → `num`
4. otherwise → `text`

This aligns with YAML 1.2’s JSON-compat direction and avoids schema drift between libraries. :contentReference[oaicite:13]{index=13}

### 4.5 Sequences

- YAML sequences map to vectors.
- Element order is sequence order.
- Each element is converted recursively using these same rules.

Arrays of objects may use the vector referential pattern described for JSON loading. :contentReference[oaicite:14]{index=14}

### 4.6 Anchors and aliases

Anchors and aliases are supported for docker compose compatibility. :contentReference[oaicite:15]{index=15}

Semantics:
- aliases are resolved during parse into the anchored value tree, before JSON-map/vector emission
- Pyash treats values as value-semantic: an alias expands as a deep copy of the anchored subtree
- recursive alias cycles raise `yaml referential defective`

Emission:
- anchors and aliases are not preserved in v0.1 output; output is a normalized expanded YAML tree

### 4.7 Merge key `<<` (recommended support)

If a mapping contains the key `<<`:
- its value MUST be a mapping, or a sequence of mappings
- merged mappings are applied in sequence order
- then the mapping’s explicit keys are applied
- last write wins for collisions, consistent with map rules :contentReference[oaicite:16]{index=16}

If merge value shape fails, raise `yaml defective`.

---

## 5. Deterministic construction order (normative)

When producing the official `be json map def … prah` chain:

- entries MUST be emitted in official JSON key order (RFC 8785) :contentReference[oaicite:17]{index=17}
- nested maps follow the same rule
- sequences emit elements in index order

This yields stable `def … prah` chains across interpreter, compiled JS, and compiled C.

---

## 6. Emission (YAML write) (v0.1)

### 6.1 State

Define one output state:

- `to state yaml`
  - human-readable YAML emission
  - semantic stability is expected
  - byte stability is outside scope
  - emitter may choose quoting and whitespace

### 6.2 Emission rules

Given a JSON map or vector value:

- JSON maps emit as YAML mappings
- vectors emit as YAML sequences
- scalars emit:
  - `hollow` → `null`
  - `bool truth|lie` → `true` or `false`
  - `num` → JSON number text
  - `text` → quoted or plain, emitter choice

Key order:
- mapping keys emit in RFC 8785 order. :contentReference[oaicite:18]{index=18}

Anchors, aliases, comments:
- v0.1 emitter produces an expanded normalized tree (no anchors, aliases, comments)

---

## 7. Errors (normative)

Errors are thrown as standard error sentences.

Stable error names:
- `yaml lost` (file missing or unreadable)
- `yaml defective` (general parse failure or excluded feature)
- `yaml root defective` (root fails §3.2)
- `yaml key defective` (key fails §4.3)
- `yaml scalar defective` (scalar fails classification constraints)
- `yaml referential defective` (alias cycle or invalid merge reference)

Recommended payload fields:
- `ob text <message>`
- line and column where available
- `from name interpret yaml` for runtime parsing
- `from name compile yaml` for compile-time expansion

---

## 8. Official IO shapes (surface API)

### 8.1 Read

- `from filename <path> from state yaml to name <out> be read do`
- `from text <yaml> from state yaml to name <out> be read do`

### 8.2 Write

- `ob name <map> to state yaml to name <out> be write do`
- `ob name <map> to state yaml to filename <path> be write do`

---

## 9. Implementation checklist (informative)

JS (Node):
- use `yaml` library with a YAML 1.2 core-style schema setting
- preserve access to scalar text for classification (or configure parse so scalar values remain strings where possible)
- implement anchor and merge handling at the node layer
- convert into JSON map + vectors using the rules above

C:
- use `libyaml` event stream
- build node graph with anchors, resolve aliases, detect cycles
- apply scalar classification rules to scalar text
- apply merge key behaviour
- produce official `be json map def … prah` chain using RFC 8785 ordering

---

## 10. Deterministic tests (recommended)

- determinism: same input yields identical official `def … prah` ordering and content
- compose compatibility: parse common docker-compose.yml patterns including anchors and extension fields :contentReference[oaicite:19]{index=19}
- roundtrip semantics: parse → emit (`to state yaml`) → parse preserves the JSON value tree
- errors:
  - missing file triggers `yaml lost`
  - non-mapping root triggers `yaml root defective`
  - complex key triggers `yaml key defective`
  - alias cycle triggers `yaml referential defective`


---

## `33-json.md`

**Status:** v0.2 (determinism locked)

## 1. Purpose

Define **JSON map values** in Pyash.

A **JSON map** is a constrained map form whose contents represent a **JSON value tree** and can be exported as **official JSON**.

This specification defines JSON map syntax, semantics, access rules, enumeration, arrays, nesting, JSON loading, and JSON export behaviour.

Pyash maps (`be map def`) are specified in `06-data-formats.md`.

---

## 2. Terms

* **json map**: declared with `be json map def … prah`.
* **entry**: a `ya` sentence inside a JSON map definition block.
* **switch**: the entry subject (`su name …`), used as a JSON object key.
* **contents**: the entry payload (`ob …`), used as the JSON value.
* **json value**: one of string, number, boolean, null, object, array.
* **vector**: a sequence container created with `ve` (`ob ve … be vector`), used to represent JSON array values.
* **official JSON**: JSON text output following RFC 8785 key ordering rules.

---

## 3. Syntax (normative)

Inline map literals are unsupported. `def … prah` is the official JSON map form.

### 3.1 JSON map definition

```
su name <M> be json map def
  <entry>...
prah
```

### 3.2 Entry form (json map)

A JSON map entry is a `ya` sentence inside the definition block with both `su` and `ob`:

```
su name <switch> ob <contents> ya
```

Rules:

* Each entry MUST contain `su name <switch>`.
* Each entry MUST contain `ob <contents>`.
* If a sentence lacks `su`, raise `json map sentence lost su`.
* If a sentence lacks `ob`, raise `json map sentence lost ob`.

Notes:

* Switches derive from `su`.
* Contents derive from `ob`.

---

## 4. JSON map meaning (normative)

### 4.1 Map creation

`be json map def … prah` produces a **json map value** stored under `<M>`.

### 4.2 Entry aggregation

Inside a JSON map definition block, each entry contributes one association:

* `switch = entry.su`
* `contents = entry.ob`

### 4.3 Excess switches

If the same switch appears more than once:

* The later entry takes priority (last write wins).
* A warning may be emitted.

This situation is permitted and does not raise an error.

### 4.4 Access (genitives)

JSON map access uses standard genitive rules:

* possessive: `<map> ti <switch>`
* genitive: `<switch> of <map>`

Access resolves to the associated **contents**.

### 4.5 Lost switches

If a switch is absent:

* Access resolves to `unspecified`.
* No error is raised.

---

## 5. Enumeration (normative)

Enumeration is defined only for JSON maps.

The `all` switch yields vectors as follows:

* `all su of <map>`
  → vector of switches (keys)

* `all ob of <map>`
  → vector of contents (values), aligned with `all su`

* `all of <map>`
  → vector of entries, each entry a 2-item vector
  `[<switch>, <contents>]`

Surface form:

* `all su of <map>`, `all ob of <map>`, and `all of <map>` are the official forms.
* Implementations MAY also accept fully explicit equivalents using `su name all` / `ob name all` where grammar requires disambiguation.

Ordering:

* Enumeration order SHALL follow **official JSON key order** (RFC 8785).

Result types:

* `all su of <map>` returns `ve text`.
* `all ob of <map>` returns a vector whose elements are JSON values (heterogeneous).
* `all of <map>` returns a vector of 2-item vectors, where each inner vector is `[switch, contents]`.

`unspecified` omission:

* If an entry’s contents are `unspecified`, that entry is omitted from enumeration results (`all su`, `all ob`, and `all`).

Errors:

* Applying `all` (or `all su` / `all ob`) to a non-JSON map raises `json map enumeration defective` as an exception.

---

## 6. JSON value model (normative)

A JSON map represents a JSON object stored under the map sentence’s `ob`.

Switches become JSON object keys. Contents become JSON values.

### 6.1 Switch constraints

* Switches originate from `su name <switch>`.
* Switches must be representable as JSON object keys.

### 6.2 Contents constraints

Allowed contents:

* string: `ob text "…"`
* number: `ob num …`
* boolean: `ob bool truth|lie`
* null: `ob hollow`
* object nesting: `ob name <json-map>`
* array: vector values (§6.3)

`unspecified` may appear during access or building, and exports via omission rules (§6.5).

If contents fall outside allowed contents, raise `json map contents defective`.

### 6.3 Arrays via vectors (normative)

JSON arrays are represented using Pyash vectors (`ve`).

**A) Scalar arrays**

Vectors whose element type is JSON-scalar-like export as JSON arrays:

* `ve num …`
* `ve text …`
* `ve bool …`

**B) Arrays of objects (vector referential)**

```
ob ve name <a> <b> <c> be vector
```

Rules:

* Each name must resolve to a `be json map`.
* Each referenced map exports as a JSON object.
* Any non-map reference raises `json map referential defective`.

### 6.4 Nested objects (map referential)

```
su name <switch> ob name <json-map> ya
```

Rules:

* The referenced name must resolve to a previously-defined JSON map.
* During export, the referenced map expands inline.

### 6.5 `unspecified` and `hollow`

* `hollow` exports as JSON `null`.
* `ve hollow` exports as `[]`.
* `unspecified` indicates absence.

During JSON export:

* Entries whose contents are `unspecified` are omitted.

This preserves:

* `hollow` → present → `null`
* `unspecified` → absent → omitted

---

## 7. Loading JSON as JSON maps (normative)

When JSON is loaded into Pyash:

* JSON objects load as `be json map`.
* JSON arrays load as vectors (`ve`).

For arrays of objects:

* The loader MAY generate a vector referential by assigning generated names to each object.

Generated names must avoid collisions; numeric suffixes are appended if needed.

---

## 8. Exporting JSON (normative)

JSON export is official by default.

### 8.1 Official JSON (RFC 8785)

* to text:

  ```
  ob name <map> to state json to name <out> be write do
  ```
* to file:

  ```
  ob name <map> to state json to filename <path> be write do
  ```

Official JSON is byte-stable and suitable for hashing, signing, again, and goldens.

### 8.2 Human-readable JSON

Human-readable output requires an explicit state:

* to text:

  ```
  ob name <map> to state beautiful json to name <out> be write do
  ```
* to file:

  ```
  ob name <map> to state beautiful json to filename <path> be write do
  ```

Pretty JSON has no byte-stability guarantee.

### 8.3 Default `write`

```
ob name <map> be write do
```

Prints the `be json map def … prah` chain, rather than JSON text.

---

## 9. Errors (normative)

Errors are thrown as `be error do` sentences.

Stable error names:

* `json map sentence lost su`
* `json map sentence lost ob`
* `json map contents defective`
* `json map referential defective`
* `json map export self referential`
* `json map enumeration defective`

Errors are raised only for structural violations.

---

## 10. Tests that define truth

* `quiz/json_map_export.test.mjs`
* `quiz/import_json_map.test.mjs`
* `quiz/compile_json_to_pyash.test.mjs`
* `quiz/json_map_enumeration.test.mjs`


---

## `34-ini.md`

**Status:** draft v0.1 (service-focused)

## 1. Purpose

Define INI interop for Pyash using canonical map representation.

Primary target in v0.1:

* system service blocks (`[Unit]`, `[Service]`, `[Install]`)

INI support is map-first:

* INI text -> canonical map
* canonical map -> INI text

This keeps conversion deterministic and aligns with existing json/yaml/csv map flows.

---

## 2. Canonical map keys (service profile)

For service blocks, implementations SHOULD use these keys:

* `unit_after`
* `unit_wants`
* `service_type`
* `service_exec_start`
* `service_restart`
* `install_wanted_by`

---

## 3. Service sentence equivalence

Convenience sentence:

```pyash
su name my service since name network-online.target fromperson name network-online.target as text "simple" ob filename "/usr/local/bin/my-service" for name multi-user.target onto text "on-failure" be service ya
```

Canonical map:

```pyash
su name my service be json map def
su name unit_after ob text "network-online.target" ya
su name unit_wants ob text "network-online.target" ya
su name service_type ob text "simple" ya
su name service_exec_start ob text "/usr/local/bin/my-service" ya
su name service_restart ob text "on-failure" ya
su name install_wanted_by ob text "multi-user.target" ya
prah
```

Equivalent INI:

```ini
[Unit]
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/my-service
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## 4. Normative mapping

* `since name` <-> `[Unit] After=`
* `fromperson name` <-> `[Unit] Wants=`
* `as text` <-> `[Service] Type=`
* `ob filename` <-> `[Service] ExecStart=`
* `onto text` <-> `[Service] Restart=`
* `for name` <-> `[Install] WantedBy=`

---

## 5. Determinism and scope

v0.1 scope:

* parse and emit simple key/value INI lines for the service profile above
* ignore comments and blank lines during parse
* preserve semantic fields through INI <-> map <-> sentence round-trip

Out of scope for v0.1:

* arbitrary INI dialect features beyond the service profile
* duplicate key policy beyond last-write-wins mapping
