# `32-yaml.md`

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

Allowed JSON map contents are defined in `30-maps.md`. :contentReference[oaicite:9]{index=9}

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
