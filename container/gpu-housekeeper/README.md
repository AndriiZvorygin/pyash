# GPU Housekeeper

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
