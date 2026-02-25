# WhisperX Service

Optional WhisperX backend for `hear ... become wo srt`.

## Files

- `service/compose.yaml` - WhisperX service definition.
- `service/server.py` - HTTP service that manages a long-lived worker process.
- `service/worker.py` - GPU worker that loads WhisperX models and serves transcribe RPCs.
- `command/begin.sh` - start service.
- `command/stop.sh` - stop service.

## Usage

- Start: `./container/whisperx/command/begin.sh`
- Stop: `./container/whisperx/command/stop.sh`

From inside `pyash`, set:

- `exists su name hear backend default ob text "whisperx" be default ya`
- `exists su name hear host ob text "http://whisperx:8000" be default ya`

Optional diarization token:

- set `HF_TOKEN` in shell environment before starting compose.

## Runtime Model

- The server keeps a dedicated worker process alive after the first `/transcribe`.
- The worker keeps WhisperX model/alignment objects hot in GPU memory for fast follow-up calls.
- `POST /discharge` terminates the worker so CUDA context is released and VRAM can drop back to zero.

## Endpoints

- `GET /health` -> service health.
- `POST /transcribe` -> run one transcription request.
- `POST /discharge` -> stop worker and release GPU memory.

## Streaming Logs

- `POST /transcribe_stream` returns NDJSON events while transcribing:
  - `{"type":"log","text":"..."}`
  - `{"type":"result", ...}` (final success payload)
  - `{"type":"error", ...}` (final error payload)
- Stream events are emitted by the worker and proxied by `server.py` verbatim.
- Worker stdout is serialized (one active worker job at a time) to prevent output interleaving across clients.

Streaming example:

- `curl -N -s http://whisperx:8000/transcribe_stream -H 'Content-Type: application/json' -d '{"input":"/workplace/path/to/audio.wav","output_srt":"/workplace/artifacts/stream.srt","language":"en","model":"large-v3"}'`

Expected stream shape:

- Multiple `type:"log"` lines while work runs (`load_model`, `transcribe`, `align`, `write srt/json`).
- Exactly one terminal line:
  - `type:"result"` on success.
  - `type:"error"` on failure.

Concurrency note:

- A single worker process has one stdout stream, so stream requests are processed one at a time per worker.
- If the client disconnects mid-stream, the server kills the worker to avoid stale GPU jobs.

## Verification

Use service URL from inside the workspace container:

- Health:
  - `curl -s http://whisperx:8000/health`
- Streaming transcription (NDJSON logs + final result):
  - `curl -N -s http://whisperx:8000/transcribe_stream -H 'Content-Type: application/json' -d '{"input":"/workplace/artifacts/20260225-166-teaching-video-from-filename/sections/paragraph-0/audio.wav","output_srt":"/workplace/artifacts/whisperx-stream-test.srt","language":"en","model":"large-v3"}'`
- Discharge:
  - `curl -s -X POST http://whisperx:8000/discharge -H 'Content-Type: application/json' -d '{}'`

Expected behavior:

- First transcribe loads the worker/model; later transcribes reuse hot caches.
- `/discharge` kills the worker process so GPU memory can return to baseline (0 MiB for the WhisperX worker process).
- Pyash discharge shortcut is available via:
  - `./run examples/pyash/discharge-hear-backend.pya`
