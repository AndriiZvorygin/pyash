#!/usr/bin/env python3
import argparse
import datetime as dt
import gc
import json
import re
import shutil
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np
try:
    import torch
except Exception as err:  # pragma: no cover
    torch = None
    _TORCH_IMPORT_ERROR = err
else:
    _TORCH_IMPORT_ERROR = None

try:
    import torchaudio  # type: ignore
except Exception:
    torchaudio = None
else:
    if not hasattr(torchaudio, "list_audio_backends"):
        def _list_audio_backends():
            return []
        torchaudio.list_audio_backends = _list_audio_backends  # type: ignore[attr-defined]
    if not hasattr(torchaudio, "set_audio_backend"):
        def _set_audio_backend(_name):
            return None
        torchaudio.set_audio_backend = _set_audio_backend  # type: ignore[attr-defined]

try:
    from speechbrain.inference.speaker import SpeakerRecognition
except Exception as err:  # pragma: no cover
    SpeakerRecognition = None
    _IMPORT_ERROR = err
else:
    _IMPORT_ERROR = None


DEFAULT_VOICES_DIR = "./world/voices"
DEFAULT_TEMP_DIR = "./world/temporary/speaker"
DEFAULT_CLIP_SECONDS = 10.0
DEFAULT_SAME_SPEAKER_THRESHOLD = 0.72
DEFAULT_KNOWN_SPEAKER_THRESHOLD = 0.68


@dataclass
class SpeakerRecord:
    key: str
    embedding: np.ndarray
    metadata: Dict


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_name(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip())
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "speaker"


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a64 = a.astype(np.float64, copy=False)
    b64 = b.astype(np.float64, copy=False)
    denom = np.linalg.norm(a64) * np.linalg.norm(b64)
    if denom <= 0.0:
        return -1.0
    return float(np.dot(a64, b64) / denom)


class SpeakerWorker:
    def __init__(self, voices_dir: str, temp_dir: str):
        self.default_voices_dir = Path(voices_dir)
        self.temp_dir = Path(temp_dir)
        self.model = None

        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_voices_dir(self.default_voices_dir)

    @staticmethod
    def _index_path(root: Path) -> Path:
        return root / "index.json"

    @staticmethod
    def _npy_path(root: Path, key: str) -> Path:
        return root / f"{key}.npy"

    @staticmethod
    def _json_path(root: Path, key: str) -> Path:
        return root / f"{key}.json"

    def _resolve_voices_dir(self, voices_dir: Optional[str]) -> Path:
        root = Path(voices_dir) if voices_dir else self.default_voices_dir
        self._ensure_voices_dir(root)
        return root

    def _ensure_voices_dir(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        index_path = self._index_path(root)
        if index_path.exists():
            try:
                payload = json.loads(index_path.read_text(encoding="utf-8"))
                if isinstance(payload, dict) and isinstance(payload.get("next_speaker_id"), int):
                    return
            except Exception:
                pass
        self._write_json(index_path, {"next_speaker_id": 1})

    def _load_index(self, root: Path) -> Dict:
        payload = json.loads(self._index_path(root).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("voices index malformed")
        next_id = payload.get("next_speaker_id")
        if not isinstance(next_id, int) or next_id < 1:
            payload["next_speaker_id"] = 1
        return payload

    def _save_index(self, root: Path, payload: Dict):
        self._write_json(self._index_path(root), payload)

    @staticmethod
    def _write_json(path: Path, payload: Dict):
        text = json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
        path.write_text(text, encoding="utf-8")

    @staticmethod
    def _assert_wav(audio: str):
        if not audio:
            raise RuntimeError("audio missing")
        src = Path(audio)
        if src.suffix.lower() != ".wav":
            raise RuntimeError("wav input only")
        if not src.exists() or not src.is_file():
            raise RuntimeError(f"audio missing: {src}")

    def _stage_audio(self, audio: str, req_id: str) -> Path:
        src = Path(audio)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        staged = self.temp_dir / f"req_{safe_name(str(req_id))}_{stamp}.wav"
        shutil.copy2(src, staged)
        return staged

    def _load_model(self):
        if self.model is not None:
            return
        if torch is None:
            raise RuntimeError(f"torch unavailable: {_TORCH_IMPORT_ERROR}")
        if SpeakerRecognition is None:
            raise RuntimeError(f"speechbrain unavailable: {_IMPORT_ERROR}")
        run_opts = {"device": "cuda" if torch.cuda.is_available() else "cpu"}
        self.model = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(self.temp_dir / "speechbrain-ecapa"),
            run_opts=run_opts,
        )

    def _embed_audio(self, audio: str, req_id: str, clip_seconds: float = DEFAULT_CLIP_SECONDS) -> np.ndarray:
        self._assert_wav(audio)
        self._load_model()
        staged = self._stage_audio(audio, req_id)
        try:
            emb = None
            if hasattr(self.model, "encode_batch"):
                wav = self._load_wav_tensor(str(staged), target_sample_rate=16000)
                clip_samples = int(max(0.0, float(clip_seconds)) * 16000.0)
                if clip_samples > 0 and wav.shape[-1] > clip_samples:
                    wav = wav[:clip_samples]
                wav = wav.unsqueeze(0)
                emb = self.model.encode_batch(wav, normalize=False)
            elif hasattr(self.model, "encode_file"):
                emb = self.model.encode_file(str(staged))
            if emb is None:
                raise RuntimeError("embedding failed")
            arr = emb.detach().to("cpu").numpy().astype(np.float32).reshape(-1)
            if arr.size == 0:
                raise RuntimeError("empty embedding")
            return arr
        finally:
            try:
                staged.unlink(missing_ok=True)
            except Exception:
                pass

    @staticmethod
    def _load_wav_tensor(path: str, target_sample_rate: int = 16000):
        if torch is None:
            raise RuntimeError("torch unavailable for wav tensor load")
        with wave.open(path, "rb") as reader:
            channels = int(reader.getnchannels())
            sample_width = int(reader.getsampwidth())
            sample_rate = int(reader.getframerate())
            frame_count = int(reader.getnframes())
            pcm = reader.readframes(frame_count)

        if sample_width == 1:
            audio = np.frombuffer(pcm, dtype=np.uint8).astype(np.float32)
            audio = (audio - 128.0) / 128.0
        elif sample_width == 2:
            audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        elif sample_width == 4:
            audio = np.frombuffer(pcm, dtype=np.int32).astype(np.float32) / 2147483648.0
        else:
            raise RuntimeError(f"unsupported wav sample width: {sample_width}")

        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)

        wav = torch.from_numpy(audio)
        if sample_rate != target_sample_rate:
            import torch.nn.functional as F
            wav3 = wav.unsqueeze(0).unsqueeze(0)
            new_len = max(1, int(round(wav3.shape[-1] * float(target_sample_rate) / float(sample_rate))))
            wav = F.interpolate(wav3, size=new_len, mode="linear", align_corners=False).squeeze(0).squeeze(0)

        return wav.float()

    def _list_speakers(self, root: Path) -> Dict[str, SpeakerRecord]:
        root.mkdir(parents=True, exist_ok=True)
        out: Dict[str, SpeakerRecord] = {}
        for npy_path in sorted(root.glob("*.npy")):
            key = npy_path.stem
            json_path = self._json_path(root, key)
            metadata = {}
            if json_path.exists():
                try:
                    metadata = json.loads(json_path.read_text(encoding="utf-8"))
                except Exception:
                    metadata = {}
            try:
                embedding = np.load(npy_path).astype(np.float32).reshape(-1)
            except Exception:
                continue
            if embedding.size == 0:
                continue
            out[key] = SpeakerRecord(key=key, embedding=embedding, metadata=metadata)
        return out

    def _new_speaker_id(self, root: Path) -> str:
        index = self._load_index(root)
        next_id = int(index.get("next_speaker_id", 1))
        key = f"speaker_{next_id:03d}"
        index["next_speaker_id"] = next_id + 1
        self._save_index(root, index)
        return key

    def _persist_speaker(self, root: Path, key: str, embedding: np.ndarray, metadata: Dict):
        np.save(self._npy_path(root, key), embedding.astype(np.float32))
        self._write_json(self._json_path(root, key), metadata)

    def _update_centroid(self, root: Path, key: str, sample: np.ndarray) -> Dict:
        records = self._list_speakers(root)
        record = records.get(key)
        if record is None:
            raise RuntimeError(f"speaker missing: {key}")

        old = record.embedding
        meta = dict(record.metadata or {})
        count = int(meta.get("sample_count", 1))
        new_count = count + 1
        new_centroid = ((old * count) + sample) / float(new_count)

        now = utc_now_iso()
        meta["speaker"] = key
        meta.setdefault("created_at", now)
        meta["updated_at"] = now
        meta["sample_count"] = new_count
        meta.setdefault("name", key)

        self._persist_speaker(root, key, new_centroid, meta)
        return meta

    def command_identify(self, req_id, payload: Dict) -> Dict:
        audio = payload.get("audio")
        prev = payload.get("prev_speaker") or payload.get("prevSpeaker")
        root = self._resolve_voices_dir(payload.get("voices_dir") or payload.get("voicesDir"))
        same_thr = float(payload.get("same_speaker_threshold", DEFAULT_SAME_SPEAKER_THRESHOLD))
        known_thr = float(payload.get("known_speaker_threshold", DEFAULT_KNOWN_SPEAKER_THRESHOLD))
        clip_seconds = float(payload.get("clip_seconds", DEFAULT_CLIP_SECONDS))

        emb = self._embed_audio(audio, req_id, clip_seconds=clip_seconds)
        records = self._list_speakers(root)

        if prev and prev in records:
            sim_prev = cosine_similarity(emb, records[prev].embedding)
            if sim_prev >= same_thr:
                meta = self._update_centroid(root, prev, emb)
                return {
                    "speaker": prev,
                    "matched": "prev",
                    "similarity": sim_prev,
                    "threshold": same_thr,
                    "sample_count": int(meta.get("sample_count", 1)),
                }

        best_key = None
        best_sim = -1.0
        for key, record in records.items():
            score = cosine_similarity(emb, record.embedding)
            if score > best_sim:
                best_sim = score
                best_key = key

        if best_key and best_sim >= known_thr:
            meta = self._update_centroid(root, best_key, emb)
            return {
                "speaker": best_key,
                "matched": "known",
                "similarity": best_sim,
                "threshold": known_thr,
                "sample_count": int(meta.get("sample_count", 1)),
            }

        key = self._new_speaker_id(root)
        now = utc_now_iso()
        metadata = {
            "speaker": key,
            "name": key,
            "created_at": now,
            "updated_at": now,
            "sample_count": 1,
            "origin": "identify",
        }
        self._persist_speaker(root, key, emb, metadata)
        return {
            "speaker": key,
            "matched": "new",
            "similarity": best_sim,
            "threshold": known_thr,
            "sample_count": 1,
        }

    def command_enrol(self, req_id, payload: Dict) -> Dict:
        audio = payload.get("audio")
        name = payload.get("name")
        root = self._resolve_voices_dir(payload.get("voices_dir") or payload.get("voicesDir"))
        clip_seconds = float(payload.get("clip_seconds", DEFAULT_CLIP_SECONDS))

        if not isinstance(name, str) or not name.strip():
            raise RuntimeError("name missing")
        key = safe_name(name)

        emb = self._embed_audio(audio, req_id, clip_seconds=clip_seconds)
        records = self._list_speakers(root)

        now = utc_now_iso()
        if key in records:
            meta = self._update_centroid(root, key, emb)
            meta["name"] = name.strip()
            updated = self._list_speakers(root)[key].embedding
            self._persist_speaker(root, key, updated, meta)
            return {"speaker": key, "action": "updated", "sample_count": int(meta.get("sample_count", 1))}

        metadata = {
            "speaker": key,
            "name": name.strip(),
            "created_at": now,
            "updated_at": now,
            "sample_count": 1,
            "origin": "enrol",
        }
        self._persist_speaker(root, key, emb, metadata)
        return {"speaker": key, "action": "created", "sample_count": 1}

    def command_rename(self, payload: Dict) -> Dict:
        root = self._resolve_voices_dir(payload.get("voices_dir") or payload.get("voicesDir"))
        old = safe_name(payload.get("from", ""))
        new = safe_name(payload.get("to", ""))
        if not old or not new:
            raise RuntimeError("rename requires from and to")
        if old == new:
            return {"speaker": new, "action": "noop"}

        old_npy = self._npy_path(root, old)
        old_json = self._json_path(root, old)
        new_npy = self._npy_path(root, new)
        new_json = self._json_path(root, new)
        if not old_npy.exists():
            raise RuntimeError(f"speaker missing: {old}")
        if new_npy.exists() or new_json.exists():
            raise RuntimeError(f"target exists: {new}")

        old_npy.rename(new_npy)
        metadata = {}
        if old_json.exists():
            metadata = json.loads(old_json.read_text(encoding="utf-8"))
            old_json.unlink(missing_ok=True)
        now = utc_now_iso()
        metadata["speaker"] = new
        metadata.setdefault("created_at", now)
        metadata["updated_at"] = now
        metadata["name"] = new
        self._write_json(new_json, metadata)
        return {"speaker": new, "action": "renamed", "from": old}

    def command_discharge(self) -> Dict:
        had_model = self.model is not None
        if self.model is not None:
            try:
                if hasattr(self.model, "mods") and hasattr(self.model.mods, "to"):
                    self.model.mods.to("cpu")
            except Exception:
                pass
            try:
                del self.model
            except Exception:
                pass
            self.model = None

        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"discharged": bool(had_model), "alive": True}

    def command_stop(self) -> Dict:
        self.command_discharge()
        return {"stopped": True}

    def handle(self, req: Dict) -> Tuple[Dict, bool]:
        req_id = req.get("id")
        command = str(req.get("command") or "").strip().lower()
        payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
        if req_id is None:
            raise RuntimeError("id missing")
        if command not in {"identify", "enrol", "rename", "discharge", "stop"}:
            raise RuntimeError(f"unknown command: {command}")

        if command == "identify":
            data = self.command_identify(req_id, payload)
            return ({"id": req_id, "ok": True, "command": command, "result": data}, False)
        if command == "enrol":
            data = self.command_enrol(req_id, payload)
            return ({"id": req_id, "ok": True, "command": command, "result": data}, False)
        if command == "rename":
            data = self.command_rename(payload)
            return ({"id": req_id, "ok": True, "command": command, "result": data}, False)
        if command == "discharge":
            data = self.command_discharge()
            return ({"id": req_id, "ok": True, "command": command, "result": data}, False)

        data = self.command_stop()
        return ({"id": req_id, "ok": True, "command": command, "result": data}, True)


def emit(response: Dict):
    sys.stdout.write(json.dumps(response, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def emit_error(req_id, command, message: str):
    emit({
        "id": req_id,
        "ok": False,
        "command": command,
        "error": {"message": str(message)},
    })


def main() -> int:
    parser = argparse.ArgumentParser(description="Persistent speaker identification worker")
    parser.add_argument("--voices-dir", default=DEFAULT_VOICES_DIR)
    parser.add_argument("--temp-dir", default=DEFAULT_TEMP_DIR)
    args = parser.parse_args()

    worker = SpeakerWorker(args.voices_dir, args.temp_dir)

    should_stop = False
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue

        req_id = None
        command = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            command = req.get("command")
            response, should_stop = worker.handle(req)
            emit(response)
        except Exception as err:
            emit_error(req_id, command, str(err))

        if should_stop:
            break

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
