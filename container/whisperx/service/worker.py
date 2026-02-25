#!/usr/bin/env python3
import gc
import json
import os
import sys
import traceback
from typing import Any, Dict, Tuple


_MODEL_CACHE: Dict[Tuple[str, str, str], Any] = {}
_ALIGN_CACHE: Dict[Tuple[str, str], Tuple[Any, Any]] = {}


def _fmt_srt_time(seconds: float) -> str:
  if seconds < 0:
    seconds = 0.0
  ms_total = int(round(seconds * 1000.0))
  h = ms_total // 3600000
  ms_total -= h * 3600000
  m = ms_total // 60000
  ms_total -= m * 60000
  s = ms_total // 1000
  ms = ms_total - s * 1000
  return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(path: str, segments: list) -> None:
  lines = []
  idx = 1
  for seg in segments:
    text = str(seg.get("text", "")).strip()
    if text == "":
      continue
    start = float(seg.get("start", 0.0))
    end = float(seg.get("end", 0.0))
    lines.append(str(idx))
    lines.append(f"{_fmt_srt_time(start)} --> {_fmt_srt_time(end)}")
    lines.append(text)
    lines.append("")
    idx += 1
  with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))


def _get_whisper_model(model_name: str, device: str, compute_type: str):
  key = (model_name, device, compute_type)
  model = _MODEL_CACHE.get(key)
  if model is None:
    import whisperx  # type: ignore
    model = whisperx.load_model(model_name, device=device, compute_type=compute_type)
    _MODEL_CACHE[key] = model
  return model


def _get_align(language: str, device: str):
  key = (language, device)
  value = _ALIGN_CACHE.get(key)
  if value is None:
    import whisperx  # type: ignore
    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    value = (align_model, metadata)
    _ALIGN_CACHE[key] = value
  return value


def _torch_discharge() -> None:
  try:
    import torch  # type: ignore
    if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  except Exception:
    pass
  gc.collect()


def _handle_transcribe(req: Dict[str, Any]) -> Dict[str, Any]:
  import whisperx  # type: ignore

  input_path = str(req.get("input") or "").strip()
  if input_path == "":
    return {"ok": False, "code": 400, "error": "input required"}
  if os.path.exists(input_path) is False:
    return {"ok": False, "code": 404, "error": f"input not found: {input_path}"}

  output_dir = str(req.get("output_dir") or "").strip() or "/tmp"
  output_srt = str(req.get("output_srt") or "").strip()
  model = str(req.get("model") or "large-v3")
  language = str(req.get("language") or "en")
  compute_type = str(req.get("compute_type") or "int8")
  device = str(req.get("device") or "cuda").strip() or "cuda"

  os.makedirs(output_dir, exist_ok=True)

  audio = whisperx.load_audio(input_path)
  wx = _get_whisper_model(model, device, compute_type)
  result = wx.transcribe(audio, language=language)

  align_model, metadata = _get_align(language, device)
  result = whisperx.align(result["segments"], align_model, metadata, audio, device)

  stem = os.path.splitext(os.path.basename(input_path))[0]
  generated_srt = os.path.join(output_dir, f"{stem}.srt")
  _write_srt(generated_srt, result.get("segments", []))

  if output_srt:
    os.makedirs(os.path.dirname(output_srt) or ".", exist_ok=True)
    if os.path.abspath(generated_srt) != os.path.abspath(output_srt):
      import shutil
      shutil.copyfile(generated_srt, output_srt)
    final_srt = output_srt
  else:
    final_srt = generated_srt

  generated_json = os.path.join(output_dir, f"{stem}.json")
  try:
    with open(generated_json, "w", encoding="utf-8") as f:
      json.dump(result, f, ensure_ascii=False, indent=2)
  except Exception:
    generated_json = ""

  return {
    "ok": True,
    "code": 200,
    "output_srt": final_srt,
    "output_json": generated_json if (generated_json and os.path.exists(generated_json)) else "",
    "model": model,
    "language": language
  }


def main() -> None:
  for line in sys.stdin:
    line = line.strip()
    if line == "":
      continue
    try:
      req = json.loads(line)
    except Exception:
      sys.stdout.write(json.dumps({"ok": False, "code": 400, "error": "invalid json"}) + "\n")
      sys.stdout.flush()
      continue

    op = str(req.get("op") or "")
    try:
      if op == "transcribe":
        resp = _handle_transcribe(req)
      elif op == "discharge":
        _MODEL_CACHE.clear()
        _ALIGN_CACHE.clear()
        _torch_discharge()
        resp = {"ok": True, "code": 200, "be": "discharge"}
      elif op == "ping":
        resp = {"ok": True, "code": 200, "be": "pong"}
      else:
        resp = {"ok": False, "code": 404, "error": "unknown op"}
    except Exception as err:
      resp = {
        "ok": False,
        "code": 500,
        "error": "worker exception",
        "detail": str(err),
        "trace": traceback.format_exc()[-4000:]
      }

    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
  main()
