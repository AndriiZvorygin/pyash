#!/usr/bin/env python3
"""Ask Pyash GPU Housekeeper to prepare VRAM before Strata loads its model."""

import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RELEASE_SETTLE_ERROR = "GPU capacity remains insufficient after safe managed-runtime discharge"
RELEASE_SETTLE_RETRIES = 12
RELEASE_SETTLE_DELAY_SECONDS = 1


def parse_args(argv):
  if "--" in argv:
    split_at = argv.index("--")
    prepare_args = argv[:split_at]
    start_command = argv[split_at + 1:]
    if not start_command:
      raise ValueError("a command is required after --")
  else:
    prepare_args = argv
    start_command = []
  try:
    required_mib = int(prepare_args[0]) if prepare_args else int(os.environ.get("PYASH_STRATA_VRAM_REQUIRED_MIB", "20000"))
  except ValueError as err:
    raise ValueError("VRAM requirement must be a positive integer MiB") from err
  if required_mib <= 0:
    raise ValueError("VRAM requirement must be a positive integer MiB")
  if len(prepare_args) > 1:
    raise ValueError("expected one VRAM requirement before --")
  return required_mib, start_command


def request_capacity(request):
  try:
    with urlopen(request, timeout=110) as response:
      return response.status, json.loads(response.read().decode("utf-8"))
  except HTTPError as err:
    try:
      return err.code, json.loads(err.read().decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
      return err.code, {"error": str(err)}


def main() -> int:
  try:
    required_mib, start_command = parse_args(sys.argv[1:])
  except ValueError as err:
    print(f"strata GPU preparation: {err}", file=sys.stderr)
    return 2

  base_url = os.environ.get("PYASH_GPU_HOUSEKEEPER_URL", "http://127.0.0.1:8090").rstrip("/")
  body = json.dumps({
    "runtimeName": "strata",
    "jobSpec": {"resourceRequest": {"vramRequiredMb": required_mib}}
  }).encode("utf-8")
  request = Request(
    f"{base_url}/capacity/prepare",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST"
  )

  result = None
  for attempt in range(RELEASE_SETTLE_RETRIES + 1):
    try:
      status, result = request_capacity(request)
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as err:
      print(f"strata GPU preparation failed: {err}", file=sys.stderr)
      return 1
    if not isinstance(result, dict):
      print("strata GPU preparation failed: manager returned a non-object response", file=sys.stderr)
      return 1
    error = result.get("error") if isinstance(result, dict) else None
    if result.get("prepared"):
      break
    if status >= 500 and error == RELEASE_SETTLE_ERROR and attempt < RELEASE_SETTLE_RETRIES:
      print("strata GPU preparation: VRAM release is settling; retrying Housekeeper admission", file=sys.stderr)
      time.sleep(RELEASE_SETTLE_DELAY_SECONDS)
      continue
    print(f"strata GPU preparation refused: {error or 'manager did not grant capacity'}", file=sys.stderr)
    return 1

  capacity = result.get("capacity") if isinstance(result.get("capacity"), dict) else {}
  discharged = ",".join(capacity.get("discharged", [])) or "none"
  print(
    f"strata GPU preparation granted on {result.get('deviceId', 'GPU')}; "
    f"decision={capacity.get('decision', 'unknown')}; discharged={discharged}",
    flush=True
  )
  if start_command:
    os.execvp(start_command[0], start_command)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
