# 24. Channel Contract

Purpose: define one canonical sentence contract between channel adapters, router, and channel runtime.

## 1. Normative Source

The runtime contract is implemented in:

- `program/agent/channel_core/contract.mjs`

All channel runtimes and router surfaces MUST use that module for sentence shapes.

## 2. Canonical Router Operations

### 2.1 `as wo input` request

Input request sentence:

```pyash
su name router as wo input
from name channel matrix room !room:server
to name agent pyash-agent
ob text "hello"
fromtext text "session name matrix_room"
be router do
```

### 2.2 `be input ya` produce

Router input produce sentence:

```pyash
su name news-20260211-0001
from name channel matrix room !room:server
to name agent pyash-agent
for text "pyash-agent"
fromtext text "channel matrix room !room:server -> agent pyash-agent"
ob text "hello"
be input ya
```

### 2.3 `as wo produce` request

Produce request sentence:

```pyash
su name router as wo produce
from name agent pyash-agent
to name channel matrix room !room:server
accordingto text "news-20260211-0001"
ob text "reply text"
be router do
```

### 2.4 `be produce ya` ack

Router produce ack sentence:

```pyash
su name matrix-event-20260211-0001
vyah ve name success
from name agent pyash-agent
to name channel matrix room !room:server
accordingto text "news-20260211-0001"
be produce ya
```

### 2.5 `as wo health` produce

Router health sentence:

```pyash
su name router
ob text "ready"
as bool truth
since date 2026-02-11T13:00:00.000Z
be health ya
```

## 3. Field Mapping

Router `input` produce mapping:

1. `su name` -> payload id
2. `from name` -> source endpoint
3. `to name` -> destination endpoint
4. `ob text` -> normalized payload text
5. `for text` -> resolved target agent (optional)
6. `fromtext text` -> routed session id (optional)

Router `produce` ack mapping:

1. `su name` -> delivery message id
2. `accordingto text` -> routed payload id
3. `vyah ve name success|fail` -> delivery outcome
4. `from name` / `to name` -> endpoint pair

Router `health` mapping:

1. `ob text` -> health text (`ready` or `defective`)
2. `as bool` -> health truth
3. `since date` -> health timestamp

## 4. Determinism and Format Rules

1. Contract produce MUST be sentence-shaped, not ad hoc JSON blobs.
2. Object->sentence and sentence->object conversions MUST round-trip deterministically.
3. Validation failures MUST raise typed router defectives.
4. New channels (matrix/email/telegram/etc.) MUST reuse the same input/produce/health contract.
