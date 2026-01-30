## `be search` — web search (v0.1 draft)

### 1. Purpose

Provide a web-search signature family for `be search` that stays disjoint from filesystem text search.

### 2. Signature routing

A `be search` invocation belongs to the **web search** family when it contains:

* `fromstate wo web`

A `be search` invocation belongs to the **filesystem** family when it contains:

* `in filename "<path>"`

Implementations should treat these as disjoint families.

### 3. Canonical invocation forms

#### 3.1 Explicit search motor

```
su name <found>
ob text "<question>"
fromstate wo web
from filename "<search-engine-url>"
by num <limit>
be search do
```

#### 3.2 Default search motor

```
su name <found>
ob text "<question>"
fromstate wo web
by num <limit>
be search do
```

### 4. Default motor fact (recommended)

When `from filename "<search-engine-url>"` is omitted, the runtime resolves the motor from memory using:

```
su name web search motor
ob filename "<search-engine-url>"
be default ya
```

If resolution fails, the runtime surfaces an error.

### 5. Output value model (recommended)

Return value: a **Pyash map** whose entries are **full sentences**, one per search found.

Top-level map:

```
su name <found> be map def
  su name metadata
    ob text "<question>"
    fromstate wo web
    from filename "<search-engine-url>"
    via name <motor-id>
    by num <limit>
  ya

  <found-entry>...
prah
```

### 6. Per-result entry sentence (official fields)

Each found entry is one sentence stored as a map entry. Recommended fields:

| Field     | Case                    | Required | Meaning                                                   |
| --------- | ----------------------- | -------: | --------------------------------------------------------- |
| entry key | `su name <entry-key>`   |      Yes | Map key for this found entry                              |
| rank      | `by num <rank>`         |      Yes | Deterministic ranking index (policy: 1-based recommended) |
| URL       | `from filename "<url>"` |      Yes | Canonical target URL                                      |
| name      | `ob text "<name>"`      | Optional | Result title                                              |
| abstract  | `as text "<abstract>"`  | Optional | Result summary/extract                                    |
| motor id  | `via name <motor-id>`   | Optional | Stable engine label (example: `searxng`)                  |
| branch    | `from state <branch>`   | Optional | Example: `web`, `news`, `images`                          |

Example entry:

```
su name found 000001
by num 1
from filename "https://example.com/a"
ob text "Title here"
as text "Abstract here"
via name searxng
ya
```

### 7. Determinism rules

* Rank establishes primary ordering.
* When emitting the map in `def … prah` form, entries are written using official map key ordering (switch text order), so choose entry keys that preserve rank, e.g. `found 000001`, `found 000002`, …

### 8. Errors (stable names suggested)

Surface errors as `be error ya`. Recommended stable names:

* `web search question lost` (missing `ob text "<question>"`)
* `web search motor lost` (neither explicit motor nor default motor)
* `web search defective` (network failure, invalid response, policy failure)

### 9. Engine adapter note (v0.1)

Wire format for the motor response is implementation-defined in v0.1. Each motor requires an adapter that normalises its native payload into the per-result entry fields above.
