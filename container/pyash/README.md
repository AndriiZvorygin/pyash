# Pyash Container

Self-contained assets for the Pyash dev container.

## Main Files

- `Dockerfile`
- `service/compose.yaml`
- `command/build.sh`
- `command/begin.sh`
- `command/restart.sh`
- `tools/update_compose.mjs`
- `building/compose.override.yaml` (generated)

## Usage

- Build: `./container/pyash/command/build.sh`
- Start/enter: `./container/pyash/command/begin.sh`
- Restart: `./container/pyash/command/restart.sh`

`begin.sh` also verifies Python speaker worker prerequisites (`numpy`, `torch`, `torchaudio`, `speechbrain`) and installs speaker compatibility dependencies (`torchcodec`, `huggingface_hub<1.0`) in-container if missing.

Optional publish defaults can be set in `configure/secret.pya` with:
- `container image repo`
- `container image push`
- `container image push latest`

See `documentation/container.md` for full behavior and examples.
