import { applyMatrixAuthToUrl, matrixAuthHeaders, normalizeHomeserver } from "./matrix_helpers.mjs";

export async function loginMatrixWithPassword({ homeserver, userId, password }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/login`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user: String(userId ?? "")
      },
      password: String(password ?? "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix password login failed: status=${response.status}${code}${message}`);
  }
  const token = payload?.access_token;
  if (!token) throw new Error("matrix password login missing access_token");
  return {
    token: String(token),
    userId: String(payload?.user_id ?? userId ?? "")
  };
}

export async function matrixWhoAmI({ homeserver, token, userId = "", mode = "" }) {
  const endpoint = applyMatrixAuthToUrl(
    `${normalizeHomeserver(homeserver)}/_matrix/client/v3/account/whoami`,
    { token, userId, mode }
  );
  const response = await fetch(endpoint, {
    method: "GET",
    headers: matrixAuthHeaders({ token, mode })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix whoami failed: status=${response.status}${code}${message}`);
  }
  return { userId: String(payload?.user_id ?? "") };
}

export async function matrixVersions({ homeserver }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/versions`;
  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    throw new Error(`matrix versions failed: status=${response.status}`);
  }
  return await response.json().catch(() => ({}));
}

export async function matrixJoinRoom({ homeserver, token, room, mode = "", userId = "" }) {
  const endpoint = applyMatrixAuthToUrl(
    `${normalizeHomeserver(homeserver)}/_matrix/client/v3/join/${encodeURIComponent(room)}`,
    { token, userId, mode }
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: matrixAuthHeaders({
      token,
      mode,
      headers: { "Content-Type": "application/json" }
    }),
    body: JSON.stringify({})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix join failed: status=${response.status}${code}${message}`);
  }
  return String(payload?.room_id || room);
}

export async function matrixSendRoomMessage({ homeserver, token, roomId, content, mode = "", userId = "" }) {
  const txnId = `pyash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const endpoint = applyMatrixAuthToUrl(
    `${normalizeHomeserver(homeserver)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    { token, userId, mode }
  );
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: matrixAuthHeaders({
      token,
      mode,
      headers: { "Content-Type": "application/json" }
    }),
    body: JSON.stringify({
      msgtype: "m.text",
      body: String(content ?? "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix send failed: status=${response.status}${code}${message}`);
  }
  return String(payload?.event_id || "");
}

export async function matrixInviteRoomMember({ homeserver, token, roomId, inviteUserId, mode = "", userId = "" }) {
  const endpoint = applyMatrixAuthToUrl(
    `${normalizeHomeserver(homeserver)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
    { token, userId, mode }
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: matrixAuthHeaders({
      token,
      mode,
      headers: { "Content-Type": "application/json" }
    }),
    body: JSON.stringify({
      user_id: String(inviteUserId ?? "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix invite failed: status=${response.status}${code}${message}`);
  }
}

export async function matrixCreateDirectRoom({ homeserver, token, executiveUsername, mode = "", userId = "" }) {
  const endpoint = applyMatrixAuthToUrl(
    `${normalizeHomeserver(homeserver)}/_matrix/client/v3/createRoom`,
    { token, userId, mode }
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: matrixAuthHeaders({
      token,
      mode,
      headers: { "Content-Type": "application/json" }
    }),
    body: JSON.stringify({
      is_direct: true,
      invite: [String(executiveUsername ?? "")],
      preset: "trusted_private_chat"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix createRoom failed: status=${response.status}${code}${message}`);
  }
  const roomId = String(payload?.room_id || "");
  if (!roomId) throw new Error("matrix createRoom missing room_id");
  return roomId;
}
