# Operating Recipe: Scheduler + Channels + Agents

This recipe is practical operations guidance.  
Normative behavior lives in specifications.

## 1. Start scheduler daemon

```bash
node command/scheduler_daemon.mjs --action begin --world-root ./world
node command/scheduler_daemon.mjs --run --world-root ./world
```

Notes:
- First command marks scheduler as running.
- Second command runs the long-lived daemon loop.

## 2. Health and list

Scheduler health:

```bash
node command/scheduler_daemon.mjs --action health --world-root ./world
```

Pyash control surface:

```pyash
from wo calendar su name scheduler be health do
from wo calendar su name scheduler be list do
from wo calendar su name matrix probe be health do
```

## 3. Stop / restart

```bash
node command/scheduler_daemon.mjs --action stop --world-root ./world
node command/scheduler_daemon.mjs --action restart --world-root ./world
```

## 4. One-shot channel probe

```bash
node command/channel_run.mjs --agent confederation-priest --channel matrix --once
```

Use this for debug/bootstrap only.  
Normal operation should be scheduler-driven.

## 4.1 Matrix config map (recommended)

Prefer configuring Matrix via the `matrix channel` map in `configure/secret.pya`
or `configure/default.pya`.

Fast path:

```bash
pyash configure matrix
```

Example:

```pyash
su name matrix channel be map def
su name homeserver ob text "https://matrix.liberit.ca" ya
su name room ob text "!roomid:matrix.liberit.ca" ya
su name executive username ob text "@andrii:matrix.liberit.ca" ya
su name token ob text "<access-token>" ya
prah
```

Notes:
1. If `token` is present, registration shared secret is optional.
2. If no `token` is present, set `registration shared secret` for bootstrap registration/login.
3. Room id (`!…`) is preferred over alias (`#…`) for reliable sends.
4. Ready-to-copy template: `configure/secret.pya.example`.
5. matrix.org users should prefer token or password-login mode; shared secret is usually not available.

## 5. Ratify policy for propose tools

Policy file:

```text
world/house/<agent>/conduct/ratify.pya
```

Example:

```pyash
su name be_command_ob_text ob bool lie ya
su name default ob bool lie ya
```

Notes:
- `su name <tool-function-name>` matches exact tool call name.
- `su name default` is fallback.
- `truth` allows; `lie` denies.

## 6. Where to look when behavior is wrong

Scheduler telemetry:

```text
world/newspaper/YYYYMMDD-scheduler.pya
```

Channel telemetry:

```text
world/newspaper/YYYYMMDD-channel-<channel>-<agent>.pya
```

Agent sessions:

```text
world/house/<agent>/session/YYYYMMDD-<session>.pya
```

Look for:
- `be ratify ya` decisions (proposal allowed/denied)
- channel `received/handled/sent`
- `skippedDedup`, `skippedMention`, `skippedSelf`

## 6.1 Holding area (channel spool) layout

Channel runtime uses file-backed spool directories under:

```text
world/holding/channel/
```

Layout:

```text
world/holding/channel/input/            # normalized inbound items waiting for routing
world/holding/channel/runtime/          # claimed/in-flight items
world/holding/channel/produce/success/  # completed outbound delivery records
world/holding/channel/produce/fail/     # failed outbound delivery records
```

Operational invariants:
1. Runtime data belongs in `world/holding/channel/*`, not `world/conduct/*`.
2. Files move `input -> runtime -> produce/*` as they advance.
3. Claims are scoped by channel + agent; one agent must not steal another agent's work.
4. Channel polls warm-start from checkpoints on first run to avoid replaying historical backlog.

If queue behavior looks wrong:
1. Check scheduler health/list first (`pyash calendar health`, `pyash calendar list`).
2. Inspect spool depth (`find world/holding/channel -type f | wc -l`).
3. Inspect most recent runtime/produce records to confirm current timestamps.
4. If old backlog is wedged, stop scheduler, archive stale spool files, then restart.

## 7. Fast sanity checklist

1. `channels.pya` enables the channel (`matrix channel ob bool truth`).
2. `matrix channel` config map has valid homeserver + token (or shared secret path).
3. `world/conduct/calendar.pya` declares shared channel jobs (`channel poll`, `channel input`, `channel produce`).
4. scheduler health shows running.
5. channel telemetry shows `received > 0`.
6. session file appends user/assistant lines.
7. if tool not executed, check `be ratify ya` and `ratify.pya`.

## 8. Authoring guardrails (for agent/mind updates)

When proposing new runtime surfaces:

1. Prefer canonical sentence forms over new map/json wrappers.
2. Reuse existing invoke surface for mind/refinery runs:
   - `ob text "<input>" for name <target> to name text <output> be evoke do`
   - `ob text "<input>" for name <target> with name <tools map> to name text <output> be evoke do`
3. Reuse existing error sentence surface:
   - surfaced: `... be error ya`
   - thrown/internal: `... be error do`
   - stable names like `<verb> defective`
4. Lifecycle/aspect success marker is `vyah ... success` in emitted forms.
5. Keep conduct-driven control in conduct files (`world/conduct/*`, then agent-local overrides), not ad hoc per-call grammar.

## 9. JSON hallucination to Pyash mapping

Use these substitutions when a model drafts JSON-shaped runtime plans.

1. Tool invoke request
Bad (JSON):
```json
{"tool":"write","input":"hello","target":"helper","output":"out"}
```
Use (Pyash):
```pyash
ob text "hello" for name helper to name text out be evoke do
```

2. Tool invoke with tool map
Bad (JSON):
```json
{"target":"coding saddle","input":"task","tools":"saddle tools","output":"result"}
```
Use (Pyash):
```pyash
ob text "task" for name coding saddle with name saddle tools to name text result be evoke do
```

3. Run-scoped conduct on invoke
Bad (JSON):
```json
{"input":"task","target":"helper","conduct":"review loop configure"}
```
Use (Pyash):
```pyash
ob text "task" for name helper under name review loop configure to name text result be evoke do
```

4. Error surface
Bad (JSON):
```json
{"status":"error","name":"repair defective","message":"hunk mismatch","from":"repair"}
```
Use (Pyash):
```pyash
su name repair defective ob text "hunk mismatch" from name repair be error ya
```

5. Internal thrown error
Bad (JSON):
```json
{"throw":{"name":"command defective","message":"exit 1"}}
```
Use (Pyash):
```pyash
su name command defective ob text "exit 1" from name command be error do
```

6. Success marker (lifecycle/aspect)
Bad (JSON):
```json
{"status":"success","aspect":"await"}
```
Use (Pyash):
```pyash
ob text "ok" vyah await success be text ya
```

7. Retry control in call payload
Bad (JSON):
```json
{"retry":{"max":3,"backoff":2}}
```
Use (Pyash):
```pyash
# put retry/alternate/lift in conduct files, not in invoke sentence payload
# world/conduct/* then world/house/<agent>/conduct/*
```

8. Tool event recording
Bad (JSON):
```json
{"tool_event":{"id":"1","tool":"command","args":"...","result":"..."}}
```
Use (Pyash):
```pyash
# rely on existing newspaper records (be evoke ya + runtime artifacts)
# do not invent a new tool-event grammar
```
