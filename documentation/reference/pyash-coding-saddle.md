# Pyash Coding Saddle

The coding saddle is the web and terminal surface for durable Pyash `duty`
conversations. A duty names one objective and one configured repository on one
worker host. Pyash keeps the durable identity, conversation, status, and shared
session `.pya`; the host worker runs the existing mind and saddle tools inside
that repository. `WorkTask` is the internal persistence contract, not the user
vocabulary.

## Run

From the repository root, start a local interactive coding session:

```sh
node command/pyash_saddle.mjs
```

The default model/backend/host come from `configure/default.pya`. Local
overrides may be supplied through `PYA_SADDLE_MODEL`, `PYA_SADDLE_BACKEND`,
`PYA_SADDLE_HOST`, and `PYA_SADDLE_CWD`; these select an existing provider and
coding root, they do not start a separate model runtime.

The web app adds a **Duty** mode beside ordinary chat. Choose an online worker
and one of its advertised directories, select the model in the existing model
control, then create a duty with a concise objective and first instruction.
Later messages append to that same duty and session. The model/backend/host
choice is fixed when the duty is created. Use **Accept duty** only after
reviewing the result; acceptance is an operator decision, not an automatic
claim that tests or integration succeeded.

## Controls

Enter submits the current request. Shift+Enter inserts a newline on terminals
that report the standard modified-key sequence; `Ctrl+J` is the portable
newline fallback. `Ctrl+C` writes the existing Pyash mind-interrupt signal and
`Ctrl+D` exits. `/status`, `/model <name>`, `/backend <name>`, `/host <url>`,
`/discharge`, and `/exit` are local saddle commands.

## Durable state

Conversation records use the existing coding-saddle agent house and session
files. A web duty is represented by the existing durable work-status `.pya`
artifact with `kind: coding-duty` metadata and a shared session file under the
web assistant house. It does not introduce another queue, model registry, or
runtime. User messages are durable and worker claims are leased; a worker
failure remains visible. Sending a new instruction to a blocked duty resumes
the same duty while retaining its prior messages and failure history.

Tool calls go through `module/saddle_tools.pya`, so command, read,
write, list, and repair continue to use the existing command policy and
checkpoint/newspaper conventions. Each worker processes one turn at a time;
different worker hosts can process independent duties concurrently. Model
requests continue through the selected existing backend and its normal queue.
The terminal and browser are projections, not authoritative transcript or
queue stores.

## Host Workers

The web server is the durable hub. It stores duty status and the canonical
session file in its persistent Pyash `world` directory. Each coding host runs
the outbound-polling worker from a Pyash checkout; no inbound SSH, remote tmux
inventory, or second GPU scheduler is used. Configure a distinct worker ID and
token per host. The hub's `PYA_DUTY_WORKER_TOKENS` is a semicolon-separated
`worker-id=token` list. Keep it in the web service's secret environment, not in
the repository.

On each host, provide a protected environment file to the service manager:

```sh
PYA_DUTY_HUB_URL=https://pyash.zvorygin.ca
PYA_DUTY_WORKER_ID=swac
PYA_DUTY_WORKER_TOKEN=<unique-secret>
PYA_DUTY_REPOSITORIES=pyash=/home/USER/src/pyash;website=/home/USER/src/website
PYA_DUTY_STATE_ROOT=/home/USER/.local/state/pyash-duty
```

Repository IDs are the only directory choices advertised to the web UI. Roots
remain private to the authenticated worker protocol. The worker validates each
configured root at startup, advertises a heartbeat, claims only duties assigned
to its ID and allowlist, then synchronizes the same duty session before and
after each mind turn. Run one worker service per host with a stable unique ID;
different hosts can process independent duties concurrently. The selected
model still uses its normal provider/GPU queue. The hub expires worker presence
after missed heartbeats; a missed claim lease can be retried without creating a
replacement duty.

Start it under the host's normal service manager from the Pyash checkout:

```sh
node command/pyash_duty_worker.mjs
```

For a user-level systemd worker, install `service/pyash-duty-worker@.service`
under `~/.config/systemd/user/`, adjust its checkout path if needed, and enable
the instance matching the env filename, for example
`systemctl --user enable --now pyash-duty-worker@swac.service` for
`~/.config/pyash/duty-worker-swac.env`. Keep that env file readable only by the
worker account. The checkout must have its normal Node dependencies and
configured provider access. The web service must be behind the existing
authenticated reverse proxy; worker requests use HTTPS and a separate
per-worker bearer token.

Typical user-service installation commands are:

```sh
mkdir -p ~/.config/systemd/user ~/.config/pyash
install -m 0644 service/pyash-duty-worker@.service ~/.config/systemd/user/
chmod 700 ~/.config/pyash
install -m 600 /secure/path/duty-worker-swac.env ~/.config/pyash/duty-worker-swac.env
systemctl --user daemon-reload
systemctl --user enable --now pyash-duty-worker@swac.service
```

The env file is created from the values above before enabling the service. If
the checkout is not `~/pyash` or Node is not on the service PATH, adjust
`WorkingDirectory` and `ExecStart` in the installed unit.

## Resume From A Terminal

Set the hub URL and the same authorization header accepted by the authenticated
web endpoint, then attach to the shared conversation from any tmux session:

```sh
pyash resume duty-<id>
```

Set `PYA_DUTY_HUB_URL` and `PYA_DUTY_HUB_AUTHORIZATION` in the shell from your
credential manager or protected shell environment. The latter is the complete
HTTP authorization value (for example, the existing proxy's `Basic ...`
header); never put the password or encoded value in repository files.

The terminal polls the hub and can queue another instruction while a worker is
running. Closing the terminal does not stop the host worker. `/refresh` shows
current status, `/accept` records operator acceptance when the duty is idle, and
`/exit` leaves the durable work untouched. Use the ID shown in the Duty view;
the literal angle-bracket form is only a placeholder.

These interactive duties are separate from autonomous roadmap work-order
execution: they use the same durable WorkTask status-artifact contract, but do
not claim Sol/Luna planning, independent review, automatic acceptance, or
`automation/roadmap` integration. Those remain governed by the autonomous
runner. A future integration can explicitly hand an accepted duty into that
workflow rather than implying the two paths are already equivalent.

## Provider lifecycle

The saddle shows the current provider and local Pyash GPU queue depth before a
turn. Model loading and residency remain external to Criterion and to this
terminal command. `/discharge` and normal exit use the existing Pyash Ollama
discharge path when the selected backend is Ollama; other providers retain
their own existing lifecycle hooks.
