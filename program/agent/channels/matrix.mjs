import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

function toBaseUrl(raw) {
  return String(raw ?? "").replace(/\/+$/g, "");
}

function renderMatrixFormattedBody(markdownText) {
  const text = String(markdownText ?? "");
  if (!text.trim()) return "";
  return markdown.render(text);
}

function isAppserviceMode(mode) {
  const value = String(mode ?? "").trim().toLowerCase();
  return value === "appservice" || value === "appservice-push";
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

function pickEventMxcUrl(event) {
  const content = event?.content ?? {};
  const direct = typeof content?.url === "string" ? content.url : "";
  if (direct.startsWith("mxc://")) return direct;
  const encrypted = typeof content?.file?.url === "string" ? content.file.url : "";
  if (encrypted.startsWith("mxc://")) return encrypted;
  return "";
}

function normalizeAttachmentFromEvent(event) {
  const msgtype = String(event?.content?.msgtype ?? "").trim();
  if (!msgtype || !msgtype.startsWith("m.")) return null;
  if (!["m.file", "m.image", "m.video", "m.audio"].includes(msgtype)) return null;
  const mxcUrl = pickEventMxcUrl(event);
  if (!mxcUrl) return null;
  const body = String(event?.content?.body ?? "").trim();
  const mimetype = String(event?.content?.info?.mimetype ?? "").trim();
  const size = Number(event?.content?.info?.size);
  return {
    kind: msgtype,
    body,
    mxcUrl,
    mimetype: mimetype || "",
    size: Number.isFinite(size) && size >= 0 ? Math.trunc(size) : null
  };
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

function inviteRoomEntries(inviteRooms) {
  if (!inviteRooms || typeof inviteRooms !== "object") return [];
  return Object.keys(inviteRooms)
    .map((roomId) => String(roomId ?? "").trim())
    .filter(Boolean)
    .map((id) => ({ id }));
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
  const attachment = normalizeAttachmentFromEvent(event);
  const fallbackText = attachment?.body ? `file received: ${attachment.body}` : "file received";
  const resolvedText = text ?? (attachment ? fallbackText : null);
  if (!resolvedText) return null;
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
    text: String(resolvedText),
    attachments: attachment ? [attachment] : [],
    timestamp: Number.isFinite(timestampNum) ? new Date(timestampNum).toISOString() : new Date().toISOString()
  };
}

function parseMxcUrl(mxcUrl) {
  const text = String(mxcUrl ?? "").trim();
  const match = text.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { serverName: match[1], mediaId: match[2] };
}

function sanitizeFileName(raw, fallback = "file.bin") {
  const text = String(raw ?? "").trim();
  const base = text.split("/").pop() || "";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe || safe === "." || safe === "..") return fallback;
  return safe;
}

function extFromMime(mimetype = "") {
  const value = String(mimetype ?? "").toLowerCase().trim();
  if (!value) return "";
  const map = {
    "text/plain": ".txt",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "video/mp4": ".mp4"
  };
  return map[value] ?? "";
}

function uniquePathName(existing, baseName) {
  if (!existing.has(baseName)) {
    existing.add(baseName);
    return baseName;
  }
  const dotIdx = baseName.lastIndexOf(".");
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const ext = dotIdx > 0 ? baseName.slice(dotIdx) : "";
  let index = 2;
  while (true) {
    const candidate = `${stem}-${index}${ext}`;
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
    index += 1;
  }
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
      const includeJoinedRooms = config?.includeJoinedRooms === true || isAppserviceMode(mode);
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
      const invites = payload?.rooms?.invite ?? {};
      const inviteRooms = inviteRoomEntries(invites);
      const inviteJoinDiagnostics = inviteRooms.length
        ? await ensureJoinedRooms({ homeserver, token, userId, mode, rooms: inviteRooms, fetchImpl })
        : [];
      const joinedRoomSnapshot = await fetchJoinedRooms({ homeserver, token, userId, mode, fetchImpl });
      const directRoomsSnapshot = includeDirectRooms && userId
        ? await fetchDirectRooms({ homeserver, token, userId, mode, fetchImpl })
        : { ok: false, status: null, rooms: [] };
      const eventTypeCounts = {};
      const joinedRoomIds = Object.keys(joined);
      const resolvedRooms = buildResolvedRoomConfig(rooms, joinDiagnostics);
      const roomLane = resolvedRooms.laneByRoomId;
      const directRoomIds = Array.isArray(directRoomsSnapshot?.rooms) ? directRoomsSnapshot.rooms : [];
      const roomIdsToRead = [...new Set([
        ...resolvedRooms.roomIds,
        ...directRoomIds,
        ...(includeJoinedRooms ? joinedRoomIds : [])
      ])];
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
          inviteJoinDiagnostics,
          directRoomsSnapshot,
          includeJoinedRooms,
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
        body: String(content ?? ""),
        format: "org.matrix.custom.html",
        formatted_body: renderMatrixFormattedBody(content)
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
    },

    async downloadAttachments({ config, event, targetDir }) {
      const homeserver = toBaseUrl(config?.homeserver);
      const token = config?.token;
      const userId = String(config?.user ?? "").trim();
      const mode = String(config?.mode ?? "").trim().toLowerCase();
      const attachments = Array.isArray(event?.attachments) ? event.attachments : [];
      if (!homeserver || !token || !targetDir || attachments.length === 0) return [];
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(targetDir, { recursive: true });
      const usedNames = new Set();
      const downloaded = [];
      for (const attachment of attachments) {
        const parsed = parseMxcUrl(attachment?.mxcUrl);
        if (!parsed) continue;
        const sourceName = sanitizeFileName(attachment?.body || "file");
        const withExt = sourceName.includes(".")
          ? sourceName
          : `${sourceName}${extFromMime(attachment?.mimetype) || ".bin"}`;
        const filename = uniquePathName(usedNames, withExt);
        const outPath = path.join(targetDir, filename);
        const downloadUrl = applyAuthToUrl(
          `${homeserver}/_matrix/media/v3/download/${encodeURIComponent(parsed.serverName)}/${encodeURIComponent(parsed.mediaId)}`,
          { token, userId, mode }
        );
        const response = await fetchImpl(downloadUrl, {
          method: "GET",
          headers: authHeaders({ token, mode })
        });
        if (!response.ok) {
          throw new Error(`matrix media download failed: status=${response.status} mxc=${attachment?.mxcUrl ?? ""}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(outPath, bytes);
        downloaded.push({
          kind: attachment?.kind ?? "m.file",
          originalName: attachment?.body || filename,
          filename,
          mimeType: attachment?.mimetype || "",
          bytes: bytes.length,
          path: outPath,
          mxcUrl: attachment?.mxcUrl || ""
        });
      }
      return downloaded;
    }
  };
}
