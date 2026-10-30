#!/usr/bin/env python3
"""Update Strata's context argument and restart its configured user service."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen


def replace_context_argument(args, context_length):
  updated = list(args) if isinstance(args, list) else []
  indexes = [index for index, value in enumerate(updated) if value == "--max-context"]
  inline = [index for index, value in enumerate(updated) if str(value).startswith("--max-context=")]
  if len(indexes) + len(inline) != 1:
    raise ValueError("Strata profile must contain exactly one --max-context argument")
  if indexes:
    index = indexes[0]
    if index + 1 >= len(updated):
      raise ValueError("Strata --max-context argument has no value")
    updated[index + 1] = str(context_length)
  else:
    index = inline[0]
    updated[index] = f"--max-context={context_length}"
  return updated


def read_context_argument(args):
  indexes = [index for index, value in enumerate(args) if value == "--max-context"]
  inline = [str(value).split("=", 1)[1] for value in args if str(value).startswith("--max-context=")]
  if len(indexes) + len(inline) != 1:
    raise ValueError("Strata profile must contain exactly one --max-context argument")
  if inline:
    return int(inline[0])
  if indexes[0] + 1 >= len(args):
    raise ValueError("Strata --max-context argument has no value")
  return int(args[indexes[0] + 1])


def atomic_write(path, content, mode):
  path = Path(path)
  descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
  try:
    with os.fdopen(descriptor, "wb") as stream:
      stream.write(content)
      stream.flush()
      os.fsync(stream.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, path)
  finally:
    if os.path.exists(temporary):
      os.unlink(temporary)


def update_profile(path, context_length):
  path = Path(path)
  original = path.read_bytes()
  data = json.loads(original.decode("utf-8"))
  if not isinstance(data, dict):
    raise ValueError("Strata profile root must be a JSON object")
  previous_context = read_context_argument(data.get("args", []))
  data["args"] = replace_context_argument(data.get("args"), context_length)
  mode = path.stat().st_mode & 0o777
  updated = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
  atomic_write(path, updated, mode)
  return original, mode, previous_context


def restart(unit):
  result = subprocess.run(
    ["systemctl", "--user", "restart", unit],
    capture_output=True,
    text=True,
    timeout=60,
    check=False
  )
  if result.returncode:
    raise RuntimeError((result.stderr or result.stdout or "systemd restart failed").strip())


def wait_for_context(url, expected, timeout, api_key):
  deadline = time.monotonic() + timeout
  last_error = "Strata API has not reported the requested context yet"
  while time.monotonic() < deadline:
    request = Request(url, headers={"Authorization": f"Bearer {api_key}"} if api_key else {})
    try:
      with urlopen(request, timeout=3) as response:
        status = json.loads(response.read().decode("utf-8"))
      observed = int(status.get("max_context") or 0)
      if observed == expected:
        return
      last_error = f"Strata reports context {observed}, expected {expected}"
    except Exception as error:
      last_error = str(error)
    time.sleep(1)
  raise TimeoutError(last_error)


def reconfigure(path, context_length, unit, health_url, timeout):
  profile = Path(path)
  original, mode, previous_context = update_profile(profile, context_length)
  api_key = os.environ.get("STRATA_API_KEY", "").strip()
  try:
    restart(unit)
    wait_for_context(health_url, context_length, timeout, api_key)
  except Exception as error:
    rollback_error = ""
    try:
      atomic_write(profile, original, mode)
      restart(unit)
      wait_for_context(health_url, previous_context, timeout, api_key)
    except Exception as rollback:
      rollback_error = f"; rollback failed: {rollback}"
    raise RuntimeError(f"Strata context restart failed: {error}{rollback_error}") from error
  return {"success": True, "contextLength": context_length, "unit": unit}


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--config", required=True)
  parser.add_argument("--context", required=True, type=int)
  parser.add_argument("--unit", required=True)
  parser.add_argument("--health-url", required=True)
  parser.add_argument("--timeout", type=int, default=180)
  args = parser.parse_args()
  try:
    result = reconfigure(args.config, args.context, args.unit, args.health_url, args.timeout)
  except Exception as error:
    print(json.dumps({"success": False, "error": str(error)}), flush=True)
    return 1
  print(json.dumps(result), flush=True)
  return 0


if __name__ == "__main__":
  sys.exit(main())
