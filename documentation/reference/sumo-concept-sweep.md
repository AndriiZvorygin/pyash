# SUMO concept sweep

## Goal

Link SUMO concepts that are not yet linked to Pyash vocabulary, and record the
relation that says *how* each concept relates to the Pyash entry it points at.

The sweep exists because SUMO is finer-grained than WordNet. WordNet gives a
language one "love"; SUMO gives it `Love`, `CompanionateLove`, and
`PassionateLove`. A Pyash entry for "love" is therefore a target for more than
one SUMO concept, and the link between them is not always equivalence. The
relation is the payload: it is what keeps SUMO's extra distinctions visible
after the concepts are folded onto shared Pyash entries.

## Sources

| Source | Identity | Role |
| --- | --- | --- |
| SUMO ontology | `ontologyportal/sumo` at `f0c126842d098a312e390479b38ecfbac018f8ed` | English term format, English definition, class hierarchy |
| SUMO/WordNet crosswalk | `know/sumo/pyash_wordnet_mappings.pya` (git-ignored, local) | SUMO concept universe, WordNet 3.0 mapping relation, sense crosswalk |
| Pyash reference snapshot | `program/library/dictionary/reference.pya` | which SUMO concepts are already linked, and to which Pyash entry |
| English30k | `know/sumo` sibling frequency resources | worklist ordering |

The ontology is a read-only external source. Its definitions are model evidence
for adjudication and are never copied into Pyash records. Links carry the source
identifier, the mapping relation, and provenance.

## Measured universe

Measured against `68806cb6b` with a locally rebuilt `reference.pya`:

- 12,714 distinct SUMO concepts (`sumo-concept` records in the crosswalk catalog).
- 3,932 concepts already linked to a Pyash entry through the WordNet crosswalk.
- 8,782 concepts with no Pyash link at all.

A concept that carries *some* link is not necessarily covered. The crosswalk
links a concept to the entry for the WordNet synset it names, and that synset is
often an odd synonym rather than the concept's own English word. SUMO `Love` is
linked to the entry for "filial love", `CompanionateLove` to "protectiveness",
and `PassionateLove` to "passionately". The concept's own meaning sits on
another entry.

The sweep therefore works on concepts that lack a link to the entry carrying
their own surface:

| Population | Concepts |
| --- | --- |
| Covered by a link to their own surface | 2,028 |
| Worklist | 10,686 |
| — of which no link at all | 8,782 |
| — of which linked only to a crosswalk artifact | 1,904 |

The worklist is what the sweep resolves, and it contains the love family.

Candidate reach, before adjudication:

| Evidence path | Concepts |
| --- | --- |
| Own surface matches exactly one Pyash entry | 726 |
| Own surface matches several Pyash entries | 737 |
| Nearest ancestor already linked `equivalent-to` | 3,514 |
| No sound path | 5,700 |

The gap between 3,514 and 648 matters. An ancestor linked `subsumed-by` or
`instance-of` proves only that the ancestor sits above the entry, so the
concept and the entry are incomparable and no subsumption claim follows. Only an
ancestor linked `equivalent-to` yields a sound claim: concept ⊑ ancestor ≡ entry.

A second filter separates the two kinds of hierarchy link. When the ancestor's
English surface is a word subsequence of the concept's own surface, the concept
is a kind of that ancestor's word ("companionate love" is a kind of "love").
That is a head-word match and the strongest available statement. When the
ancestor is only a class ancestor ("disseminating" is a kind of "communication"),
the link is class-only. Both are sound; they differ in how much they say.


## Link shape

New catalog `program/library/translation/sumo_concept_links.pya`, keyed by SUMO
concept, one row per accepted link.

```
su name sumo_concept_links be map def
su text "sumo-link:CompanionateLove" ob text "{...}" ya
```

The record carries the SUMO id, the English label, the Pyash sequence, the
relation, the evidence that produced it, and provenance. It does not carry a
SUMO definition.

Relations follow the convention already used by the derived source links: the
relation describes the **target relative to the SUMO concept**. `=` is
equivalence, `+` is subsumption, `@` is instance-of, and `:`, `[`, `]` are their
complements.

| Relation | Meaning | Source |
| --- | --- | --- |
| `equivalent-to` | target and concept denote the same thing | crosswalk `=`, or exact surface identity with no crosswalk |
| `subsumed-by` | target is a subtype of the concept | crosswalk `+` |
| `instance-of` | target is an instance of the concept | crosswalk `@` |
| `superclass-of` | target is a supertype of the concept | hierarchy path through an `equivalent-to` ancestor |

`superclass-of` is the one new relation value, and it is the one that carries
SUMO's extra granularity. `CompanionateLove` ⊑ `Love` ≡ the Pyash "love" entry,
so the link to that entry is `superclass-of`: the entry is broader than the
concept.

## Evidence paths

A concept is resolved by the first path that yields a sound answer.

1. **Own surface.** The concept's English surface matches a Pyash entry. A
   single match is deterministic. Several matches go to adjudication. The
   relation comes from the concept's WordNet mapping symbol when the chosen
   entry carries that crosswalk's sense, and is `equivalent-to` otherwise.
2. **Hierarchy.** The concept has no surface match, but an ancestor is linked
   `equivalent-to`. The relation is `superclass-of`, and the evidence records
   whether the match is a head-word match or a class-only match.
3. **Adjudication.** Neither path resolves the concept. The model receives the
   concept's definition and a bounded candidate set, and picks one supplied
   candidate or none.

Path 1 is preferred over path 2, because a surface match names the concept's
own meaning while the hierarchy only names a supertype. Path 2 is preferred
over path 3, because the hierarchy claim needs no model judgment at all.

The model never writes a relation. It chooses the target, and the relation
follows from the evidence: a target carrying the concept's unique crosswalk
sense takes that crosswalk's relation, and any other target takes
`equivalent-to` or `superclass-of`. SUMO definitions reach the model as
evidence and are never written into a Pyash record.


## Worklist

Ordered by the best English30k rank available for the concept, then by concept
id. The rank is taken from the concept's own surface, then from its crosswalk
lemmas, then from the surface of the entry its hierarchy path reaches.
Concepts with no rank keep a stable position at the end of the order.

A focused run is a list of concept ids in the refinery config, in the
`pilot-concept-ids` sentence. The pilot of 64 was stratified so every evidence
path and both adjudication outcomes were exercised before the backlog ran. An
empty list runs the whole backlog.

## Stages

The workflow graph lives in `program/library/translation/sumo_concept_refinery.pya`,
following the same shape as the WordNet sense compound refinery.

1. `select concepts` — build the worklist and the candidate evidence for each
   concept.
2. `resolve concept mapping` — deterministic resolution, plus one bounded
   Housekeeper mind call per ambiguous concept.
3. `verify concept mapping` — record decisions, promote accepted links, and
   refresh the mutable link coverage so accepted concepts leave later queues.

The stage names use vocabulary the repository already covers. The domain words
live in the file name, the config `format` value, and the record identifiers.

Durable state is `.pya` under `artifacts/<run-id>/`. The decision ledger is
append-only under stable row identities.

## Pilot result

The first pilot ran on `zvorygin` as run
`sumo-concept-sweep-d4544c7a891aff61b320a319`, 64 concepts selected and
processed.

| Outcome | Concepts |
| --- | --- |
| Promoted links | 47 |
| — `superclass-of` | 21 |
| — `equivalent-to` | 17 |
| — `subsumed-by` | 9 |
| Rejected by the model | 5 |
| No candidate | 11 |
| Uncertain | 1 |

The evidence paths were exercised in proportion: 21 hierarchy, 20 surface, 6
adjudicated. The model's rejections were sound — it refused the playing-card
"king" for SUMO `King`, the Brazilian currency for `BrazilianReal`, and the
monotheistic deity candidates for `God`.

The love family is the case the sweep exists for. `CompanionateLove` and
`PassionateLove` both link to the Pyash love entry as `superclass-of`, through
their ancestor `Love`, with a head-word affinity. WordNet gives the language
one "love"; the links now keep all three SUMO kinds of love.

No promoted record carries a SUMO definition. The definition is model input
only.

## Operations

The sweep runs on `zvorygin`, which needs two local-only inputs that are not in
the repository:

- `know/sumo/pyash_wordnet_mappings.pya` — the crosswalk catalog, git-ignored.
- `know/sumo/` checkout of the SUMO ontology at the pinned revision.

The sweep reads the same `reference.pya` snapshot the repository tracks, so the
already-linked set stays consistent with what the dictionary publishes.

See [the dev-vocab operations guide](../runbooks/dev-vocab-operations.md) for
branch, promotion, and commit procedure.
