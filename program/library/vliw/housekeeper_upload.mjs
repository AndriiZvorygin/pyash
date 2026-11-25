import crypto from "node:crypto";

import { parse } from "../../understand/index.mjs";
import { encodePyacPack } from "./database.mjs";
import { lowerPyashSentence } from "./sentence.mjs";

function identityText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{1,14}$/u.test(normalized)) {
    throw new Error(`PyAC upload ${label} must be 1-14 ASCII identifier characters`);
  }
  return normalized;
}

function uint16Words(bytes) {
  if (bytes.byteLength % 2 !== 0) throw new Error("PyAC upload authentication data must have an even byte length");
  return Array.from({ length: bytes.byteLength / 2 }, (_, index) => bytes.readUInt16LE(index * 2));
}

function signedMessage({ username, hostId, handleId, nonce, digest }) {
  return Buffer.from([
    "pyac-vliw-upload-v1",
    username,
    hostId,
    nonce.toString("hex"),
    handleId,
    digest.toString("hex")
  ].join("\0"), "utf8");
}

export function createPyacHousekeeperUpload({
  packBytes,
  secret,
  username,
  hostId,
  handleId = crypto.randomBytes(10).toString("base64url"),
  nonce = crypto.randomBytes(16)
} = {}) {
  const pack = Buffer.from(packBytes ?? []);
  if (pack.byteLength < 32 || pack.subarray(0, 8).toString("ascii") !== "PYACVLIW") {
    throw new Error("PyAC upload requires a complete PyAC VLIW pack");
  }
  const sharedSecret = String(secret ?? "");
  if (!sharedSecret) throw new Error("PyAC upload requires gpu authentication key in configure/secret.pya");
  const sourceUsername = identityText(username, "username");
  const sourceHost = identityText(hostId, "host id");
  const resolvedHandle = identityText(handleId, "handle id");
  const nonceBytes = Buffer.from(nonce);
  if (nonceBytes.byteLength !== 16) throw new Error("PyAC upload nonce must contain 128 bits");
  const digest = crypto.createHash("sha256").update(pack).digest();
  const signature = crypto.createHmac("sha256", sharedSecret)
    .update(signedMessage({
      username: sourceUsername,
      hostId: sourceHost,
      handleId: resolvedHandle,
      nonce: nonceBytes,
      digest
    }))
    .digest();
  const source = [
    "su name identity",
    `ob text ${JSON.stringify(sourceUsername)}`,
    `from text ${JSON.stringify(sourceHost)}`,
    `to text ${JSON.stringify(resolvedHandle)}`,
    `at ve num ${uint16Words(nonceBytes).join(" ")}`,
    `with ve num ${uint16Words(digest).join(" ")}`,
    `by ve num ${uint16Words(signature).join(" ")}`,
    "be handshake do"
  ].join(" ");
  const parsed = parse(source);
  const authPack = encodePyacPack(lowerPyashSentence(parsed).vectors);
  return {
    stream: Buffer.concat([authPack, pack]),
    authPack,
    pack,
    digestHex: digest.toString("hex"),
    handleId: resolvedHandle,
    source: { username: sourceUsername, hostId: sourceHost }
  };
}
