## Place-World Agent System — Full Spec with MVP Markers

**Status:** draft v0.2
**Language:** Pyash-compatible conceptual specification

---

## 1. Purpose

Define a deterministic, place-based agent world where:

* agents act through **go, list, read, write, sleep**
* social awareness emerges from **shared directories and activity tails**
* tools are practiced as **situated capabilities**
* work is **episodic and bounded**
* learning arises from **review during sleep**
* execution remains **single-threaded and auditable**

This spec describes the **complete target system** and explicitly marks what is required for the **MVP**.

---

## 2. Core concepts

### 2.1 World

A directory-rooted social environment under `world/`.

### 2.2 Place

A context of being.
Agents in the same place share awareness through the place’s activity stream and artefacts.

### 2.3 Agent

An actor with continuity, a bedroom, roles, ingredients, and programs.

### 2.4 Presence

A derived fact computed from recent activity in a place, with expiry.

### 2.5 Activity

A chronological stream of facts emitted by world actions such as going, writing, completing duty, or producing tool results.

### 2.6 Artifact

A durable object written into a place or program.

### 2.7 Turn

A bounded window in which exactly one agent may act.

### 2.8 Tool

A capability associated with a place, invoked via tool calling and returning artifacts.

### 2.9 Program

A body of work, either personal or communal.

### 2.10 Conduct

Norms and constraints governing behaviour.

### 2.11 Itinerary

The scheduling authority that selects which agent acts next.

**MVP:** all concepts above.

---

## 3. World directory layout

Root: `world/` (workspace-relative unless an absolute path is configured by the world tool).

### 3.1 Places

Places are **top-level directories** under `world/` (no `world/places/` layer).

Canonical places:

* `commons`
* `library`
* `workplace`
* `church` (optional)
* `lookouts` (optional)
* `house` (agent homes)

Each place contains:

* an **activity stream**
* local **artifacts**
* optional pinned materials (conduct excerpts, open duty)

**MVP:** `commons`, `library`, `workplace`, `house`

Canonical filenames:

* activity stream: `.activity.pya`
* pinned conduct (optional): `conduct.pya`
* pinned duty (optional): `duty.pya`

---

### 3.2 Agents

`world/house/<agent>/`

Subspaces:

* `bedroom/` — sleep, review, reflection
* `ingredients/` — private materials, drafts, fragments
* `program/` — agent-private programs
* `roles/` — declared roles and constraints

**MVP:** `bedroom`, `ingredients`, `roles`

---

### 3.3 Programs (communal)

`world/workplace/<program>/`

Subspaces:

* `brief/`
* `duty/`
* `artifact/`
* `criterion/`
* `session/` or `gathering/`

Rule:

* solitary work → agent `program/`
* shared outcomes → world `program/`

**MVP:** one communal program with `brief`, `duty`, `artifact`

Canonical filenames:

* program brief: `brief/brief.pya`
* program duty: `duty/duty.pya`
* program criterion (optional): `criterion/criterion.pya`
* program session log (optional): `session/session.pya` or `gathering/gathering.pya`

---

### 3.4 Tools

Tools live under the place they belong to (e.g. `world/workplace/<program>/tools/`
or `world/library/tools/`).

Tools are discovered through place perception and invoked through tool calls.
Results always return as artifacts.

**MVP:** at least one tool in `library` and one in `workplace`

---

### 3.5 Conduct

`world/conduct/`

Subspaces:

* `social/`
* `tools/`
* `workplace/`

Conduct shapes interpretation and eligibility but does not require new verbs.

**MVP:** minimal social and tools conduct

---

### 3.6 Itinerary

`world/itinerary/`

Conceptually holds:

* current turn pointer
* eligibility queue
* rest and cooldown state

**MVP:** single turn pointer and queue

---

### 3.7 Archived

`world/archived/`

For retention and compaction.

**MVP:** optional

---

## 4. Agent verb surface (authoritative)

Agents MAY use only:

* **go** — choose a place
* **list** — perceive place entries and presence
* **read** — read artifacts or activity tails
* **write** — speak or leave artifacts
* **sleep** — enter bedroom rest state

All other facts are produced by the world as consequences.

**MVP:** all listed verbs

---

## 5. Place perception contract

### 5.1 `be list`

Returns:

* directory entries
* **presence snapshot** (derived)
* optional highlights

Presence is computed by the tool from recent activity.

**MVP:** entries + presence

---

### 5.2 Activity tail reading

Canonical idiom:

```
be read
  ob wo tail
  atmost num 10
  from filename ".activity.pya"
do
```

Semantics:

* returns the most recent activity facts
* bounded
* ordered
* omission count may be included

**MVP:** tail read at most 10

---

### 5.3 Presence derivation

Presence is derived from activity facts produced by:

* go
* sleep
* write
* duty completion

Expiry is enforced by itinerary policy. **Default MVP window:** last **30 minutes** or last **20 activity facts**, whichever is shorter (configurable).

**MVP:** derived presence with expiry

---

## 6. Activity facts (world-emitted)

The world emits **facts**, not tuples, not symbols.

Examples of fact meaning (conceptual, not syntax):

* agent went to place
* agent left place
* agent wrote artifact
* agent completed duty
* tool produced artifact

These are stored as normal Pyash sentences in the activity stream.

**MVP:** go, write, tool result, duty completion

---

## 7. Social interaction model

* Agents discover others via **presence**
* Recent context via **activity tail**
* Interaction occurs by **write** into the place
* Longer content always becomes an artifact

No direct addressing primitives exist; interpretation is semantic.

**MVP:** shared place conversation via write + tail read

---

## 8. Turn model and itinerary

### 8.1 Single-agent invariant

Exactly one agent acts per turn.

### 8.2 Turn shape

A turn consists of:

* optional go
* list (required)
* optional read
* optional write
* implicit yield

### 8.3 Eligibility

Itinerary selects agents based on:

* rest state
* open duty
* recent participation
* conduct constraints

**MVP:** one agent per turn, simple queue

---

## 9. Work and duty

### 9.1 Duty location

Duty lives under:

* place (coordination)
* program (deliverables)

### 9.2 Duty lifecycle

* discovered via list or tail
* acted upon during a turn
* completed by leaving an artifact
* completion is logged as activity

### 9.3 Boundedness

Work must terminate with:

* an artifact, or
* a written status explaining blockage

**MVP:** basic duty completion

---

## 10. Tools and practice

### 10.1 Tool discovery

Tools appear via place listing.

### 10.2 Tool use loop

1. agent lists place
2. agent writes intent
3. tool executes
4. tool produces artifact
5. agent writes interpretation

### 10.3 Discipline

* artifacts hold bulk output
* write remains short
* library artifacts include sources

**MVP:** one full tool loop

---

## 11. Sleep, review, learning

### 11.1 Sleep

Sleep moves the agent to bedroom and suspends eligibility.

### 11.2 Review

During sleep, the world requests:

* summary
* failures
* lessons
* next practice

### 11.3 Practice

Practice tasks are written to bedroom and optionally shared to workplace.

**MVP:** sleep + review artifact

---

## 12. Conduct norms (minimal)

* Commons: concise writing
* Library: factual clarity and sourcing
* Workplace: bounded change with outcome
* Tools: intent before use, interpretation after

Conduct is enforced by itinerary and review, not by syntax.

**MVP:** commons + library + workplace conduct

---

## 13. MVP checklist

Required:

* directory roots with renamed subspaces
* go / list / read / write / sleep
* presence via activity tail
* one communal program
* one tool per major place
* one review via sleep

Deferred:

* church
* lookouts
* archive compaction
* economy

---

If you want next steps, the cleanest options are:

* a **single canonical example day** written entirely as Pyash sentences
* a **directory tool contract** phrased as Pyash defaults and expectations
* a **conduct → review rubric** that defines “healthy agent behaviour” in evaluable terms
