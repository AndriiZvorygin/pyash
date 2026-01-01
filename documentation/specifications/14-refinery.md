# `14-refinery.md` (v0.1)

**Status:** v0.1

---

## 1. Purpose

Define refinery execution: a runner-controlled way to execute a set of named platforms with explicit depend lists, using normal Pyash sentences as the activity for each platform.

This spec exists to make multi-step runs:

deterministic across interpreter / JS / C

verifiable to run again when again mode is enabled

compatible with duties, streams, chips, exchange, artifacts, and run newspaper


This spec defines:

- refinery declaration form
- platform declaration form
- depend rules and deterministic scheduling
- failure policy
- interaction with run newspaper and again mode



---

## 2. Terms

refinery — a named collection of platform declarations executed by a runner

platform — one named unit of refinery work

activity — the sentence (embedded in la … ko) that the runner evaluates for a platform

depend — a platform name that MUST complete before another platform may start

already platform — a platform whose depend list is complete

again mode — runner policy that requires recording and verification sufficient to run again (see 13-exchange-and-artifact.md)



---

## 3. Global invariants (normative)

1. Deterministic scheduling
For the same refinery definition and inputs, the order of platform execution MUST be deterministic.


2. No hidden semantics
The runner MUST NOT rewrite platform activities. Activities are evaluated as normal Pyash sentences.


3. Definition does not execute activities
A refinery definition is declarative: activities inside ob la … ko are not executed at definition time. They are executed only when the runner runs the refinery.


4. Newspaper is optional
If run newspaper emission is disabled, refinery evaluation results MUST be the same; only recording changes.


5. Again mode is stricter
In again mode, refinery execution MUST satisfy the recording and verification rules in 11-run-newspaper.md and 13-exchange-and-artifact.md.




---

## 4. Reserved verbs (normative)

The words refinery and platform are reserved for refinery declarations and MUST NOT dispatch as ordinary ceremonies.

be refinery def … prah is a declaration form.

be platform ya is a declaration entry form inside a refinery.


If an implementation supports user-defined ceremonies named refinery or platform, that support MUST be gated off while parsing refinery blocks (the declaration meaning wins inside the refinery).


---

## 5. Refinery declaration (official)

A refinery is declared using a def / prah block.

### 5.1 Form

A refinery is declared as:

su name <refinery> be refinery def

followed by one or more platform declarations

ending with prah


The refinery name <refinery> is a su name identifier.

### 5.2 Multiple refineries

A file MAY declare more than one refinery. Selecting which refinery to run is a runner policy (outside this spec).


---

## 6. Platform declaration (official)

Each platform is declared by a single sentence inside the refinery block.

### 6.1 Platform sentence form

A platform declaration is a sentence with:

su name <platform> (required)

from ve name <dep0> <dep1> ... (optional depend list)

ob la <activity sentence> ko (required activity)

be platform ya


Rules:

<platform> is the platform name (unique within the refinery).

The depend list is carried in from ve name ... as a vector of platform names.

The activity is embedded using subordinate clauses (10-subordinate-clauses.md) in ob la … ko.

The embedded activity MAY include an embedded mood token per subordinate clause policy. The runner MUST preserve the embedded structure when recording.


### 6.2 Uniqueness

Platform names within a refinery MUST be unique. Duplicate platform names are an error.

### 6.3 Examples

Platform with no depend list:
su name parse ob la su name src ob text "data/input.csv" be load ya ko be platform ya

Platform that depends on parse:
su name compile from ve name parse ob la su name ast vyah eval be compile ya ko be platform ya


---

## 7. Scheduling and execution (normative)

### 7.1 Depend satisfaction

A platform is eligible to start when all depend names listed in its from ve name ... vector are complete.

Depend names refer to platform names in the same refinery.

### 7.2 Deterministic selection among already platforms

If more than one platform is already at the same time, the runner MUST choose the next platform by this ordering:

1. sort by platform name using official name ordering


2. if still tied (should not occur in valid refineries), use refinery declaration order



Official name ordering is the same ordering used when writing maps by sorted su switches (see the official JSON key order rule in `33-json.md`).

### 7.3 Single-worker default

This v0.1 spec defines refinery execution as single-worker and sequential:

the runner starts one platform at a time

the runner waits for the platform activity evaluation to produce an observable result sentence before starting the next platform


A future spec MAY add parallel execution, but MUST preserve deterministic ordering (for example by limiting concurrency to platforms chosen in the deterministic already order).

### 7.4 What “platform completes” means

A platform completes when evaluation of its activity yields an observable outcome:

success: a normal ya result sentence

failure: a surfaced error sentence be error ya (see 06-errors.md)


If an activity returns a duty/stream/chip sentence (see 09-runtime-primitives.md), that is still an observable ya outcome and counts as platform completion. Lifecycle control of duties/streams is performed only if explicitly expressed by later activities (for example an await platform).

If an activity yields no explicit result sentence, the runner MAY record the activity sentence itself as the result event (same fallback used by the main run loop).


---

## 8. Failure policy (v0.1)

The refinery failure policy in v0.1 is fail-fast:

if any platform completes with be error ya, the refinery MUST stop and the refinery result is that error sentence

platforms not yet started are not executed


A future spec MAY add “continue” policies, but fail-fast is the official default.


---

9. Interaction with run newspaper

9.1 When newspaper is enabled

When run newspaper emission is enabled, the runner SHOULD record:

an evoke record for each platform activity it evaluates (see 11-run-newspaper.md)

the resulting result record sentence (success or be error ya)

any state, artifact, and exchange sentences produced during evaluation (per their specs)


9.2 When newspaper is disabled

When run newspaper emission is disabled:

the runner MUST still execute the same platforms in the same deterministic order

no newspaper records are required



---

10. Again mode requirements (normative)

When again mode is enabled:

1. Newspaper emission MUST be enabled.


2. Any exchange/artifact activity that affects results MUST be recorded per 13-exchange-and-artifact.md.


3. Again-critical artifacts MUST include sha256 hashes.


4. Running again MUST verify hashes and MUST fail on inconsistency.



Again mode MUST NOT change evaluation semantics. It only strengthens recording and verification.


---

11. Errors

Refinery definition and scheduling errors MUST follow 06-errors.md:

thrown as be error do

surfaced as be error ya at observation boundaries


Recommended stable error names for this spec (add to 06-errors.md if not already present):

refinery defective

platform defective

depend defective



---

12. Conformance

An implementation conforms to this spec if it:

parses refinery def / prah blocks

parses platform declarations with su name, optional from ve name ..., and ob la … ko

treats refinery and platform as reserved declaration verbs inside refinery declarations

executes platforms in deterministic order using the official tie-breaker (§7.2)

applies the v0.1 fail-fast policy (§8)

integrates with run newspaper and again mode requirements (§9–§10)
