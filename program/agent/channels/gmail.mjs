import crypto from "node:crypto";

import { channelIdentityFromEvent } from "../channel_core/contract.mjs";

const DEFAULT_GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1";

function text(value) {
  return String(value ?? "").trim();
}

function baseUrl(value) {
  return text(value).replace(/\/+$/g, "") || DEFAULT_GMAIL_BASE_URL;
}

function headerMap(headers = []) {
  const out = new Map();
  for (const header of Array.isArray(headers) ? headers : []) {
    const name = text(header?.name).toLowerCase();
    if (!name || out.has(name)) continue;
    out.set(name, text(header?.value));
  }
  return out;
}

function decodeBase64Url(value) {
  const raw = text(value).replace(/-/g, "+").replace(/_/g, "/");
  if (!raw) return "";
  const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeGmailRawMessage(value) {
  return decodeBase64Url(value);
}

function encodeBase64Url(value) {
  return Buffer.from(String(value ?? ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function firstEmail(value) {
  const raw = text(value);
  const angle = raw.match(/<([^<>\s]+)>/u);
  if (angle?.[1]) return angle[1];
  const address = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  return address?.[0] ?? raw;
}

function headerValue(headers, name) {
  return headerMap(headers).get(String(name).toLowerCase()) ?? "";
}

function partText(part, preferredMime = "text/plain") {
  if (!part || typeof part !== "object") return "";
  const mimeType = text(part.mimeType).toLowerCase();
  if (mimeType === preferredMime && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of Array.isArray(part.parts) ? part.parts : []) {
    const nested = partText(child, preferredMime);
    if (nested) return nested;
  }
  return "";
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function messageBody(payload) {
  const plain = partText(payload, "text/plain");
  if (plain) return plain;
  if (payload?.body?.data) return decodeBase64Url(payload.body.data);
  const html = partText(payload, "text/html");
  return stripHtml(html);
}

function attachmentMetadata(payload) {
  const out = [];
  const walk = (part) => {
    if (!part || typeof part !== "object") return;
    const filename = text(part.filename);
    if (filename) {
      out.push({
        filename,
        mimeType: text(part.mimeType),
        attachmentId: text(part.body?.attachmentId),
        bytes: Number.isFinite(Number(part.body?.size)) ? Math.trunc(Number(part.body.size)) : null
      });
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) walk(child);
  };
  walk(payload);
  return out;
}

function receivedAtFor(message, headers) {
  const dateHeader = headerValue(headers, "date");
  const date = dateHeader ? new Date(dateHeader) : new Date(Number(message?.internalDate));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function userForConfig(config = {}) {
  return text(config.gmailUser ?? config.user ?? config.account ?? config.channelId);
}

function tokenForConfig(config = {}) {
  return text(config.accessToken ?? config.token);
}

function authHeaders(config = {}, extra = {}) {
  const token = tokenForConfig(config);
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function readJson(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`gmail ${operation} defective: status=${response.status}`);
  }
  return payload;
}

function messageEvent(message, { account, configuredDomain, historyId }) {
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  const messageId = text(message?.id);
  if (!messageId) return null;
  const messageHistoryId = text(message?.historyId || historyId);
  const threadId = text(message?.threadId);
  const rfcMessageId = headerValue(headers, "message-id");
  const sender = firstEmail(headerValue(headers, "from"));
  const replyRecipient = firstEmail(headerValue(headers, "reply-to") || headerValue(headers, "from"));
  const sourceLocator = `gmail:${account}/messages/${messageId}`;
  const receivedAt = receivedAtFor(message, headers);
  const event = {
    channelType: "gmail",
    channelId: account,
    account,
    eventId: messageId,
    sender,
    replyRecipient,
    text: messageBody(message?.payload),
    timestamp: receivedAt,
    provider: "gmail",
    messageId,
    threadId,
    rfcMessageId,
    historyId: messageHistoryId,
    subject: headerValue(headers, "subject"),
    receivedAt,
    domain: text(configuredDomain),
    deadline: "",
    decisionRequired: false,
    draftResponseRequested: false,
    mutationRequested: false,
    sourceLocator,
    attachments: attachmentMetadata(message?.payload)
  };
  event.channelIdentity = channelIdentityFromEvent(event);
  return event;
}

function historyMessageStubs(history = []) {
  const messages = [];
  const seen = new Set();
  for (const entry of Array.isArray(history) ? history : []) {
    for (const added of Array.isArray(entry?.messagesAdded) ? entry.messagesAdded : []) {
      const message = added?.message;
      const id = text(message?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      messages.push(message);
    }
  }
  return messages;
}

function queryUrl(url, entries) {
  const parsed = new URL(url);
  for (const [key, value] of entries) {
    if (value != null && text(value)) parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

function composeRawMessage({ to, subject, content, inReplyTo, references, messageId }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject || "Pyash correspondence"}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ];
  if (messageId) lines.push(`Message-ID: ${messageId}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  return `${lines.join("\r\n")}\r\n\r\n${String(content ?? "").trim()}\r\n`;
}

export function createGmailAdapter({
  fetchImpl = globalThis.fetch,
  baseUrl: configuredBaseUrl = DEFAULT_GMAIL_BASE_URL
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("gmail adapter requires fetch");

  return {
    type: "gmail",
    async receive({ config = {}, checkpoint = {} } = {}) {
      const account = userForConfig(config);
      const token = tokenForConfig(config);
      if (!account || !token) {
        throw new Error("gmail receive defective: account and token are required");
      }
      const root = `${baseUrl(config.gmailBaseUrl ?? configuredBaseUrl)}/users/${encodeURIComponent(account)}`;
      const historyId = text(checkpoint?.historyId);
      let stubs = [];
      let nextHistoryId = historyId;
      if (historyId) {
        const historyUrl = queryUrl(`${root}/history`, [
          ["startHistoryId", historyId],
          ["historyTypes", "messageAdded"],
          ["maxResults", config.maxResults ?? 100]
        ]);
        const historyPayload = await readJson(await fetchImpl(historyUrl, {
          method: "GET",
          headers: authHeaders(config)
        }), "history");
        stubs = historyMessageStubs(historyPayload.history);
        nextHistoryId = text(historyPayload.historyId) || historyId;
      } else {
        const profilePayload = await readJson(await fetchImpl(`${root}/profile`, {
          method: "GET",
          headers: authHeaders(config)
        }), "profile");
        nextHistoryId = text(profilePayload.historyId);
        if (!nextHistoryId) {
          throw new Error("gmail profile defective: missing historyId");
        }
      }

      const events = [];
      for (const stub of stubs) {
        const messageUrl = `${root}/messages/${encodeURIComponent(stub.id)}?format=full`;
        const message = await readJson(await fetchImpl(messageUrl, {
          method: "GET",
          headers: authHeaders(config)
        }), "message");
        const event = messageEvent(message, {
          account,
          configuredDomain: config.domain,
          historyId: nextHistoryId
        });
        if (event) events.push(event);
      }
      return {
        events,
        checkpoint: nextHistoryId ? { historyId: nextHistoryId } : { historyId },
        diagnostics: {
          account,
          historyId,
          nextHistoryId,
          messages: events.length,
          initializedFromProfile: !historyId
        }
      };
    },

    async send({ config = {}, event = {}, content = "" } = {}) {
      const account = userForConfig(config);
      const token = tokenForConfig(config);
      const to = firstEmail(event.replyRecipient || event.sender || config.replyTo);
      const body = String(content ?? "").trim();
      if (!account || !token || !to || !body) {
        throw new Error("gmail send defective: account, token, recipient, and content are required");
      }
      const sourceIdentity = channelIdentityFromEvent(event);
      const rfcMessageId = text(event.rfcMessageId);
      const stableMessageId = `<pyash-${crypto.createHash("sha256").update(JSON.stringify({
        account,
        eventId: event.eventId,
        body
      })).digest("hex").slice(0, 24)}@pyash.local>`;
      const raw = composeRawMessage({
        to,
        subject: /^re:/iu.test(text(event.subject)) ? text(event.subject) : `Re: ${text(event.subject) || "correspondence"}`,
        content: body,
        inReplyTo: rfcMessageId,
        references: rfcMessageId,
        messageId: stableMessageId
      });
      const payload = { raw: encodeBase64Url(raw) };
      if (text(event.threadId)) payload.threadId = text(event.threadId);
      const root = `${baseUrl(config.gmailBaseUrl ?? configuredBaseUrl)}/users/${encodeURIComponent(account)}`;
      let sent;
      try {
        const response = await fetchImpl(`${root}/messages/send`, {
          method: "POST",
          headers: authHeaders(config, { "Content-Type": "application/json" }),
          body: JSON.stringify(payload)
        });
        sent = await readJson(response, "send");
      } catch (error) {
        error.ambiguous = true;
        throw error;
      }
      return {
        eventId: text(sent?.id),
        channelId: account,
        messageId: text(sent?.id),
        threadId: text(sent?.threadId || event.threadId),
        rfcMessageId: stableMessageId,
        channelIdentity: {
          ...(sourceIdentity ?? {}),
          provider: "gmail",
          account,
          eventId: text(sent?.id),
          messageId: text(sent?.id),
          threadId: text(sent?.threadId || event.threadId),
          rfcMessageId: stableMessageId
        }
      };
    }
  };
}

export const createEmailAdapter = createGmailAdapter;
