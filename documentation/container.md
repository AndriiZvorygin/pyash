# Docker Development Environment

This repo can run inside a container with full build tooling, audio support, and GPU access.
Container assets live under `container/` (Dockerfile, orchestrate file, VNC helper).

## Build the image

```bash
docker build -t pyash-dev -f container/pyash/Dockerfile .
```

## Configure + start

Set container options in `configure/container.pya` (and private overrides in `configure/secret.pya`), then start:

```bash
./container/pyash/command/begin.sh --restart
```

## Run the container (base)

```bash
docker run --rm -it \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

## GPU support (NVIDIA)

Requirements on host:
- NVIDIA driver installed
- NVIDIA Container Toolkit installed

Run:

```bash
docker run --rm -it \
  --gpus all \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

## Audio passthrough (PulseAudio)

On Linux hosts with PulseAudio or PipeWire (Pulse compat), pass the socket and cookie:

```bash
docker run --rm -it \
  --device /dev/snd \
  -e PULSE_SERVER=unix:/run/user/$(id -u)/pulse/native \
  -v /run/user/$(id -u)/pulse:/run/user/$(id -u)/pulse \
  -v ~/.config/pulse/cookie:/root/.config/pulse/cookie \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

Notes:
- `--device /dev/snd` is required for ALSA access.
- If you use PipeWire, Pulse compatibility should still work via the Pulse socket.
- For headless servers, you may need to disable audio tooling or use file-based workflows.

## Headed browser in container (Xvfb + VNC/noVNC)

For sites that block headless browsers, run a headed Chromium under Xvfb and access it via VNC/noVNC.

Start the display stack in the container:

```bash
./container/pyash/command/run_vnc_novnc.sh
```

By default, the container starts with VNC/noVNC enabled (for Playwright and headed browsers).
You can also explicitly enable it:

```bash
./container/pyash/command/begin.sh --vnc
```

To disable VNC/noVNC:

```bash
./container/pyash/command/begin.sh --no-vnc
```

Default ports:
- VNC: `5900`
- noVNC: `6080` (open `http://localhost:6080/vnc.html`)

Config (optional):

```bash
export VNC_PASSWORD=yourpass
export VNC_PORT=5900
export NOVNC_PORT=6080
export SCREEN_RES=1280x800x24
```

Then run Chromium/Playwright/Puppeteer with `DISPLAY=:1`:

```bash
DISPLAY=:1 node your_script.js
```

Notes:
- This is a virtual display; it does not require host X11.
- For audio in the browser, use host PulseAudio passthrough (above) or route audio separately.
- `--vnc` will set `DISPLAY=:1` inside the container.
- Playwright CLI + Chromium are installed in the container (for the Playwright skill). If you need Firefox/WebKit too, run `npx playwright install --with-deps firefox webkit` inside the container.

## X11 passthrough (xdotool / keyboard)

If you need keyboard injection from the container:

```bash
xhost +local:root

docker run --rm -it \
  -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

Notes:
- `hear-stream-keyboard.pya` and `hear-eval-keyboard.pya` require `DISPLAY` and `xdotool`.
- For a headless setup, start Xvfb/noVNC via `./container/pyash/command/run_vnc_novnc.sh` and use `DISPLAY=:1`.

## Ollama (host service)

To connect to Ollama running on the host:

```bash
docker run --rm -it \
  --add-host=host.docker.internal:host-gateway \
  -e OPENAI_BASE_URL=http://host.docker.internal:11434 \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

Then ensure Pyash uses it via `configure/default.pya` or:

```
exists su name openai base url ob text "http://host.docker.internal:11434" be default ya
```

## Android host worker (recommended: shared spool)

For container-first Pyash with a phone attached to the host, prefer a shared spool model:
- container runs your Pyash macros and writes Android envelopes to `world/holding/android/`,
- host runs the Android worker loop and executes local `adb`,
- container reads handle/outcome state from the same shared `world/`.

Start host worker from the same repo checkout:

```bash
npm run android:worker -- --interval-ms 400
```

Run container with the repo mounted (same `world/` path inside container):

```bash
docker run --rm -it \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

Notes:
- this avoids network bridge complexity; host is the only side touching ADB.
- for one-shot host processing use: `npm run android:worker -- --once`.
- worker heartbeat is written in presence format at `world/house/android-host-worker/.presence.pya`.

## Android host bridge (optional fallback)

If you cannot run the host worker loop, you can use HTTP bridge mode (`container -> host ADB`):

```bash
npm run android:bridge -- --host 0.0.0.0 --port 5057 --token "change-me"
```

Container env:

```bash
docker run --rm -it \
  --add-host=host.docker.internal:host-gateway \
  -e PYASH_ANDROID_BRIDGE_URL=http://host.docker.internal:5057 \
  -e PYASH_ANDROID_BRIDGE_TOKEN=change-me \
  -v "$PWD:/workplace" \
  -v "$PWD/minds:/minds" \
  -w /workplace \
  pyash-dev
```

## Docker compose (orchestrate)

```bash
docker compose -f container/pyash/service/compose.yaml up --build
```

The compose service mounts the host Docker socket (`/var/run/docker.sock`) into the Pyash container so in-container agents can build/run sibling containers on the host daemon.

### Build + restart helper

```bash
./container/pyash/command/build.sh [--no-cache] [-- <docker compose build args>]
```

`container/build.sh` is kept as a wrapper to call the command script.

### Optional registry defaults via `configure/secret.pya`

If you want one-command image publishing from any machine, add these facts to `configure/secret.pya`:

```text
su name container image repo ob text "liberit/pyash" ya
su name container image push ob bool truth ya
su name container image push latest ob bool truth ya
```

Behavior:
- When `container image repo` is set and you do not pass `--tag`, buildx tags as `repo:YYYYMMDD`.
- If `container image push latest` is `truth`, it also tags `repo:latest`.
- If `container image push` is `truth` and you do not pass `--push/--load`, it pushes by default.
- If no repo is set, builds stay local and use `pyash-dev`.

CLI flags still win over config:
- `--tag` replaces configured default tags (repeat `--tag` for multiple tags).
- `--push` / `--load` override default push behavior.

## Python ML tooling (optional)

The image includes Python + venv. For Transformers / vLLM or diffusion tooling:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install transformers vllm
```

(Adjust CUDA wheel index for your host driver.)

## What’s included in the image

- Ubuntu 24.04
- docker.io (Docker CLI)
- docker-buildx (`docker buildx`)
- docker-compose-v2 (`docker compose`)
- Node.js 22 LTS
- build-essential, cmake, pkg-config
- python3, venv, pip
- ffmpeg, espeak-ng
- libsdl2-dev, libasound2-dev, libpulse-dev, libsndfile1
- xdotool
- xvfb, x11vnc, novnc, websockify, fluxbox
- ripgrep, jq

## Common workflows

```bash
npm test
./run examples/pyash/re-entry-cycle-fixture.pya --full
```

## Notes

- Large binaries and downloads should stay under `caterer/` and be git-ignored as usual.
- If you want Ollama inside the container later, add it as a separate service or layer.
