## Pyash-compatible spec: agent loop, prompt context, and memory integration

### 0. Purpose

Define a minimal, deterministic agent loop for Pyash that mirrors nanobot-style behavior:

1. Build prompt context from bootstrap files, memory, and history.
2. Call a mind backend with tools.
3. Execute tool calls and feed results back into the loop.
4. Record outputs and memory changes deterministically.

This spec focuses on functional parity for loop, context, memory integration, and orchestration. It does not require internal implementation parity.

Canonical memory lifecycle, retention, retrieval, and replay rules are specified in:

* `documentation/specifications/22-memory-and-remember.md`

Operational companion (non-normative): `documentation/recipes/agent-operations.md`.

---

## 1. Terms

* **agent loop**: the iterative cycle that builds context, calls a mind, executes tool calls, and returns a response.
* **bootstrap files**: identity files that always contribute to context, for example `AGENTS.md`.
* **prompt context**: the system + history + current input bundle sent to the mind backend.
* **session**: a named dialogue history used for context windows.
* **memory**: persistent, human-curated notes separate from ordinary Pyash facts.
* **tool call**: a structured request returned by the mind backend to invoke a tool.
* **roles**: optional, task-oriented role notes that sit alongside identity and memory.

---

## 2. Global invariants (normative)

1. Agent loop execution is deterministic for identical input, memory, and tool responses.
2. Prompt context is assembled in a stable order.
3. Memory files are append-only unless explicitly overwritten by a dedicated memory verb.
4. Tool calls are executed in the order returned by the mind backend.
5. Each mind call records request and response artifacts for inspection and replay.

---

## 3. Data shapes

### 3.1 Prompt context record (json map)

Required keys:

* `system` (text): the system prompt text.
* `messages` (series): ordered list of message entries.

Message entry fields:

* `role` (text): `"system" | "user" | "assistant" | "tool"`.
* `content` (text).
* `name` (text, optional): tool name for tool responses.
* `tool_call_id` (text, optional): id for tool response linkage.

### 3.2 Tool call record (json map)

Required keys:

* `id` (text)
* `name` (text)
* `arguments` (map) or `arguments_json` (text)

### 3.3 Memory context block (text)

The memory context is a formatted block inserted into the system prompt:

```
# Memory

## Long-term Memory
<contents of MEMORY.md>

## Today's Notes
<contents of YYYY-MM-DD.md>
```

If a section is missing, it is omitted entirely.

Optional summary block (if `memory/SUMMARY.md` exists):

```
# Summary
<contents of SUMMARY.md>
```

### 3.4 Agent house layout

Minimum layout under `world/house/<agent>/`:

* `identity/` (bootstrap files)
* `memory/` (persistent memory files)
* `session/` (session history)
* `conduct/` (policy, calendar, managed state)
* `program/` (agent-local automation/helpers)
* `artifacts/` (run-scoped artifacts)

Optional layout:

* `roles/` (task/role notes, treated similarly to skills)
* `gold/accepted/` and `gold/rejected/` (training signal emission)

### 3.5 Base house inheritance

Agent identity context MAY inherit from:

* `world/house/base/identity/`

When present, bootstrap files are merged in deterministic order:

1. base file content
2. agent file content

This keeps shared identity/tool guidance DRY while allowing agent-specific deltas.

---

## 4. Prompt context assembly

### 4.1 Bootstrap files (ordered)

The following files are read from the agent house `identity/` directory, in order. Missing files are skipped:

* `AGENTS.md`
* `SOUL.md`
* `USER.md`
* `TOOLS.md`
* `IDENTITY.md`

Each file is injected as:

```
## <FILENAME>

<file contents>
```

### 4.1.1 House/world orientation block (normative)

Agent identity SHOULD explain:

1. what folders/files exist inside `world/house/<agent>/` (home scope),
2. what shared collaboration areas exist outside home (for example `world/workplace/<project>/`),
3. which locations are writable vs read-only under current conduct policy,
4. assigned project roots (for example `world/workplace/<project>/`) and shared processing roots (for example `world/library/processed/`).

This orientation MUST be explicit in identity files (`IDENTITY.md` and/or `TOOLS.md`) so agents can reason about safe collaboration paths.

---

### 4.1.2 Agent administration utilities (normative surface)

Implementations SHOULD expose an administration surface (CLI and/or verbs) for:

* list agents
* create agent from base template
* modify agent identity/conduct files
* start/resume agent session
* trigger agent sleep/compaction

Recommended deterministic backing store is the world filesystem (no hidden DB):

* `world/house/<agent>/identity/*`
* `world/house/<agent>/conduct/*`
* `world/house/<agent>/session/*`
* `world/house/<agent>/memory/*`
* `world/house/<agent>/program/*`
* `world/house/<agent>/artifacts/*`

Agent creation MUST initialize at least:

* `identity/`
* `memory/`
* `session/`
* `conduct/`
* `artifacts/`

and SHOULD seed identity from `world/house/base/identity/`.

### 4.1.3 Idempotent house establish and improve (normative)

The administration surface MUST support idempotent reconcile for agent house creation and updates.

Canonical Pyash surface:

```pyash
su name <agent> ob text "<purpose>" be establish do
su name <agent> ob text "<note>" be improve do
be list from wo house do
su name <agent> be begin from wo house do
su name <agent> be stop from wo house do
su name <agent> be restart from wo house do
```

Canonical CLI parity surface:

* `node command/agent_admin.mjs ensure-base`
* `node command/agent_admin.mjs list`
* `node command/agent_admin.mjs establish --name <agent> --purpose "<purpose>" [--interval-minutes <n>] [--begin]`
* `node command/agent_admin.mjs establish-interactive`
* `node command/agent_admin.mjs improve --name <agent> --note "<note>"`
* `node command/agent_admin.mjs begin --name <agent>`
* `node command/agent_admin.mjs stop --name <agent>`
* `node command/agent_admin.mjs restart --name <agent>`

Establish reconcile result MUST report:

* `status`: one of `created`, `updated`, `unchanged`
* `changed`: boolean
* `changes`: deterministic list of updated areas

Managed reconcile metadata MUST be persisted at:

* `world/house/<agent>/conduct/managed.pya`

with a deterministic desired-state hash so repeated identical establish calls produce `unchanged`.

Managed-purpose identity block:

* Purpose text in `world/house/<agent>/identity/IDENTITY.md` SHOULD be bounded by markers:
  * `<!-- managed-purpose:start -->`
  * `<!-- managed-purpose:end -->`
* Reconcile updates this bounded section in place instead of appending duplicates.

Managed calendar policy:

* Reconcile MAY write `world/house/<agent>/conduct/calendar.pya` when missing.
* Reconcile MAY update that file only when it is managed (`# managed by agent_admin`) or absent.
* Unmanaged calendar files MUST remain unchanged.

### 4.2 System prompt order

The system prompt concatenates the following blocks in order, separated by `\n\n---\n\n`:

1. Agent identity block (runtime, workspace, guidance).
2. Bootstrap files block (combined).
3. Roles block (optional, from `roles/`).
4. Memory context block.
5. Skills summary block (optional).
6. Tool explainer block (optional).

Tool explainer block SHOULD explicitly describe memory usage, for example:

* Use `be remember ... during date today` for daily notes.
* Use `be remember ... during date tomorrow` for reminders.
* Use `be remember ... during wo always` for long-term memory.

### 4.3 History inclusion

History messages are appended after the system prompt. The maximum history window is configurable (default 50 messages). Only `role` and `content` are required in the prompt.

### 4.4 Current message

The current user input is appended last as a `user` role message.

---

## 5. Memory storage

This section defines agent-local memory files used for prompt context assembly.
For canonical memcube lifecycle and `be remember do` retrieval semantics, see:

* `documentation/specifications/22-memory-and-remember.md`

### 5.1 Files

Memory is stored under `memory/` in the agent house:

* `memory/MEMORY.md` for long-term memory.
* `memory/YYYY-MM-DD.md` for daily notes.

### 5.2 Append rules

* Daily notes append to today’s file.
* Long-term memory is updated only by explicit write operations.
* The memory system does not automatically reflect Pyash facts.

### 5.3 Suggested Pyash verbs

The following verbs are recommended for managing memory:

* `be remember ob text "<note>" during date today do` appends to today's notes.
* `be remember ob text "<note>" during date tomorrow do` appends to tomorrow's notes (future reminders).
* `be remember ob text "<note>" during date YYYY-MM-DD do` appends to that date's notes (future reminders).
* `be remember ob text "<note>" during wo always do` appends to long-term memory.

These verbs are not required for initial parity; they are future-facing hooks.

---

## 6. Session history

### 6.1 Session identifiers

A session name is generated on first prompt as:

* `YYYYMMDD-<name>`

`<name>` is produced by a short mind prompt and stored in the session file header.

Session identity MAY be derived from the `from discourse` / `fromtext` config prompt:

* If the config prompt matches an existing session for today, reuse it.
* Otherwise generate a new name.

Explicit overrides (config prompt):

* `from discourse filename "<session path>"` to target a specific session file.
* `fromtext filename "<session path>"` to target a specific session file.
* `fromtext name "session name <name>"` to target a specific session name.

Optional override (tool map config):

```
su name session name ob text "<name>" ya
```

When present, the session file name becomes `YYYYMMDD-<name>` for that day.

Default tools map:

```
with wo tools
```

Using `with wo tools` on a mind call uses the default `agent tools` map.

Example tool map:

```
su name tools be map def
su name agent ob bool truth ya
su name session name ob text "draft review" ya
su name read be read from filename input can
su name write be write ob text input to filename input can
prah
```

### 6.2 Storage

Sessions are stored as append-only Pyash series files under the agent house:

* `session/YYYYMMDD-<name>.pya`

Session files are series defs without a closing `prah` so new lines can be appended
without rewriting the full file.

Header line (required):

```
su name <session name> since date YYYY-MM-DD be series def
```

Entry lines (append-only):

```
su name system ob text "<config prompt>" ya
su name user ob text "<message>" ya
su name assistant ob text "<message>" ya
```

Optional timestamp:

```
su name system ob text "<config prompt>" during date <timestamp> ya
su name user ob text "<message>" during date <timestamp> ya
su name assistant ob text "<message>" during date <timestamp> ya
```

Optional model switches (as an additional case on system entries):

```
su name system ob text "<config prompt>" as name <model> during date <timestamp> ya
```

### 6.3 History selection

Only the most recent `N` messages are included in prompt context. Default `N = 50`.

If a `session name` override is present and today’s file does not provide enough
history, the previous day’s file with the same name may be used to fill the
window.

### 6.4 Iterative review-loop compaction (normative)

For sessions running reviewer/generator retries, context assembly MUST prefer a
golden compact set instead of raw retry history:

1. original prompt/task,
2. latest successful generator output (if any),
3. guarantee output for that successful generator output (if any).

Failed retry chains MUST NOT be replayed into prompt context by default.
They remain persisted in session/newspaper/artifacts for audit, but are excluded
from the next attempt context bundle unless explicitly requested.

If no success exists yet, include only the immediate prior attempt and its
guarantee response alongside the original prompt.

### 6.5 Session gold collection (normative)

Each agent session MAY emit training gold records, but collection MUST be deterministic.

Gold labels:

1. `gold_positive` — user explicitly confirms quality (for example: `good`, `great`, `perfect`, `works`, `thanks`).
2. `gold_negative` — user explicitly rejects quality (for example: `wrong`, `bad`, `not working`, `broken`, `hate`).
3. `gold_neutral` — no clear quality signal.

Default classifier rule:

* Use deterministic regex/keyword matching on the latest user response.
* Do not require embeddings for baseline collection.
* If both positive and negative markers appear, classify as `gold_negative`.

Storage layout:

* accepted records:
  * `world/house/<agent>/gold/accepted/<date>.pya`
* rejected records:
  * `world/house/<agent>/gold/rejected/<date>.pya`

Record shape (append-only):

```
su name gold label ob text "gold_positive|gold_negative|gold_neutral" during date <timestamp> ya
su name gold task ob text "<original task>" during date <timestamp> ya
su name gold output ob text "<final assistant output>" during date <timestamp> ya
su name gold guarantee ob text "<guarantee summary>" during date <timestamp> ya
```

Retention rule:

* `gold_positive` SHOULD be written to `accepted`.
* `gold_negative` SHOULD be written to `rejected`.
* `gold_neutral` MAY be skipped by default.

Optional extension:

* Implementations MAY add embedding-based sentiment or preference scoring as a second-stage classifier.
* The second stage MUST NOT overwrite baseline deterministic labels; it may only add supplementary fields.

### 6.6 LoRA training usage (brief)

Gold records are intended for two complementary training objectives:

1. Supervised fine-tuning (SFT)
* Use `gold_positive` records as direct instruction-response targets.
* This teaches the model what good outputs look like.

2. Preference training
* Use paired `chosen` vs `rejected` outputs for the same prompt/context:
  * `chosen` <- `gold_positive`
  * `rejected` <- `gold_negative`
* Train with a preference objective (for example DPO, ORPO, or KTO).
* This teaches ranking behavior: prefer accepted outputs and avoid rejected patterns.

Guideline:

* `gold_negative` SHOULD NOT be used as direct SFT targets.
* `gold_negative` SHOULD be used for preference/rejection objectives or evaluation-only guard sets.

### 6.7 Sleep mode (context compaction)

Agents MAY enter sleep mode when context pressure is high.

Sleep mode SHOULD perform deterministic compaction:

1. keep original task,
2. keep latest successful bundle (draft + guarantee + optional reviewer),
3. keep latest failed bundle,
4. write/update session summary,
5. archive excess retry chatter outside active prompt context.

Optional heavy mode:

* If host resources allow, sleep mode MAY trigger background export jobs for LoRA/SFT/preference datasets.
* Training/export work MUST be decoupled from foreground interactive latency.

---

## 7. Agent loop

### 7.1 Core steps

1. Receive an inbound message with session key.
2. Load or create the session history.
3. Build prompt context from system + memory + history + current input.
4. Call the mind backend with tool definitions.
5. If tool calls are present, execute each tool and append tool results as `tool` role messages.
6. Continue the loop until a response without tool calls is returned, or a max iteration cap is reached.
7. Save the user message and final assistant response to session history.

### 7.2 Iteration cap

A hard limit prevents runaway loops. Default `max_iterations = 20`.

### 7.3 Tool execution order

Tool calls are executed in the order returned. Results are appended immediately after execution.

### 7.4 Tool approval gating (normative)

Tool approval is policy-driven:

* `can` mood tool entries execute immediately.
* `propose` mood tool entries require ratification before execution.

Default-tool ratification policy is loaded from:

```
world/house/<agent>/conduct/ratify.pya
```

If a proposed tool is denied or unanswered, the tool call is skipped and the loop continues.

Ratification decisions in non-interactive runs (scheduler/channel) are resolved from
`conduct/ratify.pya` and emitted as `be ratify ya` decision sentences before
the loop continues. Implementations SHOULD preserve the matched policy key/value
as decision text so audits can reconstruct why a proposed tool was allowed or denied.

### 7.5 Heartbeat behavior (normative)

Heartbeat checks are scheduler-driven and default to every 24 minutes.

Overlap policy:

* If a prior heartbeat tick is still running when the next tick arrives, skip the next tick.

---

## 8. Tool registry

### 8.1 Minimum tool set

An initial agent loop SHOULD support these tool classes:

* File read/write/edit/list
* Shell exec
* Web search/fetch
* Message send
* Spawn subprocess agent

### 8.2 Context propagation

If tools depend on channel or session context, the agent loop updates tool context before each call.

---

## 9. Artifacts and logging

### 9.1 Mind request/response artifacts

Every mind call records:

* request payload
* response payload

Storage location defaults to the agent house run scope:

* `world/house/<agent>/artifacts/<run-id>/mind/`

For parity/autofix style jobs, implementations SHOULD keep all per-run diagnostics
under the same run root, for example:

* `world/house/<agent>/artifacts/<run-id>/status-before.json`
* `world/house/<agent>/artifacts/<run-id>/status-after.json`
* `world/house/<agent>/artifacts/<run-id>/delta.json`
* `world/house/<agent>/artifacts/<run-id>/fix-log/*.log`
* `world/house/<agent>/artifacts/<run-id>/summary.pya`

Global newspapers remain outside agent control under world-level logs.

### 9.2 Loop traces

A loop trace is a structured log of each iteration:

* iteration number
* tool calls executed
* final assistant content

---

## 10. Security and workspace limits

1. File tools can be restricted to the workspace root.
2. Shell execution can be disabled or sandboxed.
3. Web tools may require API keys.
4. Memory files must never contain secrets by default.
5. Agents SHOULD be sandboxed to an effective house root:
   * home root: `world/house/<agent>/`
   * shared collaboration roots: explicit allowlist entries (for example assigned `world/workplace/<project>/`)
   * shared processing roots: explicit allowlist entries (for example `world/library/processed/`)
6. Access outside house root and shared allowlist roots MUST be denied by default unless explicitly configured in conduct policy.

---

## 11. Integration points in Pyash

Recommended files to implement this spec:

* Prompt context builder: `program/agent/context.mjs`
* Memory storage helpers: `program/remember/persistent.mjs`
* Session persistence: `program/agent/session.mjs`
* Agent loop: `program/agent/loop.mjs`
* Mind integration: `program/verbs/mind/mind.mjs`
* Scheduler + heartbeat runner: `command/heartbeat.mjs` (and future scheduler runtime)

---

## 12. Minimal parity checklist

* Build system prompt with bootstrap + memory.
* Include session history in mind calls.
* Store sessions as append-only Pyash series files.
* Execute tool calls in a deterministic loop.
* Record request/response artifacts.
* Enforce approval on `propose` tools via `conduct/ratify.pya`.
* Run heartbeat from scheduler with skip-on-overlap policy.

## 13. Agent house paths

Agent house directory (per `15-world.md`):

```
world/house/<agent>/
```

Agent subpaths:

```
world/house/<agent>/identity/
world/house/<agent>/memory/
world/house/<agent>/session/
world/house/<agent>/conduct/
```

Implementations MAY seed empty `identity/` directories from a template pack
such as `examples/agent-identity/agent-helper/identity/`.

* Build system prompt with bootstrap + memory.
* Include session history in mind calls.
* Execute tool calls in a deterministic loop.
* Record request/response artifacts.
* Persist session history and memory to disk.

## 14. Scheduler and load

### 14.1 Real scheduler requirement

The system MUST provide a real scheduler runtime (not ad-hoc sleeps in agent logic) so load can be measured and capacity can be estimated per machine.

### 14.2 Schedule declaration format

Schedules are declared as Pyash sentences (stored in policy/config files, typically under `conduct/`).

Canonical calendar declaration pattern:

```
su name <job> for name <agent> with wo tools vyah habit during minute <num> be calendar ya
```

Examples:

```
su name priest heartbeat for name confederation-priest with wo tools vyah habit during minute 24 be calendar ya
su name helper heartbeat for name agent-helper with wo tools vyah habit during minute 24 be calendar ya
su name matrix probe for name channel-postmaster with wo tools vyah habit during minute 1 be calendar ya
```

### 14.3 Load telemetry

Scheduler runtime SHOULD record, per job:

* interval
* run duration
* overlap skip count
* estimated utilization percentage (`duration / interval`)
* storage path: `world/newspaper/YYYYMMDD-scheduler.pya`

### 14.4 Scheduled job session routing (normative)

Session routing differs by invocation type:

* Interactive/manual invocations use prompt-derived session selection.
* Scheduled jobs use a fixed session lane per job name.

Canonical lane sentence form:

```
su name <job> lane ob text "<lane name>" ya
```

Routing rules:

* If a scheduled job provides a lane sentence, use that lane name.
* If no lane sentence is provided, use the job name as the lane name.
* Scheduled session files use the existing daily prefix format: `YYYYMMDD-<lane name>.pya`.
* Lane semantics are equivalent to scheduler-side `from discourse name "<session name>"`.

### 14.4.1 Presence updates for scheduled runs (normative)

Scheduler-driven agent runs SHOULD refresh a presence marker file:

* `world/house/<agent>/.presence.pya`

Canonical sentence shape:

```pyash
su name <agent> be present since date "<start-iso>" during date "<latest-iso>" with ve filename "<path-1>" "<path-2>" ya
```

Rules:

1. `since` is the start timestamp of the active scheduled work window.
2. `during` is updated at run start and run end.
3. `with ve filename ...` contains touched/owned files for the active window when available.
4. Presence emission must be deterministic and safe to rewrite.
5. Scheduler overlap/skip policy does not create duplicate active windows.

### 14.5 Single scheduler daemon (normative)

The system MUST provide a single scheduler daemon runtime per machine/workspace
that manages scheduled work for all agents.

Scheduler daemon responsibilities:

1. discover schedule declarations from policy files,
2. run due jobs with overlap policy (`skip next tick`),
3. emit scheduler telemetry,
4. expose status and control actions.

Initial schedule discovery roots:

* global: `world/conduct/calendar.pya` (fallback: `schedule.pya`)
* agent-local: `world/house/<agent>/conduct/calendar.pya` (fallback: `schedule.pya`)

If both global and agent-local schedules define the same `job` for the same
`agent`, the agent-local declaration MUST take precedence.

### 14.6 Pyash schedule control surface (normative)

Schedule daemon control MUST be callable through Pyash sentences (not only Node CLI).

Control namespace:

* Calendar control MUST be scoped with `from wo calendar` to avoid global name collisions.

Canonical control sentence shape:

```pyash
from wo calendar su name <service> be <action> do
```

Minimum control actions:

* `begin`
* `stop`
* `restart`
* `health`
* `health probe` (explicit probe form; equivalent intent to `health`)

Canonical examples:

```pyash
from wo calendar su name scheduler be begin do
from wo calendar su name scheduler be stop do
from wo calendar su name scheduler be restart do
from wo calendar su name scheduler be health do
from wo calendar su name scheduler be health probe do
from wo calendar su name matrix probe be health do
```

Implementation may map these intents to concrete verbs/ceremonies, but they MUST remain callable from Pyash programs and sessions.

### 14.7 Daemon status shape (recommended)

Scheduler status SHOULD include:

* daemon running state
* loaded jobs (agent + job name + interval)
* last run timestamp per job
* overlap skip count per job
* utilization estimate per job

### 14.8 Service definitions and system block bridge (normative)

Calendar entries define only timing/scope.
Execution/service policy linkage lives in service definition files.

Service definition root:

* `world/conduct/service/<service-name>.pya`

Name mapping:

* service name from calendar (`su name <service> ... be calendar ya`)
* filename slug: lowercase, spaces/non-alnum collapsed to `_`
* example: `matrix probe` -> `world/conduct/service/matrix_probe.pya`

Canonical convenience sentence (single sentence, declarative):

```pyash
su name <service>
since name <after-target>
fromperson name <wants-target>
as text "<service-type>"
ob filename "<exec-start>"
for name <wanted-by-target>
onto text "<restart-policy>"
be service ya
```

Systemd equivalence:

* `since name` -> `[Unit] After=`
* `fromperson name` -> `[Unit] Wants=`
* `as text` -> `[Service] Type=`
* `ob filename` -> `[Service] ExecStart=`
* `onto text` -> `[Service] Restart=`
* `for name` -> `[Install] WantedBy=`

`ob filename` is the canonical execution linkup (`ExecStart` equivalent). If the executable is a Pyash runner, that command may in turn call module/ceremony code.

Service definitions MAY also be represented as a canonical map for format conversion and round-trip.
Implementations SHOULD support conversions:

* systemd INI -> canonical map -> convenience sentence
* convenience sentence -> canonical map -> systemd INI

Recommended canonical map keys:

* `unit_after`
* `unit_wants`
* `service_type`
* `service_exec_start`
* `service_restart`
* `install_wanted_by`

This bridge SHOULD share parsing/emission infrastructure with existing structured format support (json/yaml/csv map flows).

Example:

`world/conduct/calendar.pya`
```pyash
su name priest heartbeat for name confederation-priest vyah habit during minute 24 be calendar ya
```

`world/conduct/service/priest_heartbeat.pya`
```pyash
su name priest heartbeat since name network-online.target fromperson name network-online.target as text "simple" ob filename "/usr/local/bin/my-service" for name multi-user.target onto text "on failure" be service ya
```

## 15. Channels

### 15.1 Channel runtime contract (normative)

Each channel adapter MUST implement:

1. `receive`:
   * input: adapter config + prior checkpoint
   * output: ordered inbound events + next checkpoint candidate
2. `send`:
   * input: outbound event payload
   * output: delivery acknowledgment (or error)
3. checkpoint load/save
4. event identity (`channel type`, `channel id`)

### 15.2 Channel event envelope (normative)

Inbound channel events MUST be normalized before agent-loop handling.

Required fields:

* `channelType`
* `channelId`
* `eventId`
* `sender`
* `text`
* `timestamp`

Optional fields:

* `threadId`
* `inReplyToEventId`

### 15.3 Channel schedule orchestration

Channel polling MUST run under the single scheduler daemon defined in section 14.

Continuous operation MUST be daemon-managed; per-agent/per-channel CLI processes are debug/bootstrap helpers only.

### 15.4 Channel policy roots and precedence

Channel policy is resolved from:

1. global: `world/conduct/channels.pya`
2. agent-local: `world/house/<agent>/conduct/channels.pya`

Agent-local policy overrides global for overlapping keys.

### 15.5 Channel schedule roots and precedence

Channel polling schedules are resolved from:

1. global: `world/conduct/calendar.pya` (fallback: `schedule.pya`)
2. agent-local: `world/house/<agent>/conduct/calendar.pya` (fallback: `schedule.pya`)

For duplicate `<agent> + <job>` schedule definitions, agent-local takes precedence.

### 15.6 Session lane routing for channel runs

Default channel lane:

* `<channelType>_<channelId>`

After sanitation:

* lowercase
* spaces to `_`
* non-alphanumeric to `_`

Policy MAY override via lane sentences in `channels.pya`.

### 15.7 Checkpoint and dedup

Channel runtimes MUST persist:

* checkpoint state (`conduct/checkpoint-<channel>.json`)
* dedup state keyed by `eventId` (bounded retention)

Dedup MUST run before mind-loop invocation.

### 15.8 Mention gate policy

Channel policy MAY enable mention gating for shared rooms.

When enabled:

* non-DM/shared rooms handle messages only if agent mention is present
* DM-designated rooms MAY bypass mention gating

### 15.9 Approval and tool safety

Approval policy from section 7.4 applies unchanged to channel-triggered runs:

* `can` tools execute immediately
* `propose` tools require `conduct/ratify.pya`

### 15.10 Channel telemetry

Channel runtime SHOULD record:

* polling duration
* received count
* handled count
* sent count
* dedup skips
* mention-gate skips
* self-message skips

Suggested path:

* `world/newspaper/YYYYMMDD-channel-<channel>-<agent>.pya`

## 16. Subprocess agents

Subprocess agents are treated as callable tools and MUST support:

1. deterministic invocation
2. deterministic result capture
3. explicit session lane selection

## 17. Matrix MVP profile

### 17.1 Scope in

1. room polling/sync
2. plain-text inbound handling
3. plain-text outbound replies
4. event-id dedup
5. checkpoint resume
6. lane routing via section 15.6

### 17.2 Scope out (follow-up)

1. end-to-end encryption
2. media/file upload
3. reactions/edits/redactions
4. advanced thread semantics beyond basic `threadId` carriage

### 17.3 Minimum policy examples

Global `world/conduct/channels.pya`:

```pyash
su name matrix channel ob bool truth ya
su name matrix mention gate ob bool truth ya
su name matrix homeserver ob text "https://matrix.example.org" ya
su name matrix room ob text "!roomid:example.org" ya
su name matrix room lane ob text "matrix_main" ya
```

Recommended runtime config map (loaded from `configure/default.pya` / `configure/secret.pya`):

```pyash
su name matrix channel be map def
su name homeserver ob text "https://matrix.example.org" ya
su name room ob text "!roomid:example.org" ya
su name executive username ob text "@executive:example.org" ya
su name token ob text "<access-token>" ya
prah
```

Config precedence (normative):
1. `matrix channel` config map values
2. channel policy files (`world/conduct/channels.pya`, then agent-local override)
3. legacy remembered scalar facts (`matrix homeserver`, `matrix access token`, etc.)

Bootstrap auth rule:
* if `token` is available, runtimes SHOULD use it directly;
* otherwise runtimes MAY bootstrap credentials using registration/admin policy.

Global `world/conduct/calendar.pya`:

```pyash
su name priest heartbeat for name confederation-priest with wo tools vyah habit during minute 24 be calendar ya
su name helper heartbeat for name agent-helper with wo tools vyah habit during minute 24 be calendar ya
su name matrix probe for name channel-postmaster with wo tools vyah habit during minute 1 be calendar ya
```
