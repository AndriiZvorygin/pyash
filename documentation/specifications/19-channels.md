# 19 Channels

## 0. Purpose

Define a channel runtime for agent input/output that is:

1. channel-type agnostic (Matrix first, others later),
2. deterministic and replayable,
3. aligned with `18-pyash-agent.md` session, approval, and scheduler rules.

This chapter targets functional parity with nanobot channels.

---

## 1. Terms

* **channel**: an external transport binding (for example Matrix room, CLI queue, webhook).
* **channel event**: one inbound or outbound message unit with fixed identifiers.
* **channel adapter**: runtime module that implements one channel type.
* **checkpoint**: saved progress marker for resuming polling/sync.
* **lane**: session routing key used by scheduled and channel-driven runs.

---

## 1.1 Vocabulary note (informative)

Canonical runtime terms in this chapter follow existing `vyah`/runtime vocabulary:

* scheduling and repetition aspects: `schedule`, `habit`, `poll`
* routing key term: `lane`
* worker call term: `subprocess`

For semantics, `poll` can be read as repeated probing. Habitual behavior uses `habit` (with `cron` accepted as an alias).

---

## 2. Channel runtime contract (normative)

Every channel adapter MUST implement:

1. `receive`:
   * Input: adapter config + prior checkpoint.
   * Output: ordered inbound events + next checkpoint candidate.
2. `send`:
   * Input: outbound event payload.
   * Output: delivery acknowledgment (or error).
3. `checkpoint load/save`:
   * Persist and recover adapter progress token(s).
4. `identity`:
   * Provide `channel type` and `channel id` per event.

Adapters SHOULD also expose health metadata (latency, retries, failures).

---

## 3. Event envelope (normative)

Inbound events MUST be normalized prior to agent loop entry:

```json
{
  "channelType": "matrix",
  "channelId": "!room:server",
  "threadId": "$optional-thread-id",
  "eventId": "$stable-event-id",
  "sender": "@user:server",
  "text": "message text",
  "timestamp": "2026-02-06T13:00:00.000Z"
}
```

Required fields:

* `channelType`
* `channelId`
* `eventId`
* `sender`
* `text`
* `timestamp`

`threadId` is optional.

Outbound events SHOULD preserve correlation fields when present:

* `channelType`
* `channelId`
* `threadId` (optional)
* `inReplyToEventId` (optional)

---

## 4. Session lane routing

### 4.1 Default routing (normative)

For channel-driven runs, session lane defaults to:

* `<channelType>_<channelId>`

After sanitation:

* lowercase,
* spaces to underscores,
* non-alphanumeric stripped to `_`.

Session filename remains:

* `session/YYYYMMDD-<lane>.pya`

### 4.2 Policy override

`conduct/channels.pya` MAY override default lane:

```pyash
su name matrix !room:server lane ob text "confederation_room" ya
```

If no override is present, default routing applies.

---

## 5. Scheduler integration

Channel polling MUST run under the real scheduler runtime from `18-pyash-agent.md`.

Required behavior:

1. fixed lane routing per channel/lane key,
2. overlap policy `skip next tick`,
3. telemetry for all poll jobs:
   * interval,
   * run duration,
   * overlap skip count,
   * utilization estimate.

Channel poll jobs are declared in `conduct/schedule.pya` using schedule sentences.

---

## 6. Checkpoint and dedup

### 6.1 Checkpoint

Each adapter MUST persist checkpoint state under agent house `conduct/`.

Suggested paths:

* `conduct/checkpoint-<channel-type>.json`

Example:

* `conduct/checkpoint-matrix.json`

### 6.2 Dedup

Runtime MUST deduplicate inbound events by `eventId` before invoking the mind loop.

Dedup cache MAY be persisted as:

* `conduct/dedup-<channel-type>.jsonl`

Dedup retention SHOULD be bounded (size or age).

---

## 7. Approval and tool safety

Approval gates from `18-pyash-agent.md` apply unchanged to channel-triggered runs:

* `can` tools execute directly.
* `propose` tools require ratification policy in:
  * `world/house/<agent>/conduct/ratify.pya`

Channel origin metadata SHOULD be available to ratify policy evaluation.

---

## 8. Subprocess agents as channel tools

Channel-driven agent loops MAY call subprocess agents as tools.

Requirements:

1. deterministic call/result logging,
2. explicit lane selection for subprocess session routing,
3. bounded retries on subprocess failure.

---

## 9. Matrix MVP profile

This part defines the first usable Matrix adapter cut.

### 9.1 Scope in

1. one-room polling/sync,
2. plain text inbound message receive,
3. plain text outbound reply,
4. event-id dedup,
5. checkpoint resume,
6. session lane routing using rules in part 4.

### 9.2 Scope out (follow-up)

1. end-to-end encryption,
2. media/file upload,
3. reactions/edits/redactions,
4. thread-rich semantics beyond basic `threadId` carriage.

### 9.3 Minimum config sentences

`conduct/channels.pya` example:

```pyash
su name matrix channel ob bool truth ya
su name matrix homeserver ob text "https://matrix.example.org" ya
su name matrix user ob text "@agent:example.org" ya
su name matrix room ob text "!roomid:example.org" ya
su name matrix room lane ob text "matrix_main" ya
```

`conduct/schedule.pya` example:

```pyash
su name matrix poll every minute 1 for name confederation-priest with wo tools be schedule ya
su name matrix poll lane ob text "matrix_main" ya
```

---

## 10. Artifacts and telemetry

Channel runtime SHOULD write:

1. adapter telemetry:
   * `conduct/channel-telemetry.jsonl`
2. scheduler telemetry:
   * `conduct/scheduler.jsonl`
3. optional inbound/outbound trace:
   * `artifacts/channel/<channel-type>/...`

Each telemetry line SHOULD include:

* `timestamp`
* `channelType`
* `channelId` (if known)
* `event` (`poll`, `send`, `skip_overlap`, `error`)
* `durationMs` (when applicable)

---

## 11. Implementation map (recommended)

* `program/agent/channels/index.mjs` (runtime orchestration)
* `program/agent/channels/matrix.mjs` (Matrix adapter)
* `program/agent/channels/policy.mjs` (`conduct/channels.pya` loader)
* `command/channel_run.mjs` (single-run and daemon modes)
