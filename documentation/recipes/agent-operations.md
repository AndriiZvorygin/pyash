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

## 7. Fast sanity checklist

1. `channels.pya` enables the channel (`matrix channel ob bool truth`).
2. `matrix channel` config map has valid homeserver + token (or shared secret path).
3. scheduler health shows running.
4. channel telemetry shows `received > 0`.
5. session file appends user/assistant lines.
6. if tool not executed, check `be ratify ya` and `ratify.pya`.
