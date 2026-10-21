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

The default filesystem permission is the selected project directory. This is
Pyash tool-root policy, not an operating-system jail: arbitrary child commands
run as the worker's Unix account. Full home-directory access is an explicit
per-duty choice, requires both host policy and worker configuration, and warns
that any account-readable personal files may be exposed. It is never enabled
implicitly. There is no sudo access.

## Controls

Enter submits the current request. Shift+Enter inserts a newline on terminals
that report the standard modified-key sequence; `Ctrl+J` is the portable
newline fallback. `Ctrl+C` writes the existing Pyash mind-interrupt signal and
`Ctrl+D` exits. `/status`, `/model <name>`, `/backend <name>`, `/host <url>`,
`/discharge`, and `/exit` are local saddle commands.

## Durable state

Conversation records use the existing coding-saddle agent house and session
files. A web duty is represented by the existing durable work-status `.pya`
artifact with `kind: coding-duty` metadata and a session file in its owner's
web assistant area. It does not introduce another queue, model registry, or
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

The web server is the durable hub. It stores duty status in its persistent
Pyash `world` directory and keeps each authenticated user's chat history and
workspace in a private assistant-house directory. The primary account can
continue using the existing assistant-house path; other accounts use separate
subdirectories. Each coding host runs
the outbound-polling worker from a Pyash checkout; no inbound SSH, remote tmux
inventory, or second GPU scheduler is used. Configure a distinct worker ID
and token per Unix account. The worker defaults to a stable
`<hostname>-<unix-user>` ID and a `<hostname> (<unix-user>)` label. The hub's
`PYA_DUTY_WORKER_TOKENS` is a semicolon-separated `worker-id=token` list;
`PYA_DUTY_WORKER_USERS` maps each worker ID to its owning Unix account. Keep
both in the web service's secret environment, not in the repository.

On each host, provide a protected environment file to the service manager:

```sh
PYA_DUTY_HUB_URL=https://pyash.zvorygin.ca
PYA_DUTY_WORKER_ID=swac-USER
PYA_DUTY_WORKER_LABEL=swac (USER)
PYA_DUTY_WORKER_TOKEN=<unique-secret>
PYA_DUTY_REPOSITORIES=pyash=/home/USER/src/pyash;website=/home/USER/src/website
PYA_DUTY_STATE_ROOT=/home/USER/.local/state/pyash-duty
PYA_DUTY_HOME_ACCESS=false
```

Repository IDs are the only directory choices advertised to the web UI. Roots
remain private to the authenticated worker protocol. The worker validates each
configured root at startup, advertises a heartbeat, claims only duties assigned
to its ID and allowlist, then synchronizes the same duty session before and
after each mind turn. The worker requires HTTPS away from loopback. Its project
scope roots Pyash tools at the selected directory; setting
`PYA_DUTY_HOME_ACCESS=true` permits opted-in duties to root tools at the Unix
account's home. The hub must separately include that worker ID in
`PYA_DUTY_WORKER_HOME_ACCESS`; neither side alone can enable the option. Run one
worker service per account with a stable unique ID;
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
authenticated reverse proxy. The proxy must strip incoming `X-Pyash-User` and
`X-Pyash-Proxy-Token` headers, then set them from its authenticated account and
a private shared proxy token. Configure `PYA_WEB_PROXY_TOKEN` for both proxy
and web process, `PYA_WEB_AUTH_USERS` as the semicolon-separated map from proxy
login name to Unix account (for example `pyash=htaf`), and
`PYA_WEB_DEFAULT_USER` for the account whose pre-existing assistant history
remains in the original house. Do not enable self-registration. Add a Caddy
login only after the matching Unix account, private user mapping, and separate
worker token/service have been provisioned. Worker API paths may bypass browser
Basic Auth only because the hub verifies their separate per-worker bearer
tokens. User history and workspace paths are application-level partitions;
ordinary web-chat tool calls still execute in the shared web service process.
The live deployment currently maps one login (`pyash`) to one account (`htaf`).
Do not add another login for an untrusted user until web-chat execution is also
dispatched under that user's isolated Unix worker (or an equivalent OS security
boundary). Duty work already runs as the mapped worker account, with that
account's ordinary filesystem permissions and no sudo elevation.

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
the checkout is not `~/pyash`, adjust `WorkingDirectory` in the installed
unit. The template uses a login shell so account-managed Node installations
such as nvm are available to the service.

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
current status, `/permissions` displays the access scope, and
`/permissions project` or `/permissions home` changes an idle duty's scope;
home access requires an explicit typed confirmation. `/accept` records
operator acceptance when the duty is idle, and `/exit` leaves the durable work
untouched. Use the ID shown in the Duty view;
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
