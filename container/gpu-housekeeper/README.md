# GPU Housekeeper

## Kubernetes GPU worker pilot

The initial heterogeneous-cluster pilot keeps the existing Housekeeper
federation and routing policy, while allowing a worker runtime to be managed
through Kubernetes. The first target is SWAC Ollama; Mriczo remains the
Housekeeper authority and Mac Studio stays a native peer. See the [Kubernetes
GPU Housekeeper pilot guide](kubernetes/README.md) for prerequisites,
least-privilege access, deployment, verification, and rollback. Kubernetes
support is opt-in through the existing runtime registry; non-Kubernetes
profiles keep their current behavior.

## Apple Silicon peer

command/install-macos.sh installs a user-scoped, headless Ollama runtime and
the Pyash Housekeeper on Apple Silicon macOS. It does not use Docker or sudo.
The script downloads the official Ollama macOS bundle into ~/Applications,
then configures Housekeeper to start and supervise the bundled `ollama serve`
process. It prefers a user LaunchAgent; when a headless SSH session has no
usable launchd user domain, it starts Housekeeper detached from the shell and
records its PID under `~/.local/share/pyash-gpu-housekeeper/`. That fallback
survives SSH disconnects, but not a Mac reboot; rerun the installer after
reboot unless the LaunchAgent can be bootstrapped.

Ollama stays bound to 127.0.0.1:11434. Housekeeper is the only peer-facing
service, on port 18886 by default, and identifies this peer as macstudio. Its installer
binds to loopback by default; set GPU_HOUSEKEEPER_BIND_HOST to the specific
trusted overlay address to enable federation. The same manager also listens
on Mac loopback for a trusted SSH tunnel to reach that single manager
instance. Do not bind the unauthenticated Housekeeper API to a public
interface. The native
Housekeeper uses macOS memory_pressure plus physical-memory telemetry and
reserves 8 GiB for macOS and other applications. Its capacity is unified
memory, not dedicated NVIDIA VRAM. The managed Ollama runtime starts with an
8K-token context and one parallel request; Housekeeper applies that context
to warm-load and inference requests unless a job explicitly sets `num_ctx`.
Ollama residency is checked through
/api/ps; idle models are discharged with keep_alive=0 and verified absent
from that endpoint.

Port 18886 is the Housekeeper port. Configure workers and federated peers to
use this port; Linux Compose publishes only this port.

To install or refresh from a checkout on the Mac:

```sh
GPU_HOUSEKEEPER_BIND_HOST=YOUR_TRUSTED_OVERLAY_IP container/gpu-housekeeper/command/install-macos.sh
```

The installer enables Housekeeper model pulling for qwen3.5:9b only. Other
models require deliberately changing the local runtime registry and allowlist.
Logs are written to ~/Library/Logs/pyash-gpu-housekeeper/. The installed
Housekeeper source and observation state live under
~/.local/share/pyash-gpu-housekeeper/; model weights remain in Ollama's
~/.ollama/models.

### Optional Strata runtime on Mac Studio

Strata runs as a separate loopback service on port 8080. The Housekeeper can
start and stop it through the Strata CLI, calls its API directly from macOS,
and admits Strata work only when the configured unified-memory floor is free.
This lets a model hand off safely from idle Ollama instead of loading both
models beside one another. The default Mac profile uses Apple device `apple0`,
an 8K context, and a 50,000 MiB admission floor.

Install Strata's official Terminal CLI, then check the DeepSeek plan before
downloading its weights:

```sh
curl -fsSL https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o /tmp/strata-install.sh
sh /tmp/strata-install.sh
strata launch --family deepseek41 --model ist-das-2.00bpw --context 8192 --vision off --plan --access local --port 8080
```

The Mac Studio has 64 GiB unified memory and needs ample SSD space for the
DeepSeek set. The 2.00 bpw set is the smaller official Mac option. After the
plan confirms available space, register Strata and refresh the Housekeeper:

```sh
GPU_HOUSEKEEPER_BIND_HOST=YOUR_TRUSTED_OVERLAY_IP \
GPU_HOUSEKEEPER_STRATA_RUNTIME_URL=http://127.0.0.1:8080 \
GPU_HOUSEKEEPER_STRATA_MODEL=ist-das-2.00bpw \
GPU_HOUSEKEEPER_STRATA_VRAM_REQUIRED_MB=50000 \
GPU_HOUSEKEEPER_STRATA_ACTION_TIMEOUT_SEC=28800 \
container/gpu-housekeeper/command/install-macos.sh
```

The 2.00 bpw DeepSeek set needs 257 GB of SSD space. A 64 GB Mac meets Strata's
documented minimum, but the published performance measurements are from a
128 GB M5 Max, so expect the Mac Studio's actual speed to differ. Strata's
weights stay in its own user data directory, outside the Pyash checkout. The
startup timeout is configurable through
`GPU_HOUSEKEEPER_STRATA_ACTION_TIMEOUT_SEC`; the example allows up to eight
hours for the initial model and engine download. A `strata` mind request is queued through Housekeeper; Housekeeper
first checks unified-memory capacity, discharges idle Ollama if needed, starts
Strata if its API is down, and loads the model for the request. The API remains
bound to loopback; only the Housekeeper peer is exposed to trusted workers.

Add the Mac as a peer in the GPU Housekeeper host's GPU_HOUSEKEEPER_PEERS
setting, for example:

```text
swac=http://swac:18886;macstudio=http://macstudio:18886
```

The peer hostname must resolve from the Housekeeper host (for this setup, the
existing /etc/hosts mapping provides macstudio). Verify the peer from the
Housekeeper host with `curl http://macstudio:18886/health` and
`curl http://macstudio:18886/snapshot`, then confirm
accelerator.memoryModel is unified, the Ollama runtime is running, and the
available device is apple0.

When the Housekeeper host runs in an IPv4-only Docker bridge and cannot route
to the Mac's overlay IPv6 address, use `command/macstudio-peer-tunnel.sh` as a
user systemd service. It binds SSH forwarding to the Docker default bridge
gateway only and forwards to Mac loopback; do not bind this relay to all host
interfaces. Set the local peer URL to
`macstudio=http://DOCKER_BRIDGE_GATEWAY:18887`. The tunnel requires working
key-based SSH to `ai@macstudio` and can be started by a user service without
sudo. A user unit can use:

```ini
[Unit]
Description=Pyash Housekeeper SSH tunnel to Mac Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%h/pyac/pyash/container/gpu-housekeeper/command/macstudio-peer-tunnel.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

Enable it with `systemctl --user enable --now pyash-macstudio-housekeeper-tunnel.service`.

## NVIDIA hosts

NVIDIA deployments continue to use service/compose.gpu.yaml and CUDA memory
telemetry from nvidia-smi. Apple Silicon support is an opt-in native runtime
profile and does not change the Linux defaults.

## Throughput-aware routing

Federated Housekeepers route to the fastest immediately available host. Live
Ollama generation throughput from at least three successful same-model calls
takes precedence. Until comparable samples exist, configure each host with a
benchmark-derived fallback. The current warm `qwen3.5:9b` Housekeeper results
are:

| Host | Route priority | Prior model | Prior tokens/s |
| --- | ---: | --- | ---: |
| Mriczo RTX 3090 | 300 | `qwen3.5:9b` | 104.5806 |
| Mac Studio M1 Ultra | 200 | `qwen3.5:9b` | 61.1725 |
| SWAC RTX 3060 | 100 | `qwen3.5:9b` | 43.2859 |

Store the corresponding `route priority`, `throughput prior model`, and
`throughput prior tokens per second` fields in each host's `routing.pya` under
its configured `GPU_HOUSEKEEPER_PYA_DIR`. A busy or capacity-blocked host is
skipped so work can run concurrently on the next eligible host; when all hosts
are busy, existing queue behavior is retained. Update priors after re-running
the same benchmark following material model, driver, or power-limit changes.
