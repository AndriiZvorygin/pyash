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
