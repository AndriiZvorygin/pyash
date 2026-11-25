import hashlib
import hmac
import os
import struct
import tempfile
import unittest
from pathlib import Path

import pyac_wire


def pack_frame(codelets):
  body = b"".join(struct.pack("<16H", *codelet) for codelet in codelets)
  header = struct.pack("<8sHHHHIIII", b"PYACVLIW", 1, 16, 16, 32, len(codelets), 32, 32 + len(body), 0)
  return header + body


def auth_pack(username, host_id, handle_id, nonce, digest, secret):
  tokens = []
  boundaries = set()

  def add_value(value, case):
    tokens.extend(value)
    tokens.append(case)
    boundaries.add(len(tokens))

  def text(value):
    chars = [ord(char) for char in value]
    return [pyac_wire.TEXT_QUOTE, len(chars), *chars]

  def vector(value):
    return [0x8b1d if len(value) == 8 else 0x8c1d, *value]

  nonce_words = list(struct.unpack("<8H", nonce))
  digest_words = list(struct.unpack("<16H", digest))
  nonce_hex = nonce.hex()
  digest_hex = digest.hex()
  identity = {
    "username": username,
    "hostId": host_id,
    "handleId": handle_id,
    "nonce": nonce,
    "digest": digest,
  }
  signature = hmac.new(secret.encode(), pyac_wire.signed_message(identity), hashlib.sha256).digest()
  hmac_words = list(struct.unpack("<16H", signature))
  add_value([pyac_wire.NAME_TYPE_WORD, pyac_wire.IDENTITY_WORD], pyac_wire.CASE_WORDS["su"])
  add_value(text(username), pyac_wire.CASE_WORDS["ob"])
  add_value(text(host_id), pyac_wire.CASE_WORDS["from"])
  add_value(text(handle_id), pyac_wire.CASE_WORDS["to"])
  add_value(vector(nonce_words), pyac_wire.CASE_WORDS["at"])
  add_value(vector(hmac_words), pyac_wire.CASE_WORDS["by"])
  add_value(vector(digest_words), pyac_wire.CASE_WORDS["with"])
  tokens.extend([pyac_wire.HANDSHAKE_WORD, pyac_wire.DEONTIC_MOOD_WORD])
  boundaries.add(len(tokens))

  codelets = []
  for chunk_start in range(0, len(tokens), 15):
    chunk = tokens[chunk_start:chunk_start + 15]
    complete = chunk_start + 15 >= len(tokens)
    header = 1 if complete else 0
    codelet = [0] * 16
    for index, value in enumerate(chunk, 1):
      is_boundary = chunk_start + index in boundaries
      if is_boundary == complete:
        header |= 1 << index
      codelet[index] = value
    codelet[0] = header
    codelets.append(codelet)
  return pack_frame(codelets)


def upload_fixture(secret="test-shared-secret"):
  job = pack_frame([[0] * 16])
  digest = hashlib.sha256(job).digest()
  identity = {
    "username": "htaf",
    "hostId": "mriczo",
    "handleId": "0123456789ab",
    "nonce": bytes(range(16)),
    "digest": digest,
  }
  return auth_pack(**{
    "username": identity["username"],
    "host_id": identity["hostId"],
    "handle_id": identity["handleId"],
    "nonce": identity["nonce"],
    "digest": digest,
    "secret": secret,
  }) + job


class PyacWireTests(unittest.TestCase):
  def test_verifies_two_framed_packs_and_pyash_hmac_sentence(self):
    upload = upload_fixture()
    identity, job = pyac_wire.verify_upload_stream(upload, "test-shared-secret")
    self.assertEqual(identity["username"], "htaf")
    self.assertEqual(identity["hostId"], "mriczo")
    self.assertEqual(identity["handleId"], "0123456789ab")
    self.assertEqual(job, upload[-64:])

  def test_unpack_frame_accepts_packs_above_the_old_16_mib_limit(self):
    codelet_count = (16 * 1024 * 1024) // pyac_wire.CODELET_BYTES + 1
    total_bytes = pyac_wire.PACK_HEADER_BYTES + codelet_count * pyac_wire.CODELET_BYTES
    header = struct.pack(
      "<8sHHHHIIII",
      pyac_wire.PACK_MAGIC,
      1,
      16,
      16,
      pyac_wire.PACK_HEADER_BYTES,
      codelet_count,
      pyac_wire.CODELET_BYTES,
      total_bytes,
      0,
    )
    frame = header + bytes(total_bytes - len(header))
    self.assertGreater(len(frame), 16 * 1024 * 1024)
    self.assertEqual(pyac_wire.unpack_frame(frame)[1], len(frame))

  def test_rejects_wrong_key_tampered_job_and_trailing_bytes(self):
    upload = upload_fixture()
    with self.assertRaisesRegex(pyac_wire.PyacWireError, "authentication failed"):
      pyac_wire.verify_upload_stream(upload, "wrong-key")
    tampered = bytearray(upload)
    tampered[-1] ^= 1
    with self.assertRaisesRegex(pyac_wire.PyacWireError, "authentication failed"):
      pyac_wire.verify_upload_stream(bytes(tampered), "test-shared-secret")
    with self.assertRaisesRegex(pyac_wire.PyacWireError, "trailing bytes"):
      pyac_wire.verify_upload_stream(upload + b"x", "test-shared-secret")

  def test_shared_secret_is_loaded_from_a_single_pyash_sentence(self):
    with tempfile.TemporaryDirectory(prefix="pyac-wire-secret-") as directory:
      path = Path(directory) / "secret.pya"
      path.write_text('exists su name gpu authentication key ob text "private-test-value" be text ya\n')
      previous = os.environ.get("GPU_HOUSEKEEPER_SECRET_PYA_PATH")
      os.environ["GPU_HOUSEKEEPER_SECRET_PYA_PATH"] = str(path)
      try:
        self.assertEqual(pyac_wire.load_shared_secret(), "private-test-value")
      finally:
        if previous is None:
          os.environ.pop("GPU_HOUSEKEEPER_SECRET_PYA_PATH", None)
        else:
          os.environ["GPU_HOUSEKEEPER_SECRET_PYA_PATH"] = previous

  def test_pack_spool_is_content_addressed_and_rejects_path_escape(self):
    with tempfile.TemporaryDirectory(prefix="pyac-wire-spool-") as directory:
      root = Path(directory)
      pack = pack_frame([[0] * 16])
      reference = pyac_wire.persist_pack(root, pack)
      self.assertEqual(pyac_wire.read_persisted_pack(root, reference), pack)
      self.assertEqual(pyac_wire.persist_pack(root, pack), reference)
      with self.assertRaisesRegex(pyac_wire.PyacWireError, "invalid"):
        pyac_wire.read_persisted_pack(root, "../escape.pyac")


if __name__ == "__main__":
  unittest.main()
