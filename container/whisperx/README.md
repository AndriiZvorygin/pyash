# WhisperX Service

Optional WhisperX backend for `hear ... become wo srt`.

## Files

- `service/compose.yaml` - WhisperX service definition.
- `service/server.py` - thin HTTP wrapper over WhisperX CLI.
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
