"""Raw, authenticated PyAC pack framing for Housekeeper uploads."""

import hashlib
import hmac
import json
import os
import struct
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

PACK_MAGIC = b"PYACVLIW"
PACK_HEADER_BYTES = 32
CODELET_BYTES = 32
MAX_PACK_BYTES = 16 * 1024 * 1024
TEXT_QUOTE = 0x0e1d
UINT_VECTOR_QUOTE_MASK = 0x001f
IDENTITY_WORD = 0xc898
NAME_TYPE_WORD = 0x225e
CASE_WORDS = {
  "su": 0x24de,
  "ob": 0x245e,
  "from": 0x313e,
  "to": 0x243e,
  "at": 0x615f,
  "by": 0x287e,
  "with": 0x490f,
}
HANDSHAKE_WORD = 0x11d0
DEONTIC_MOOD_WORD = 0x295e


class PyacWireError(ValueError):
  pass


def unpack_frame(data: bytes, offset: int = 0) -> Tuple[bytes, int]:
  if offset < 0 or len(data) - offset < PACK_HEADER_BYTES:
    raise PyacWireError("PyAC frame header is truncated")
  header = data[offset:offset + PACK_HEADER_BYTES]
  if header[:8] != PACK_MAGIC:
    raise PyacWireError("PyAC frame magic is invalid")
  version, word_bits, words_per_codelet, header_bytes = struct.unpack_from("<HHHH", header, 8)
  count, codelet_bytes, total_bytes, reserved = struct.unpack_from("<IIII", header, 16)
  if (version, word_bits, words_per_codelet, header_bytes, codelet_bytes, reserved) != (1, 16, 16, 32, 32, 0):
    raise PyacWireError("PyAC frame layout is unsupported")
  expected = PACK_HEADER_BYTES + count * CODELET_BYTES
  if count == 0 or total_bytes != expected or expected > MAX_PACK_BYTES:
    raise PyacWireError("PyAC frame declared length is invalid")
  end = offset + expected
  if end > len(data):
    raise PyacWireError("PyAC frame payload is truncated")
  return data[offset:end], end


def flatten_indexed_sentence(pack: bytes) -> List[int]:
  count = struct.unpack_from("<I", pack, 16)[0]
  words: List[int] = []
  for codelet_index in range(count):
    offset = PACK_HEADER_BYTES + codelet_index * CODELET_BYTES
    codelet = struct.unpack_from("<16H", pack, offset)
    header = codelet[0]
    complete = bool(header & 1)
    boundaries = [slot for slot in range(1, 16) if bool(header & (1 << slot)) == complete]
    last_slot = max(boundaries, default=0) if complete else 15
    if complete and last_slot == 0:
      raise PyacWireError("Pyash handshake has an invalid final codelet index")
    words.extend(codelet[1:last_slot + 1])
    if complete:
      if codelet_index != count - 1:
        raise PyacWireError("Pyash handshake pack contains trailing codelets")
      return words
  raise PyacWireError("Pyash handshake has no final codelet")


class TokenReader:
  def __init__(self, words: List[int]) -> None:
    self.words = words
    self.offset = 0

  def take(self) -> int:
    if self.offset >= len(self.words):
      raise PyacWireError("Pyash handshake sentence is truncated")
    value = self.words[self.offset]
    self.offset += 1
    return value

  def expect(self, value: int) -> None:
    if self.take() != value:
      raise PyacWireError("Pyash handshake sentence has an unexpected signature")

  def text(self) -> str:
    self.expect(TEXT_QUOTE)
    length = self.take()
    if length < 1 or length >= 15:
      raise PyacWireError("Pyash handshake text fields must fit one indexed quote")
    values = [self.take() for _ in range(length)]
    if any(value > 0x7f for value in values):
      raise PyacWireError("Pyash handshake identity fields must be ASCII")
    return bytes(values).decode("ascii")

  def uint_vector(self, expected_length: int) -> List[int]:
    header = self.take()
    if (header & UINT_VECTOR_QUOTE_MASK) != 0x001d or ((header >> 13) & 7) != 4 or ((header >> 11) & 3) != 1:
      raise PyacWireError("Pyash handshake requires uint16 vector quotes")
    thickness = (header >> 8) & 7
    if thickness == 6:
      length = self.take()
    else:
      length = {0: 1, 1: 2, 2: 4, 3: 8, 4: 16, 7: 3}.get(thickness, 0)
    if length != expected_length:
      raise PyacWireError("Pyash handshake vector has an invalid lane count")
    return [self.take() for _ in range(length)]


def parse_handshake(pack: bytes) -> Dict[str, Any]:
  words = flatten_indexed_sentence(pack)
  reader = TokenReader(words)
  reader.expect(NAME_TYPE_WORD)
  reader.expect(IDENTITY_WORD)
  reader.expect(CASE_WORDS["su"])
  username = reader.text()
  reader.expect(CASE_WORDS["ob"])
  host_id = reader.text()
  reader.expect(CASE_WORDS["from"])
  handle_id = reader.text()
  reader.expect(CASE_WORDS["to"])
  nonce_words = reader.uint_vector(8)
  reader.expect(CASE_WORDS["at"])
  hmac_words = reader.uint_vector(16)
  reader.expect(CASE_WORDS["by"])
  digest_words = reader.uint_vector(16)
  reader.expect(CASE_WORDS["with"])
  reader.expect(HANDSHAKE_WORD)
  reader.expect(DEONTIC_MOOD_WORD)
  if reader.offset != len(words):
    raise PyacWireError("Pyash handshake sentence has trailing tokens")
  for value, label in ((username, "username"), (host_id, "host id"), (handle_id, "handle id")):
    if not value or len(value) > 14 or any(ord(char) < 0x21 or ord(char) > 0x7e for char in value):
      raise PyacWireError(f"Pyash handshake {label} is invalid")
  nonce = struct.pack("<8H", *nonce_words)
  digest = struct.pack("<16H", *digest_words)
  signature = struct.pack("<16H", *hmac_words)
  return {
    "username": username,
    "hostId": host_id,
    "handleId": handle_id,
    "nonce": nonce,
    "digest": digest,
    "signature": signature,
  }


def signed_message(identity: Dict[str, Any]) -> bytes:
  return b"\0".join((
    b"pyac-vliw-upload-v1",
    identity["username"].encode("ascii"),
    identity["hostId"].encode("ascii"),
    identity["nonce"].hex().encode("ascii"),
    identity["handleId"].encode("ascii"),
    identity["digest"].hex().encode("ascii"),
  ))


def verify_upload_stream(data: bytes, secret: str) -> Tuple[Dict[str, Any], bytes]:
  auth_pack, job_start = unpack_frame(data)
  job_pack, end = unpack_frame(data, job_start)
  if end != len(data):
    raise PyacWireError("PyAC upload has trailing bytes after its two packs")
  identity = parse_handshake(auth_pack)
  if not hmac.compare_digest(hashlib.sha256(job_pack).digest(), identity["digest"]):
    raise PyacWireError("PyAC upload authentication failed")
  expected = hmac.new(secret.encode("utf-8"), signed_message(identity), hashlib.sha256).digest()
  if not hmac.compare_digest(expected, identity["signature"]):
    raise PyacWireError("PyAC upload authentication failed")
  return identity, job_pack


def load_shared_secret() -> str:
  path = Path(os.environ.get("GPU_HOUSEKEEPER_SECRET_PYA_PATH", "/run/pyash/configure/secret.pya"))
  try:
    lines = path.read_text(encoding="utf-8").splitlines()
  except OSError as error:
    raise PyacWireError("Housekeeper PyAC authentication key is not configured") from error
  prefix = 'exists su name gpu authentication key ob text '
  matches = []
  for line in lines:
    normalized = line.strip()
    if not normalized.startswith(prefix) or not normalized.endswith(" be text ya"):
      continue
    raw = normalized[len(prefix):-len(" be text ya")].strip()
    try:
      value = json.loads(raw)
    except json.JSONDecodeError as error:
      raise PyacWireError("Housekeeper PyAC authentication key sentence is malformed") from error
    if not isinstance(value, str) or not value:
      raise PyacWireError("Housekeeper PyAC authentication key must be non-empty text")
    matches.append(value)
  if len(matches) != 1:
    raise PyacWireError("Housekeeper PyAC authentication key must be configured exactly once")
  return matches[0]


def persist_pack(root: Path, pack: bytes) -> str:
  digest = hashlib.sha256(pack).hexdigest()
  directory = root / "pyac-packs"
  directory.mkdir(parents=True, exist_ok=True, mode=0o700)
  target = directory / f"{digest}.pyac"
  if target.exists():
    if target.read_bytes() != pack:
      raise PyacWireError("content-addressed PyAC file does not match its digest")
    return f"pyac-packs/{target.name}"
  temporary = None
  try:
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".upload-", delete=False) as stream:
      temporary = Path(stream.name)
      os.chmod(temporary, 0o600)
      stream.write(pack)
      stream.flush()
      os.fsync(stream.fileno())
    try:
      os.link(temporary, target)
    except FileExistsError:
      if target.read_bytes() != pack:
        raise PyacWireError("content-addressed PyAC file does not match its digest")
    directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
      os.fsync(directory_fd)
    finally:
      os.close(directory_fd)
  finally:
    if temporary is not None:
      temporary.unlink(missing_ok=True)
  return f"pyac-packs/{target.name}"


def read_persisted_pack(root: Path, reference: str) -> bytes:
  relative = Path(reference)
  if relative.is_absolute() or len(relative.parts) != 2 or relative.parts[0] != "pyac-packs":
    raise PyacWireError("durable PyAC pack reference is invalid")
  directory = (root / "pyac-packs").resolve()
  target = (root / relative).resolve()
  if target.parent != directory or target.suffix != ".pyac":
    raise PyacWireError("durable PyAC pack reference escapes its storage directory")
  try:
    pack = target.read_bytes()
  except OSError as error:
    raise PyacWireError("durable PyAC pack file is unavailable") from error
  unpack_frame(pack)
  if len(pack) > MAX_PACK_BYTES:
    raise PyacWireError("durable PyAC pack exceeds the Housekeeper limit")
  return pack
