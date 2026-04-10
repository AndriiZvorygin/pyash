# Speaker Worker Protocol

This worker uses line-delimited JSON (JSONL) over stdin/stdout.

- stdin: one JSON object per line request
- stdout: one JSON object per line response
- stderr: optional human logs/errors

Stdout must stay machine-readable JSONL only.

## Worker process

- Python entrypoint: `command/speaker_worker.py`
- Default persistent signatures directory: `./world/voices/`
- Default temporary audio directory: `./world/temporary/speaker/`
- Input audio format: WAV only

The worker is persistent. It loads the ECAPA model lazily on first inference command.

## Deployment contract (spec)

- Diarization must use global voices directly (`/home/htaf/pyash/world/voices`).
- Per-meeting isolated voice paths are forbidden.
- Reseed/copy voice-cache workflows are forbidden.
- Local speaker worker mode is forbidden for production meeting runs.
- `PYA_SPEAKER_HOST` must point to the remote speaker service (mriczo).

## Request shape

```json
{"id":1,"command":"identify","payload":{"audio":"/abs/or/rel/file.wav","prev_speaker":"speaker_001","voices_dir":"./world/voices"}}
```

Fields:
- `id` (required): caller-chosen request id
- `command` (required): `identify | enrol | rename | discharge | stop`
- `payload` (optional): command data object

## Response shape

Success:

```json
{"id":1,"ok":true,"command":"identify","result":{"speaker":"speaker_001","matched":"known","similarity":0.81,"threshold":0.68,"sample_count":5}}
```

Error:

```json
{"id":1,"ok":false,"command":"identify","error":{"message":"wav input only"}}
```

## Commands

### `identify`

Payload:
- `audio` (required): WAV path
- `prev_speaker` (optional)
- `voices_dir` (optional, default `./world/voices`)
- `same_speaker_threshold` (optional, default `0.72`)
- `known_speaker_threshold` (optional, default `0.68`)

Behavior:
1. Embed current slice with SpeechBrain ECAPA.
2. If `prev_speaker` exists, compare first.
3. If prev similarity >= same-speaker threshold, reuse `prev_speaker`.
4. Else compare against all enrolled centroids in `voices_dir`.
5. If best enrolled similarity >= known-speaker threshold, assign known speaker.
6. Else create new `speaker_NNN` using `voices_dir/index.pya` `next_speaker_id`.
7. When a known/prev speaker is accepted, update centroid and `sample_count`.

### `enrol`

Payload:
- `audio` (required): WAV path
- `name` (required): speaker key/name (sanitized to `[A-Za-z0-9_-]`)
- `voices_dir` (optional)

Behavior:
- If speaker exists, update centroid and metadata.
- If speaker does not exist, create `.npy` + `.pya` sidecar.

### `rename`

Payload:
- `from` (required)
- `to` (required)
- `voices_dir` (optional)

Behavior:
- Renames `<from>.npy/.pya` to `<to>.npy/.pya` (legacy `.json` sidecars are read for compatibility).
- Updates metadata `speaker`, `name`, `updated_at`.

### `discharge`

Payload: none.

Behavior:
- Move model modules to CPU (best effort).
- Drop live model references.
- Run `gc.collect()`.
- Run `torch.cuda.empty_cache()` when CUDA is available.
- Keep worker alive for future commands.

### `stop`

Payload: none.

Behavior:
- Performs `discharge` steps.
- Returns success and exits process cleanly.

## Persistent storage

For each speaker key `<speaker>` in `voices_dir`:
- centroid embedding: `<speaker>.npy` (float32)
- metadata sidecar: `<speaker>.pya` (Pyash map sentence file)

Global index in `voices_dir`:
- `index.pya` with:
  - `next_speaker_id` (int)

## Node runner API

`command/speaker_runner.mjs` exports:
- `ensureStarted()`
- `identify({ audio, prevSpeaker, voicesDir })`
- `enrol({ audio, name, voicesDir })`
- `rename({ from, to, voicesDir })`
- `discharge()`
- `stop()`

It keeps one persistent worker child process, assigns request ids, queues pending promises by id, and resolves them from stdout JSONL lines.
