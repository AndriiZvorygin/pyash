# Speaker Identity Service

Optional speaker-identification backend for `be identify ... fromstate wo audio`.

## Files

- `Dockerfile` - pinned CUDA/PyTorch/SpeechBrain runtime
- `service/compose.yaml` - service definition
- `service/compose.gpu.yaml` - optional GPU override (`gpus: all`)
- `service/server.py` - HTTP wrapper around persistent JSONL worker
- `command/begin.sh` - start service
- `command/stop.sh` - stop service

## Usage

- Start: `./container/speaker/command/begin.sh`
- Stop: `./container/speaker/command/stop.sh`

From inside `pyash`, set:

- `exists su name speaker backend default ob text "service" be default ya`
- `exists su name speaker host ob text "http://speaker:8010" be default ya`

For remote instances, point `speaker host` to your remote endpoint (for example `http://gpu-worker-1:8010` or `http://10.0.0.42:8010`).

## Service Variables

Compose supports:

- `SPEAKER_BIND_HOST` (default `::`)
- `SPEAKER_BIND_PORT` (default `8010`)
- `SPEAKER_PUBLISH_PORT` (default `8010`)
- `SPEAKER_VOICES_DIR` (default `/workplace/world/voices`)
- `SPEAKER_TEMP_DIR` (default `/workplace/world/temporary/speaker`)
- `SPEAKER_WORKSPACE` (default `../../..`)

IPv6 notes:
- service bind supports IPv6 host values (for example `::` or `::1`)
- compose network enables IPv6 (`enable_ipv6: true`)

## Endpoints

- `GET /health`
- `POST /identify`
- `POST /enrol`
- `POST /rename`
- `POST /discharge`
- `POST /stop`

All endpoints proxy to `command/speaker_worker.py` and preserve persistent `world/voices` state.
