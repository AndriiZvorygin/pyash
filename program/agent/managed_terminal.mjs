import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_INPUT_BYTES = 64 * 1024;
const MAX_ACTIVE_SESSIONS = 64;
const MAX_RETAINED_SESSIONS = 256;
const DEFAULT_PERSISTED_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_BYTES = 4096;
const MAX_ARGUMENT_COUNT = 128;
const MAX_ARGUMENT_BYTES = 64 * 1024;

function normalizedText(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function publicSession(session) {
  return {
    id: session.id,
    command: session.command,
    args: [...session.args],
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    exitCode: session.exitCode,
    signal: session.signal,
    cursor: session.cursor,
    outputBytes: session.outputBytes,
    metadata: { ...session.metadata },
    persistenceError: session.persistenceError,
    persistenceTruncated: session.persistenceLimitReported
  };
}

export function createManagedTerminalManager({
  spawnPty,
  authorizeLaunch = async () => false,
  persistEvent = async () => {},
  idFactory = () => crypto.randomUUID(),
  now = () => new Date(),
  maxOutputBytes = DEFAULT_OUTPUT_BYTES,
  maxInputBytes = DEFAULT_INPUT_BYTES,
  maxPersistedBytes = DEFAULT_PERSISTED_BYTES,
  maxActiveSessions = MAX_ACTIVE_SESSIONS,
  maxRetainedSessions = MAX_RETAINED_SESSIONS
} = {}) {
  if (typeof spawnPty !== "function") throw new TypeError("terminal manager requires a PTY adapter");
  const sessions = new Map();
  let startingSessions = 0;
  const outputLimit = positiveInteger(maxOutputBytes, DEFAULT_OUTPUT_BYTES, DEFAULT_OUTPUT_BYTES * 8);
  const inputLimit = positiveInteger(maxInputBytes, DEFAULT_INPUT_BYTES, DEFAULT_INPUT_BYTES * 4);
  const persistenceLimit = positiveInteger(maxPersistedBytes, DEFAULT_PERSISTED_BYTES, DEFAULT_PERSISTED_BYTES * 8);
  const activeLimit = positiveInteger(maxActiveSessions, MAX_ACTIVE_SESSIONS, MAX_ACTIVE_SESSIONS);
  const retainedLimit = positiveInteger(maxRetainedSessions, MAX_RETAINED_SESSIONS, MAX_RETAINED_SESSIONS);

  const record = async (session, type, detail = {}) => {
    const event = {
      terminalId: session.id,
      type,
      at: now().toISOString(),
      ...detail
    };
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    session.persistTail = (session.persistTail ?? Promise.resolve()).then(async () => {
      if (session.persistedBytes + eventBytes > persistenceLimit) {
        if (!session.persistenceLimitReported && type !== "persistence-limit") {
          session.persistenceLimitReported = true;
          const limitEvent = {
            terminalId: session.id,
            type: "persistence-limit",
            at: now().toISOString(),
            maximumBytes: persistenceLimit
          };
          try {
            await persistEvent(limitEvent);
          } catch (error) {
            session.persistenceError = String(error?.message ?? error).slice(0, 500);
          }
        }
        return;
      }
      try {
        await persistEvent(event);
        session.persistedBytes += eventBytes;
      } catch (error) {
        session.persistenceError = String(error?.message ?? error).slice(0, 500);
      }
    });
    await session.persistTail;
  };

  const requireSession = (id) => {
    const session = sessions.get(normalizedText(id));
    if (!session) throw new Error(`terminal session not found: ${normalizedText(id) || "(empty)"}`);
    return session;
  };

  return {
    async start({ command, args = [], cwd, columns = 80, rows = 24, env } = {}) {
      const program = normalizedText(command);
      const directory = path.resolve(String(cwd ?? process.cwd()));
      const argumentsList = Array.isArray(args) ? args.map((entry) => String(entry)) : null;
      if (!program || !argumentsList) throw new Error("terminal command and argument list are required");
      if (Buffer.byteLength(program, "utf8") > MAX_COMMAND_BYTES) throw new Error("terminal command exceeds size limit");
      if (argumentsList.length > MAX_ARGUMENT_COUNT
        || argumentsList.reduce((total, entry) => total + Buffer.byteLength(entry, "utf8"), 0) > MAX_ARGUMENT_BYTES) {
        throw new Error("terminal arguments exceed size limit");
      }
      const retained = [...sessions.values()];
      const activeCount = retained.filter((session) => session.status === "running").length;
      if (activeCount + startingSessions >= activeLimit) {
        throw new Error("managed terminal active-session limit reached");
      }
      if (sessions.size + startingSessions >= retainedLimit) {
        for (const session of retained) {
          if (session.status !== "running") sessions.delete(session.id);
          if (sessions.size + startingSessions < retainedLimit) break;
        }
      }
      if (sessions.size + startingSessions >= retainedLimit) {
        throw new Error("managed terminal retained-session limit reached");
      }
      startingSessions += 1;
      try {
        if (!await authorizeLaunch({ command: program, args: argumentsList, cwd: directory })) {
          throw new Error("terminal command denied by Pyash command policy");
        }
        const size = {
          columns: positiveInteger(columns, 80, 500),
          rows: positiveInteger(rows, 24, 300)
        };
        const pty = await spawnPty(program, argumentsList, {
          cwd: directory,
          cols: size.columns,
          rows: size.rows,
          env: env && typeof env === "object" ? { ...env } : undefined
        });
        const session = {
          id: String(idFactory()),
          command: program,
          args: argumentsList,
          cwd: directory,
          status: "running",
          startedAt: now().toISOString(),
          endedAt: "",
          exitCode: null,
          signal: "",
          cursor: 0,
          outputBytes: 0,
          output: [],
          metadata: {
            mind: String(env?.PYA_SADDLE_MIND ?? ""),
            model: String(env?.PYA_SADDLE_MODEL ?? ""),
            sessionName: String(env?.PYA_SADDLE_SESSION_NAME ?? "")
          },
          persistTail: Promise.resolve(),
          persistedBytes: 0,
          persistenceLimitReported: false,
          persistenceError: "",
          pty
        };
        sessions.set(session.id, session);
        const startedEvent = record(session, "started", {
          command: session.command,
          args: [...session.args],
          cwd: session.cwd,
          columns: size.columns,
          rows: size.rows,
          mind: session.metadata.mind,
          model: session.metadata.model,
          sessionName: session.metadata.sessionName
        });
        pty.onData((data) => {
          const rawOutput = String(data ?? "");
          if (!rawOutput) return;
          const rawBytes = Buffer.from(rawOutput, "utf8");
          const output = rawBytes.length > outputLimit
            ? rawBytes.subarray(-outputLimit).toString("utf8")
            : rawOutput;
          const chunk = { cursor: ++session.cursor, output };
          session.output.push(chunk);
          session.outputBytes += Buffer.byteLength(output, "utf8");
          while (session.outputBytes > outputLimit && session.output.length > 1) {
            const removed = session.output.shift();
            session.outputBytes -= Buffer.byteLength(removed.output, "utf8");
          }
          const persistedOutput = Buffer.from(rawOutput, "utf8");
          const preview = persistedOutput.length > 16384
            ? persistedOutput.subarray(-16384).toString("utf8")
            : rawOutput;
          void record(session, "output", {
            cursor: chunk.cursor,
            bytes: persistedOutput.length,
            output: preview,
            outputTruncated: persistedOutput.length > 16384,
            outputSha256: crypto.createHash("sha256").update(persistedOutput).digest("hex")
          });
        });
        pty.onExit((result = {}) => {
          session.status = "exited";
          session.endedAt = now().toISOString();
          session.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
          session.signal = result.signal == null ? "" : String(result.signal);
          void record(session, "exited", { exitCode: session.exitCode, signal: session.signal });
        });
        await startedEvent;
        return publicSession(session);
      } finally {
        startingSessions -= 1;
      }
    },

    async read({ id, after = 0, maxBytes = 65536 } = {}) {
      const session = requireSession(id);
      await session.persistTail;
      const cursor = Math.max(0, Number(after) || 0);
      const limit = positiveInteger(maxBytes, 65536, outputLimit);
      const firstAvailable = session.output[0]?.cursor ?? session.cursor + 1;
      const truncated = cursor < firstAvailable - 1;
      const chunks = [];
      let used = 0;
      for (const chunk of session.output) {
        if (chunk.cursor <= cursor) continue;
        const bytes = Buffer.byteLength(chunk.output, "utf8");
        if (used + bytes > limit && chunks.length) break;
        chunks.push(chunk);
        used += bytes;
        if (used >= limit) break;
      }
      return {
        ...publicSession(session),
        output: chunks.map((chunk) => chunk.output).join(""),
        chunks: chunks.map(({ cursor: chunkCursor, output }) => ({ cursor: chunkCursor, output })),
        cursor: chunks.at(-1)?.cursor ?? cursor,
        truncated
      };
    },

    async write({ id, input } = {}) {
      const session = requireSession(id);
      if (session.status !== "running") throw new Error("terminal is not running");
      const value = String(input ?? "");
      const inputBytes = Buffer.byteLength(value, "utf8");
      if (inputBytes > inputLimit) throw new Error(`terminal input exceeds ${inputLimit} bytes`);
      session.pty.write(value);
      await record(session, "input", {
        bytes: inputBytes,
        sha256: crypto.createHash("sha256").update(value).digest("hex")
      });
      return publicSession(session);
    },

    async resize({ id, columns, rows } = {}) {
      const session = requireSession(id);
      if (session.status !== "running") throw new Error("terminal is not running");
      const width = positiveInteger(columns, 0, 500);
      const height = positiveInteger(rows, 0, 300);
      if (!width || !height) throw new Error("terminal dimensions must be positive integers");
      session.pty.resize(width, height);
      await record(session, "resized", { columns: width, rows: height });
      return publicSession(session);
    },

    async status({ id } = {}) {
      const session = requireSession(id);
      await session.persistTail;
      return publicSession(session);
    },

    async list() {
      await Promise.all([...sessions.values()].map((session) => session.persistTail));
      return [...sessions.values()].map(publicSession);
    },

    async close({ id, signal = "SIGTERM" } = {}) {
      const session = requireSession(id);
      if (session.status === "running") session.pty.kill(String(signal));
      await record(session, "close-requested", { signal: String(signal) });
      return publicSession(session);
    },

    async closeAll({ signal = "SIGTERM" } = {}) {
      const running = [...sessions.values()].filter((session) => session.status === "running");
      await Promise.all(running.map(async (session) => {
        session.pty.kill(String(signal));
        await record(session, "close-requested", { signal: String(signal) });
      }));
      return running.length;
    }
  };
}

export async function spawnNodePty(command, args, options = {}) {
  const pty = await import("node-pty");
  const sourceEnv = options.env && typeof options.env === "object" ? options.env : process.env;
  const allowedEnv = [
    "APPDATA", "COLORTERM", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "LOGNAME",
    "PATH", "PATHEXT", "PWD", "SHELL", "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "USER", "WINDIR",
    "PYA_SADDLE_CWD", "PYA_SADDLE_HOST", "PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_SESSION_NAME"
  ];
  const env = Object.fromEntries(allowedEnv
    .filter((key) => Object.prototype.hasOwnProperty.call(sourceEnv, key))
    .map((key) => [key, String(sourceEnv[key])]));
  return pty.spawn(command, args, {
    name: "xterm-256color",
    cols: positiveInteger(options.cols, 80, 500),
    rows: positiveInteger(options.rows, 24, 300),
    cwd: options.cwd,
    env
  });
}
