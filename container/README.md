# Container Layout

Each container now lives in its own self-contained folder.

## Folders

- `container/pyash/`: Pyash development container (Dockerfile, compose, scripts, generated override, minds).
- `container/searxng/`: SearXNG + Redis container (compose, settings, scripts, env).
- `container/whisperx/`: WhisperX transcription service (compose, API wrapper, scripts, cache).

## Standalone Git Projects

You can initialize and publish either subtree independently:

- `container/pyash/`
- `container/searxng/`
- `container/whisperx/`

## Compatibility Wrappers

Legacy entrypoints remain in `container/command/` and `container/build.sh`, forwarding to `container/pyash/command/`.
