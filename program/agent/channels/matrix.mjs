function toBaseUrl(raw) {
  return String(raw ?? "").replace(/\/+$/g, "");
}

function isAppserviceMode(mode) {
  return String(mode ?? "").trim().toLowerCase() === "appservice";
}

function applyAuthToUrl(url, { token, userId, mode } = {}) {
  const text = String(url ?? "");
  if (!isAppserviceMode(mode)) return text;
  const parsed = new URL(text);
  if (token) parsed.searchParams.set("access_token", String(token));
  if (userId) parsed.searchParams.set("user_id", String(userId));
  return parsed.toString();
}

function authHeaders({ token, mode, headers = {} } = {}) {
  const next = { ...headers };
  if (!isAppserviceMode(mode) && token) {
    next.Authorization = `Bearer ${token}`;
  }
  return next;
}

function normalizeLongPollMs(raw, fallback = 30000) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < 1000) return 1000;
  if (rounded > 120000) return 120000;
  return rounded;
}

function pickTextEventBody(event) {
  const body = event?.content?.body;
  if (typeof body !== "string" || !body.trim()) return null;
  return body;
}

async function fetchJoinedRooms({ homeserver, token, userId, mode, fetchImpl }) {
  const url = applyAuthToUrl(`${homeserver}/_matrix/client/v3/joined_rooms`, { token, userId, mode });
  const response = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders({ token, mode })
  });
  if (!response.ok) return { ok: false, status: response.status, rooms: [] };
  const payload = await response.json().catch(() => ({}));
  const rooms = Array.isArray(payload?.joined_rooms) ? payload.joined_rooms.map(String) : [];
  return { ok: true, status: response.status, rooms };
}

async function fetchDirectRooms({ homeserver, token, userId, mode, fetchImpl }) {
  const encodedUserId = encodeURIComponent(String(userId ?? ""));
  const url = applyAuthToUrl(
    `${homeserver}/_matrix/client/v3/user/${encodedUserId}/account_data/m.direct`,
    { token, userId, mode }
  );
  const response = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders({ token, mode })
  });
  if (!response.ok) return { ok: false, status: response.status, rooms: [] };
  const payload = await response.json().catch(() => ({}));
  const roomIds = new Set();
  for (const value of Object.values(payload ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const roomId of value) {
      const text = String(roomId ?? "").trim();
      if (!text) continue;
      roomIds.add(text);
    }
  }
  return { ok: true, status: response.status, rooms: [...roomIds] };
}

async function ensureJoinedRooms({ homeserver, token, userId, mode, rooms, fetchImpl }) {
  const diagnostics = [];
  for (const room of rooms) {
    const roomIdOrAlias = room?.id;
    if (!roomIdOrAlias) continue;
    const encoded = encodeURIComponent(String(roomIdOrAlias));
    const joinUrl = applyAuthToUrl(`${homeserver}/_matrix/client/v3/join/${encoded}`, {
      token,
      userId,
      mode
    });
    const response = await fetchImpl(joinUrl, {
      method: "POST",
      headers: authHeaders({
        token,
        mode,
        headers: { "Content-Type": "application/json" }
      }),
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));
    // Ignore join failures so polling can continue for already-joined rooms.
    // Typical non-fatal cases: already joined, invite-only without invite.
    const status = response.status;
    const ok = response.ok || status === 403 || status === 404;
    const joinedRoomId = typeof payload?.room_id === "string" ? payload.room_id : null;
    diagnostics.push({ room: String(roomIdOrAlias), status, ok, joinedRoomId });
    if (!ok) throw new Error(`matrix join failed: room=${roomIdOrAlias} status=${response.status}`);
  }
  return diagnostics;
}

function buildResolvedRoomConfig(rooms, joinDiagnostics) {
  const diagByRoom = new Map(
    (Array.isArray(joinDiagnostics) ? joinDiagnostics : []).map((entry) => [String(entry?.room ?? ""), entry])
  );
  const resolvedRoomIds = [];
  const laneByRoomId = new Map();
  for (const room of rooms) {
    const configuredId = String(room?.id ?? "");
    if (!configuredId) continue;
    const lane = room?.lane ?? null;
    const joinedRoomId = String(diagByRoom.get(configuredId)?.joinedRoomId ?? "").trim();
    const resolvedId = joinedRoomId || configuredId;
    resolvedRoomIds.push(resolvedId);
    laneByRoomId.set(resolvedId, lane);
    laneByRoomId.set(configuredId, lane);
  }
  return {
    roomIds: [...new Set(resolvedRoomIds)],
    laneByRoomId
  };
}

function normalizeMatrixEvent(event, { roomId }) {
  const text = pickTextEventBody(event);
  if (!text) return null;
  const eventId = event?.event_id;
  const sender = event?.sender;
  const timestampNum = Number(event?.origin_server_ts);
  if (!eventId || !sender) return null;
  const relatesTo = event?.content?.["m.relates_to"] ?? {};
  const relType = relatesTo?.rel_type;
  const relEventId = relatesTo?.event_id ?? null;
  const inReplyToEventId = relatesTo?.["m.in_reply_to"]?.event_id ?? null;
  return {
    channelType: "matrix",
    channelId: roomId,
    threadId: relType === "m.thread" ? relEventId : null,
    inReplyToEventId: inReplyToEventId ? String(inReplyToEventId) : null,
    eventId: String(eventId),
    sender: String(sender),
    text: String(text),
    timestamp: Number.isFinite(timestampNum) ? new Date(timestampNum).toISOString() : new Date().toISOString()
  };
}

export function createMatrixAdapter({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("matrix adapter requires fetch");

  return {
    type: "matrix",
    async receive({ config, checkpoint }) {
      const homeserver = toBaseUrl(config?.homeserver);
      const token = config?.token;
      const userId = String(config?.user ?? "").trim();
      const mode = String(config?.mode ?? "").trim().toLowerCase();
      const includeDirectRooms = config?.includeDirectRooms !== false;
      const rooms = Array.isArray(config?.rooms) ? config.rooms : [];
      if (!homeserver || !token || rooms.length === 0) {
        return {
          events: [],
          checkpoint: checkpoint ?? null,
          diagnostics: {
            homeserver: Boolean(homeserver),
            token: Boolean(token),
            configuredRooms: rooms.length
          }
        };
      }

      const joinDiagnostics = await ensureJoinedRooms({ homeserver, token, userId, mode, rooms, fetchImpl });

      const params = new URLSearchParams();
      const longPollMs = normalizeLongPollMs(config?.longPollMs);
      params.set("timeout", String(longPollMs));
      if (checkpoint?.nextBatch) params.set("since", checkpoint.nextBatch);
      const syncUrl = applyAuthToUrl(
        `${homeserver}/_matrix/client/v3/sync?${params.toString()}`,
        { token, userId, mode }
      );
      const syncRes = await fetchImpl(syncUrl, {
        method: "GET",
        headers: authHeaders({ token, mode })
      });
      if (!syncRes.ok) {
        throw new Error(`matrix sync failed: status=${syncRes.status}`);
      }
      const payload = await syncRes.json();
      const joined = payload?.rooms?.join ?? {};
      const joinedRoomSnapshot = await fetchJoinedRooms({ homeserver, token, userId, mode, fetchImpl });
      const directRoomsSnapshot = includeDirectRooms && userId
        ? await fetchDirectRooms({ homeserver, token, userId, mode, fetchImpl })
        : { ok: false, status: null, rooms: [] };
      const eventTypeCounts = {};
      const joinedRoomIds = Object.keys(joined);
      const resolvedRooms = buildResolvedRoomConfig(rooms, joinDiagnostics);
      const roomLane = resolvedRooms.laneByRoomId;
      const directRoomIds = Array.isArray(directRoomsSnapshot?.rooms) ? directRoomsSnapshot.rooms : [];
      const roomIdsToRead = [...new Set([...resolvedRooms.roomIds, ...directRoomIds, ...joinedRoomIds])];
      const events = [];
      for (const roomId of roomIdsToRead) {
        if (!roomId) continue;
        const timelineEvents = joined?.[roomId]?.timeline?.events;
        if (!Array.isArray(timelineEvents)) continue;
        for (const event of timelineEvents) {
          const eventType = String(event?.type ?? "unknown");
          eventTypeCounts[eventType] = (eventTypeCounts[eventType] ?? 0) + 1;
          if (event?.type !== "m.room.message") continue;
          const normalized = normalizeMatrixEvent(event, { roomId });
          if (!normalized) continue;
          normalized.laneName = roomLane.get(roomId) ?? null;
          events.push(normalized);
        }
      }
      return {
        events,
        checkpoint: { nextBatch: payload?.next_batch ?? checkpoint?.nextBatch ?? null },
        diagnostics: {
          since: checkpoint?.nextBatch ?? null,
          timeoutMs: longPollMs,
          nextBatch: payload?.next_batch ?? checkpoint?.nextBatch ?? null,
          configuredRooms: roomIdsToRead,
          joinDiagnostics,
          directRoomsSnapshot,
          joinedRoomsSnapshot: joinedRoomSnapshot,
          joinedRooms: joinedRoomIds,
          eventTypeCounts
        }
      };
    },

    async send({ config, event, content }) {
      const homeserver = toBaseUrl(config?.homeserver);
      const token = config?.token;
      const userId = String(config?.user ?? "").trim();
      const mode = String(config?.mode ?? "").trim().toLowerCase();
      const roomId = event?.channelId;
      if (!homeserver || !token || !roomId) {
        throw new Error("matrix send missing homeserver/token/room");
      }
      const txnId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const encodedRoomId = encodeURIComponent(String(roomId));
      const encodedTxnId = encodeURIComponent(txnId);
      const sendUrl = applyAuthToUrl(
        `${homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${encodedTxnId}`,
        { token, userId, mode }
      );
      const body = {
        msgtype: "m.text",
        body: String(content ?? "")
      };
      const sendRes = await fetchImpl(sendUrl, {
        method: "PUT",
        headers: authHeaders({
          token,
          mode,
          headers: { "Content-Type": "application/json" }
        }),
        body: JSON.stringify(body)
      });
      if (!sendRes.ok) {
        throw new Error(`matrix send failed: status=${sendRes.status}`);
      }
      const payload = await sendRes.json().catch(() => ({}));
      return { eventId: payload?.event_id ?? null };
    }
  };
}
