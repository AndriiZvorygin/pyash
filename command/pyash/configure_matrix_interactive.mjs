import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";

class MuteWritable extends Writable {
  constructor(target) {
    super();
    this.target = target;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) this.target.write(chunk, encoding);
    callback();
  }
}

export async function collectMatrixInteractive({
  prior,
  mode,
  rootDir,
  explicitAgentName = "",
  sectionPrinter,
  normalizeHomeserver,
  matrixVersions,
  homeserverHost,
  pathExists,
  DEFAULT_MATRIX_APPSERVICE_REGISTRATION,
  normalizeMatrixMode,
  DEFAULT_MATRIX_CHANNEL_MODE,
  MATRIX_CHANNEL_MODES,
  isAppserviceMode,
  readMatrixAppserviceRegistration,
  ensureMatrixUserServer,
  normalizeChannelAgentName,
  DEFAULT_CHANNEL_AGENT_NAME,
  matrixUserIdFromLocalpart,
  matrixSupportsSharedSecret,
  loginMatrixWithPassword,
  ensureSharedSecretToken,
  matrixLiveTest,
  rewriteMatrixIdServer,
  ensureMatrixIdServer,
  ensureMatrixExecutiveDmRoom,
  resolveConfiguredAgentHouseFromRoot,
  matrixSendRoomMessage,
  sanitizeMatrixLocalpart,
  matrixLocalpartFromUserId,
  textOut
}) {
  const quickstart = mode !== "advanced";
  const printer = sectionPrinter();
  const muteOutput = new MuteWritable(process.stdout);
  const rl = readline.createInterface({ input: process.stdin, output: muteOutput, terminal: true });
  try {
    const ask = async (label, fallback = "") => {
      muteOutput.muted = false;
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      muteOutput.muted = false;
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };
    const askSecret = async (label, fallback = "", opts = {}) => {
      const shown = fallback ? (opts.noChange ? " [press enter for no change]" : " [set]") : "";
      muteOutput.muted = false;
      process.stdout.write(`${label}${shown}: `);
      muteOutput.muted = true;
      const v = (await rl.question("")) .trim();
      muteOutput.muted = false;
      process.stdout.write("\n");
      return v || fallback;
    };

    let homeserver = "";
    while (!homeserver) {
      const entered = await ask("Matrix homeserver", prior.homeserver || "https://matrix.org");
      const normalized = normalizeHomeserver(entered);
      try {
        const url = new URL(normalized);
        if (!/^https?:$/i.test(url.protocol)) throw new Error("homeserver must use http or https");
      } catch {
        textOut("- invalid: homeserver must be a valid URL or hostname");
        continue;
      }
      let reachable = false;
      try {
        await matrixVersions({ homeserver: normalized });
        reachable = true;
      } catch (err) {
        textOut(`- warning: homeserver check failed (${String(err?.message || err)})`);
      }
      if (!reachable && !(await askYesNo("Keep this homeserver anyway", false))) continue;
      homeserver = normalized;
    }
    const host = homeserverHost(homeserver);

    const detectedDefaultAppservicePath = await pathExists(path.join(rootDir, DEFAULT_MATRIX_APPSERVICE_REGISTRATION))
      ? DEFAULT_MATRIX_APPSERVICE_REGISTRATION
      : "";
    let appserviceRegistration = String(prior.appserviceRegistration || "").trim();
    let appserviceLoaded = null;
    let appserviceDetectedAccepted = false;
    let channelMode = "";
    if (!appserviceRegistration && detectedDefaultAppservicePath && await askYesNo(`Use detected ${detectedDefaultAppservicePath}`, true)) {
      channelMode = "appservice-push";
      appserviceRegistration = detectedDefaultAppservicePath;
      appserviceDetectedAccepted = true;
    }

    if (!channelMode) {
      while (!channelMode) {
        const enteredMode = normalizeMatrixMode(await ask("Channel mode", normalizeMatrixMode(prior.mode || "", DEFAULT_MATRIX_CHANNEL_MODE)), "");
        if (!enteredMode || !MATRIX_CHANNEL_MODES.includes(enteredMode)) {
          textOut(`- invalid: mode must be ${MATRIX_CHANNEL_MODES.join(", ")}`);
          continue;
        }
        channelMode = enteredMode;
      }
    }

    if (isAppserviceMode(channelMode)) {
      let validated = false;
      if (appserviceRegistration) {
        try {
          appserviceLoaded = await readMatrixAppserviceRegistration({ rootDir, registrationPath: appserviceRegistration });
          validated = true;
          if (!appserviceDetectedAccepted) textOut("- using appservice registration path");
        } catch {
          appserviceRegistration = "";
        }
      }
      while (!validated) {
        appserviceRegistration = String(await ask("Appservice registration path", appserviceRegistration || DEFAULT_MATRIX_APPSERVICE_REGISTRATION)).trim();
        try {
          appserviceLoaded = await readMatrixAppserviceRegistration({ rootDir, registrationPath: appserviceRegistration });
          validated = true;
        } catch (err) {
          textOut(`- invalid: ${String(err?.message || err)}`);
          if (!(await askYesNo("Retry appservice registration path", true))) throw err;
          appserviceRegistration = "";
        }
      }
    }

    let userId = ensureMatrixUserServer(prior.userId || "", host);
    let agentName = normalizeChannelAgentName(explicitAgentName || prior.agentName || DEFAULT_CHANNEL_AGENT_NAME) || DEFAULT_CHANNEL_AGENT_NAME;
    let token = prior.token || "";
    let password = "";
    let registrationSharedSecret = prior.registrationSharedSecret || "";
    let adminToken = prior.adminToken || "";
    let authMode = "";
    let useAppserviceRegistrationAuth = false;
    if (isAppserviceMode(channelMode) && appserviceLoaded) {
      useAppserviceRegistrationAuth = true;
      authMode = "token";
      token = String(appserviceLoaded.asToken || "").trim();
      userId = matrixUserIdFromLocalpart(appserviceLoaded.senderLocalpart, homeserver) || userId;
    }

    if (!authMode) {
      const supportsSharedSecret = matrixSupportsSharedSecret(homeserver);
      const allowedAuthModes = supportsSharedSecret ? ["password", "token", "shared-secret"] : ["password", "token"];
      while (!authMode) {
        const defaultAuth = allowedAuthModes.includes(String(prior.authMode || "").trim().toLowerCase())
          ? String(prior.authMode || "").trim().toLowerCase()
          : "password";
        const picked = String(await ask("Auth mode", defaultAuth)).trim().toLowerCase();
        if (!allowedAuthModes.includes(picked)) {
          textOut(`- invalid: auth mode must be ${allowedAuthModes.join(", ")}`);
          continue;
        }
        authMode = picked;
      }
    }

    let authOk = false;
    while (!authOk) {
      if (!useAppserviceRegistrationAuth) {
        if (authMode === "password") {
          userId = ensureMatrixUserServer(await ask("Agent Matrix user id", userId || "@pyash-agent"), host);
          password = "";
          while (!password) {
            password = await askSecret("Matrix password");
            if (!password) textOut("- invalid: password is required for password mode");
          }
          token = "";
          registrationSharedSecret = "";
          adminToken = "";
        } else if (authMode === "token") {
          token = "";
          while (!token) {
            token = await askSecret("Access token", token);
            if (!token) textOut("- invalid: access token is required for token mode");
          }
          userId = ensureMatrixUserServer(await ask("Agent Matrix user id (optional)", userId), host);
          registrationSharedSecret = "";
          adminToken = "";
        } else {
          registrationSharedSecret = registrationSharedSecret || prior.registrationSharedSecret || "";
          while (!registrationSharedSecret) {
            registrationSharedSecret = await askSecret("Registration shared secret", registrationSharedSecret, { noChange: true });
            if (!registrationSharedSecret) textOut("- invalid: registration shared secret is required for shared-secret mode");
          }
          userId = ensureMatrixUserServer(await ask("Default agent Matrix user id", userId || "@pyash-agent"), host);
          adminToken = "";
          token = token || prior.token || "";
          password = "";
        }
      }

      try {
        let authCfg = { homeserver, userId, authMode, token, password, registrationSharedSecret, adminToken, agentName, mode: channelMode };
        if (authMode === "password" && !authCfg.token && authCfg.userId && authCfg.password) {
          const login = await loginMatrixWithPassword({ homeserver: authCfg.homeserver, userId: authCfg.userId, password: authCfg.password });
          authCfg = { ...authCfg, token: login.token, userId: login.userId || authCfg.userId };
        }
        authCfg = await ensureSharedSecretToken({ cfg: authCfg, rootDir });
        const live = await matrixLiveTest(authCfg);
        if (!live.ok) throw new Error((live.checks || []).filter((c) => !c.ok).map((c) => c.error || c.name).join("; ") || "auth check failed");
        token = authCfg.token;
        userId = authCfg.userId || userId;
        textOut("- auth check passed");
        authOk = true;
      } catch (err) {
        textOut(`- auth check failed (${String(err?.message || err)})`);
        if (!(await askYesNo("Retry authentication step", true))) throw err;
      }
    }

    let room = "";
    while (!room) {
      const roomDefault = rewriteMatrixIdServer(prior.room || "#pyash", host);
      const enteredRoom = await ask("Room id or alias (!room:server or #alias:server)", roomDefault);
      const normalizedRoom = ensureMatrixIdServer(enteredRoom, host);
      if (!normalizedRoom.startsWith("#") && !normalizedRoom.startsWith("!")) {
        textOut("- invalid: room must start with # or !");
        continue;
      }
      room = normalizedRoom;
    }

    let executiveUsername = ensureMatrixUserServer(prior.executiveUsername || "", host);
    let writeAgentPolicy = true;
    let publicTagAnswer = prior.publicTagAnswer !== false;
    executiveUsername = ensureMatrixUserServer(await ask("Executive user (optional DM target)", executiveUsername), host);
    const executiveUsernames = Array.from(new Set([executiveUsername, ...(Array.isArray(prior.executiveUsernames) ? prior.executiveUsernames : [])].map((value) => ensureMatrixUserServer(value, host)).filter(Boolean)));
    if (executiveUsername) {
      try {
        const dmRoomId = await ensureMatrixExecutiveDmRoom({
          agentHouse: resolveConfiguredAgentHouseFromRoot(rootDir, agentName),
          homeserver,
          token,
          user: userId,
          executiveUser: executiveUsername
        });
        await matrixSendRoomMessage({ homeserver, token, roomId: dmRoomId, content: "Pyash configure DM test greeting. Executive messaging is working." });
        textOut("- executive DM test passed");
      } catch (err) {
        textOut(`- executive DM test failed (${String(err?.message || err)})`);
      }
    }

    if (!quickstart) {
      writeAgentPolicy = await askYesNo("Write agent channel conduct file", true);
      if (writeAgentPolicy) agentName = normalizeChannelAgentName(await ask("Agent name", agentName)) || agentName;
    }
    if (quickstart && !String(explicitAgentName || "").trim()) {
      const inferred = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(userId));
      if (inferred) agentName = inferred;
    }

    return {
      homeserver,
      room,
      executiveUsername,
      executiveUsernames,
      userId,
      authMode,
      token,
      password,
      registrationSharedSecret,
      adminToken,
      mode: channelMode,
      appserviceRegistration,
      writeAgentPolicy,
      agentName,
      publicTagAnswer,
      configureMode: quickstart ? "quickstart" : "advanced"
    };
  } finally {
    rl.close();
  }
}
