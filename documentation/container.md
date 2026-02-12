# Docker Development Environment

This repo can run inside a container with full build tooling, audio support, and GPU access.
Container assets live under `container/` (Dockerfile, orchestrate file, VNC helper).

## Build the image

```bash
docker build -t pyash-dev -f container/Dockerfile .
```

## Configure + start

Set container options in `configure/container.pya` (and private overrides in `configure/secret.pya`), then start:

```bash
./container/command/begin.sh --restart
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
./container/command/run_vnc_novnc.sh
```

By default, the container starts with VNC/noVNC enabled (for Playwright and headed browsers).
You can also explicitly enable it:

```bash
./container/command/begin.sh --vnc
```

To disable VNC/noVNC:

```bash
./container/command/begin.sh --no-vnc
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
- For a headless setup, start Xvfb/noVNC via `./container/command/run_vnc_novnc.sh` and use `DISPLAY=:1`.

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

## Docker compose (orchestrate)

```bash
docker compose -f container/service/pyash.yaml up --build
```

### Build + restart helper

```bash
./container/command/build.sh [--no-cache] [-- <docker compose build args>]
```

`container/build.sh` is kept as a wrapper to call the command script.

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
