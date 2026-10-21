import { orderModelsByRecency, rememberRecentModel } from "/model_recency.js";
import { displaySessionName, normalizeSessionName } from "/session_name.js";

const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message");
const chatState = document.querySelector("#chat-state");
const health = document.querySelector("#health");
const sessionSelect = document.querySelector("#session-select");
const modelSelect = document.querySelector("#model-select");
const workspace = document.querySelector(".workspace");
const sendButton = chatForm.querySelector("button[type=submit]");
const newSessionButton = document.querySelector("#new-session");
const assistantModeButton = document.querySelector("#assistant-mode");
const dutyModeButton = document.querySelector("#duty-mode");
const dutySelect = document.querySelector("#duty-select");
const dutyWorkerSelect = document.querySelector("#duty-worker");
const dutyRepositorySelect = document.querySelector("#duty-repository");
const dutyCreatePermissionSelect = document.querySelector("#duty-create-permission");
const dutyCurrentPermissionSelect = document.querySelector("#duty-current-permission");
const updateDutyPermissionButton = document.querySelector("#update-duty-permission");
const dutyTitleInput = document.querySelector("#duty-title");
const dutyObjectiveInput = document.querySelector("#duty-objective");
const createDutyButton = document.querySelector("#create-duty");
const acceptDutyButton = document.querySelector("#accept-duty");
const dutyState = document.querySelector("#duty-state");
const refreshDutiesButton = document.querySelector("#refresh-duties");
const jobForm = document.querySelector("#job-form");
const jobIntent = document.querySelector("#job-intent");
const jobSpec = document.querySelector("#job-spec");
const jobState = document.querySelector("#job-state");
const appShell = document.querySelector(".shell");
const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginUsername = document.querySelector("#login-username");
const loginPassword = document.querySelector("#login-password");
const loginError = document.querySelector("#login-error");
const signOutButton = document.querySelector("#sign-out");
let currentSession = localStorage.getItem("pyash-session") || "web";
let currentDuty = localStorage.getItem("pyash-duty") || "";
let conversationMode = localStorage.getItem("pyash-mode") === "duty" ? "duty" : "assistant";
let modelCatalog = null;
let sessionCatalog = [];
let dutyCatalog = [];
let dutyWorkers = [];
let dutyPollGeneration = 0;
let modelLoadSequence = 0;
let authorizationHeader = "";
let appStarted = false;

function setSelectOptions(select, values, selectedValue, format = (value) => value) {
  select.textContent = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value.value ?? value;
    option.textContent = format(value);
    option.disabled = value.ready === false || value.disabled === true;
    select.append(option);
  }
  if (selectedValue && values.some((value) => (value.value ?? value) === selectedValue)) {
    select.value = selectedValue;
  }
}

function formatModelOption(entry) {
  if (entry.status === "loading") {
    const eta = entry.etaSeconds == null ? "" : `, ~${entry.etaSeconds}s`;
    return `${entry.label} (loading${eta})`;
  }
  if (entry.status && entry.status !== "ready") return `${entry.label} (${entry.status})`;
  return entry.label;
}

function recentModelValues() {
  try {
    const values = JSON.parse(localStorage.getItem("pyash-recent-models") || "[]");
    return Array.isArray(values) ? values.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function recordModelUse(value) {
  const recent = rememberRecentModel(recentModelValues(), value);
  localStorage.setItem("pyash-recent-models", JSON.stringify(recent));
  if (!modelCatalog?.modelOptions) return;
  modelCatalog.modelOptions = orderModelsByRecency(modelCatalog.modelOptions, recent);
  modelCatalog.models = modelCatalog.modelOptions.map((entry) => entry.value);
  setSelectOptions(modelSelect, modelCatalog.modelOptions, value, formatModelOption);
}

function selectedModelOption() {
  return modelCatalog?.modelOptions?.find((entry) => entry.value === modelSelect.value) || null;
}

function updateChatReadiness() {
  if (conversationMode === "duty") {
    const duty = dutyCatalog.find((entry) => entry.id === currentDuty);
    if (!duty) {
      chatState.textContent = "Select or create a duty";
      sendButton.disabled = true;
      return;
    }
    if (["accepted", "failed"].includes(duty.status)) {
      chatState.textContent = `Duty ${duty.status}`;
      sendButton.disabled = true;
      return;
    }
    if (duty.status === "blocked") {
      chatState.textContent = "Task paused · send a follow-up to resume";
      sendButton.disabled = false;
      return;
    }
    const queued = duty.messages?.some((entry) => entry.role === "user" && ["pending", "running"].includes(entry.state));
    chatState.textContent = duty.active
      ? "Task running · follow-up queues"
      : queued ? "Follow-up queued" : "Duty ready";
    sendButton.disabled = false;
    return;
  }
  const selected = selectedModelOption();
  if (!selected) {
    chatState.textContent = "Select a ready model";
    sendButton.disabled = true;
    return;
  }
  if (selected.ready === false) {
    const eta = selected.etaSeconds == null ? "" : ` · ~${selected.etaSeconds}s`;
    chatState.textContent = selected.status === "loading"
      ? `Loading ${selected.model}${eta}`
      : `${selected.model} unavailable`;
    sendButton.disabled = true;
    return;
  }
  chatState.textContent = `Ready · ${selected.model}`;
  sendButton.disabled = false;
}

function setConversationMode(mode) {
  conversationMode = mode === "duty" ? "duty" : "assistant";
  localStorage.setItem("pyash-mode", conversationMode);
  assistantModeButton.setAttribute("aria-pressed", String(conversationMode === "assistant"));
  dutyModeButton.setAttribute("aria-pressed", String(conversationMode === "duty"));
  workspace.dataset.mode = conversationMode;
  sessionSelect.disabled = conversationMode === "duty";
  newSessionButton.disabled = conversationMode === "duty";
  messageInput.placeholder = conversationMode === "duty" ? "Send a follow-up to this duty..." : "Ask Pyash...";
  updateChatReadiness();
}

function clearMessages() {
  messages.innerHTML = conversationMode === "duty"
    ? '<div class="empty-state">Choose a saved duty or create one in the Duty panel.</div>'
    : '<div class="empty-state">Ask a question, request a search, or bring a task into the queue.</div>';
}

function addMessage(kind, text, details = {}) {
  const empty = messages.querySelector(".empty-state");
  if (empty) empty.remove();
  const article = document.createElement("article");
  article.className = `message ${kind}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = kind === "user" ? "You" : "Pyash";
  const body = document.createElement("div");
  body.className = "message-body";
  if (kind === "assistant" && details.html) body.innerHTML = details.html;
  else body.textContent = text;
  article.append(label, body);
  if (details.events?.length) {
    const events = document.createElement("div");
    events.className = "events";
    for (const event of details.events) {
      const chip = document.createElement("span");
      chip.textContent = `${event.stage}: ${event.toolName}`;
      events.append(chip);
    }
    article.append(events);
  }
  if (details.sources?.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "sources";
    for (const source of details.sources) {
      const link = document.createElement("a");
      link.href = source;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = new URL(source).hostname;
      sourceList.append(link);
    }
    article.append(sourceList);
  }
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

async function requestJson(url, options = {}) {
  const requestPath = new URL(url, window.location.href).pathname;
  const headers = new Headers(options.headers || {});
  if (authorizationHeader && requestPath.startsWith("/api/") && !requestPath.startsWith("/api/duty-workers/")) {
    headers.set("authorization", authorizationHeader);
  }
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({ ok: false, error: { message: response.statusText } }));
  if (!response.ok || data.ok === false) throw new Error(data.error?.message || response.statusText);
  return data;
}

async function refreshStatus() {
  try {
    const data = await requestJson("/api/gpu");
    const queue = data.queue || {};
    document.querySelector("#queue-total").textContent = queue.total ?? 0;
    document.querySelector("#queue-input").textContent = queue.input ?? 0;
    document.querySelector("#queue-runtime").textContent = queue.runtime ?? 0;
    health.textContent = "Online";
    health.classList.add("online");
  } catch (error) {
    health.textContent = "Unavailable";
    health.classList.remove("online");
  }
}

async function loadTools() {
  const target = document.querySelector("#tools");
  try {
    const data = await requestJson("/api/tools");
    target.textContent = "";
    for (const tool of data.tools || []) {
      const item = document.createElement("span");
      item.textContent = tool.name;
      target.append(item);
    }
  } catch (error) {
    target.textContent = "Unavailable";
  }
}

async function loadModels({ force = false } = {}) {
  const sequence = ++modelLoadSequence;
  try {
    const data = await requestJson(`/api/models${force ? "?refresh=1" : ""}`);
    if (sequence !== modelLoadSequence) return;
    modelCatalog = data;
    const models = orderModelsByRecency(
      data.modelOptions || (data.models || []).map((name) => ({ value: name, label: name })),
      recentModelValues()
    );
    data.modelOptions = models;
    data.models = models.map((entry) => entry.value);
    setSelectOptions(modelSelect, models, localStorage.getItem("pyash-model") || data.selected, formatModelOption);
    if (modelSelect.value) localStorage.setItem("pyash-model", modelSelect.value);
    updateChatReadiness();
  } catch (error) {
    if (sequence !== modelLoadSequence) return;
    modelCatalog = null;
    modelSelect.textContent = "";
    const option = document.createElement("option");
    option.textContent = "Model unavailable";
    option.disabled = true;
    option.selected = true;
    modelSelect.append(option);
    sendButton.disabled = true;
    chatState.textContent = "Model status unavailable";
  }
}

async function loadSessions() {
  try {
    const data = await requestJson("/api/sessions");
    sessionCatalog = data.sessions || [];
    const sessions = sessionCatalog.map((session) => ({
      value: session.id,
      label: `${displaySessionName(session.id)} · ${session.messageCount} messages`
    }));
    if (!sessions.some((session) => session.value === currentSession)) {
      sessions.unshift({ value: currentSession, label: `${displaySessionName(currentSession)} · new` });
    }
    setSelectOptions(sessionSelect, sessions, currentSession, (entry) => entry.label);
  } catch (error) {
    setSelectOptions(sessionSelect, [{ value: currentSession, label: displaySessionName(currentSession) }], currentSession, (entry) => entry.label);
  }
}

function updateRepositoryOptions() {
  const worker = dutyWorkers.find((entry) => entry.id === dutyWorkerSelect.value);
  const repositories = worker?.repositories || [];
  setSelectOptions(
    dutyRepositorySelect,
    repositories.map((entry) => ({ value: entry.id, label: entry.label || entry.id })),
    dutyRepositorySelect.value,
    (entry) => entry.label
  );
  if (!repositories.length) {
    setSelectOptions(dutyRepositorySelect, [{ value: "", label: "No folders advertised" }], "", (entry) => entry.label);
  }
  dutyRepositorySelect.disabled = repositories.length === 0;
  setPermissionOptions(dutyCreatePermissionSelect, worker, "project");
}

function setPermissionOptions(select, worker, selectedScope) {
  const allowsHome = worker?.permissionScopes?.includes("home") === true;
  setSelectOptions(select, [
    { value: "project", label: "Selected project folder" },
    { value: "home", label: allowsHome ? "Full home directory" : "Full home directory (not enabled)", disabled: !allowsHome }
  ], selectedScope, (entry) => entry.label);
}

function syncCurrentPermission(duty) {
  const worker = dutyWorkers.find((entry) => entry.id === duty?.workerId);
  setPermissionOptions(dutyCurrentPermissionSelect, worker, duty?.permissionScope || "project");
  const pending = duty?.active || duty?.messages?.some((entry) => entry.role === "user" && ["pending", "running"].includes(entry.state));
  dutyCurrentPermissionSelect.disabled = !duty || Boolean(pending);
  updateDutyPermissionButton.disabled = !duty || Boolean(pending)
    || dutyCurrentPermissionSelect.value === (duty?.permissionScope || "project");
}

async function loadDutyCatalog({ forceSelection = false } = {}) {
  try {
    const [workersData, dutiesData] = await Promise.all([
      requestJson("/api/duty-workers"),
      requestJson("/api/duties")
    ]);
    dutyWorkers = workersData.workers || [];
    dutyCatalog = dutiesData.duties || [];
    setSelectOptions(
      dutyWorkerSelect,
      dutyWorkers.map((worker) => ({
        value: worker.id,
        label: `${worker.label || worker.id} · ${worker.repositories.length} directories`
      })),
      dutyWorkerSelect.value,
      (entry) => entry.label
    );
    if (!dutyWorkers.length) {
      setSelectOptions(dutyWorkerSelect, [{ value: "", label: "No host worker online" }], "", (entry) => entry.label);
    }
    dutyWorkerSelect.disabled = dutyWorkers.length === 0;
    updateRepositoryOptions();
    const choices = dutyCatalog.map((duty) => ({
      value: duty.id,
      label: `${duty.title} · ${duty.status}`
    }));
    if (currentDuty && !dutyCatalog.some((entry) => entry.id === currentDuty)) {
      currentDuty = "";
      localStorage.removeItem("pyash-duty");
    }
    setSelectOptions(dutySelect, choices, currentDuty, (entry) => entry.label);
    if (!dutyCatalog.length) {
      setSelectOptions(dutySelect, [{ value: "", label: "No duties yet" }], "", (entry) => entry.label);
    }
    dutyState.textContent = dutyWorkers.length
      ? `${dutyWorkers.length} host worker${dutyWorkers.length === 1 ? "" : "s"} online · folders come from its worker configuration`
      : "No host worker is online. Start a configured Pyash duty worker; its folders will appear here.";
    if (forceSelection && currentDuty) await loadDuty(currentDuty);
    else updateChatReadiness();
  } catch (error) {
    dutyState.textContent = `Duty service unavailable: ${error.message}`;
  }
}

function renderDutyMessages(duty) {
  clearMessages();
  for (const message of duty.messages || []) {
    if (message.role === "user") addMessage("user", message.text);
    else addMessage("assistant", message.text, { html: message.html });
  }
  messages.scrollTop = messages.scrollHeight;
}

async function loadDuty(dutyId) {
  currentDuty = dutyId;
  localStorage.setItem("pyash-duty", currentDuty);
  if (!currentDuty) {
    clearMessages();
    dutyState.textContent = "Select or create a duty";
    dutyCurrentPermissionSelect.disabled = true;
    updateDutyPermissionButton.disabled = true;
    updateChatReadiness();
    return null;
  }
  setConversationMode("duty");
  try {
    const data = await requestJson(`/api/duties/${encodeURIComponent(currentDuty)}`);
    const duty = data.duty;
    dutyCatalog = [duty, ...dutyCatalog.filter((entry) => entry.id !== duty.id)];
    renderDutyMessages(duty);
    dutyState.textContent = `${duty.status} · ${duty.workerId} · ${duty.repositoryId} · ${duty.permissionScope || "project"} access · ${duty.backend}:${duty.model}`;
    syncCurrentPermission(duty);
    acceptDutyButton.disabled = duty.status !== "implementing" || duty.active
      || duty.messages?.some((entry) => entry.role === "user" && ["pending", "running"].includes(entry.state));
    updateChatReadiness();
    return duty;
  } catch (error) {
    dutyState.textContent = error.message;
    return null;
  }
}

async function waitForDutyReply(dutyId, userMessageId) {
  const generation = ++dutyPollGeneration;
  for (let attempt = 0; attempt < 600 && generation === dutyPollGeneration; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let duty;
    try {
      duty = (await requestJson(`/api/duties/${encodeURIComponent(dutyId)}`)).duty;
      dutyCatalog = [duty, ...dutyCatalog.filter((entry) => entry.id !== duty.id)];
      renderDutyMessages(duty);
      dutyState.textContent = `${duty.status} · ${duty.workerId} · ${duty.repositoryId} · ${duty.permissionScope || "project"} access · ${duty.backend}:${duty.model}`;
      syncCurrentPermission(duty);
      acceptDutyButton.disabled = duty.status !== "implementing" || duty.active
        || duty.messages?.some((entry) => entry.role === "user" && ["pending", "running"].includes(entry.state));
      updateChatReadiness();
    } catch {
      return;
    }
    const reply = duty.messages?.find((entry) => entry.role === "assistant" && entry.parentId === userMessageId);
    if (reply) {
      chatState.textContent = "Duty response received";
      updateChatReadiness();
      return;
    }
    chatState.textContent = duty.active ? "Duty is working..." : "Instruction queued for its worker...";
  }
}

async function createDuty() {
  const workerId = dutyWorkerSelect.value;
  const repositoryId = dutyRepositorySelect.value;
  const title = dutyTitleInput.value.trim();
  const initialMessage = dutyObjectiveInput.value.trim();
  if (!workerId || !repositoryId || !title || !initialMessage) {
    dutyState.textContent = "Choose an online host worker and its folder, then enter a duty name and first instruction.";
    return;
  }
  const permissionScope = dutyCreatePermissionSelect.value || "project";
  if (permissionScope === "home" && !window.confirm("Allow this duty's model tools to access the entire worker account home directory? This is not an OS sandbox; readable personal files may be exposed.")) return;
  createDutyButton.disabled = true;
  dutyState.textContent = "Creating duty...";
  try {
    const data = await requestJson("/api/duties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId, repositoryId, permissionScope, title, initialMessage, model: modelSelect.value })
    });
    dutyTitleInput.value = "";
    dutyObjectiveInput.value = "";
    currentDuty = data.duty.id;
    localStorage.setItem("pyash-duty", currentDuty);
    await loadDutyCatalog();
    dutySelect.value = currentDuty;
    await loadDuty(currentDuty);
    const firstUser = data.duty.messages?.find((entry) => entry.role === "user");
    if (firstUser) waitForDutyReply(currentDuty, firstUser.id);
  } catch (error) {
    dutyState.textContent = error.message;
  } finally {
    createDutyButton.disabled = false;
  }
}

async function acceptDuty() {
  if (!currentDuty) return;
  acceptDutyButton.disabled = true;
  try {
    await requestJson(`/api/duties/${encodeURIComponent(currentDuty)}/accept`, { method: "POST" });
    await loadDutyCatalog({ forceSelection: true });
    dutyState.textContent = "Duty accepted";
  } catch (error) {
    dutyState.textContent = error.message;
    acceptDutyButton.disabled = false;
  }
}

async function updateDutyPermission() {
  if (!currentDuty) return;
  const permissionScope = dutyCurrentPermissionSelect.value || "project";
  if (permissionScope === "home" && !window.confirm("Allow this duty's model tools to access the entire worker account home directory? This is not an OS sandbox; readable personal files may be exposed.")) return;
  updateDutyPermissionButton.disabled = true;
  try {
    await requestJson(`/api/duties/${encodeURIComponent(currentDuty)}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionScope })
    });
    await loadDuty(currentDuty);
  } catch (error) {
    dutyState.textContent = error.message;
    updateDutyPermissionButton.disabled = false;
  }
}

async function submitDutyMessage(message) {
  const dutyId = currentDuty;
  dutyPollGeneration += 1;
  const data = await requestJson(`/api/duties/${encodeURIComponent(dutyId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message })
  });
  const latestUser = [...(data.duty.messages || [])].reverse().find((entry) => entry.role === "user");
  await loadDuty(dutyId);
  if (latestUser) void waitForDutyReply(dutyId, latestUser.id);
}

async function loadSession(sessionId) {
  currentSession = sessionId;
  localStorage.setItem("pyash-session", currentSession);
  clearMessages();
  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(currentSession)}`);
    for (const message of data.session?.messages || []) {
      const kind = message.role === "user" ? "user" : "assistant";
      addMessage(kind, message.content, { html: message.html });
    }
    updateChatReadiness();
  } catch (error) {
    updateChatReadiness();
  }
}

sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));
assistantModeButton.addEventListener("click", () => {
  dutyPollGeneration += 1;
  setConversationMode("assistant");
  loadSession(currentSession);
});
dutyModeButton.addEventListener("click", async () => {
  setConversationMode("duty");
  await loadDutyCatalog();
  if (currentDuty) await loadDuty(currentDuty);
  else clearMessages();
});
dutySelect.addEventListener("change", () => {
  dutyPollGeneration += 1;
  loadDuty(dutySelect.value);
});
dutyWorkerSelect.addEventListener("change", updateRepositoryOptions);
dutyCurrentPermissionSelect.addEventListener("change", () => syncCurrentPermission(dutyCatalog.find((entry) => entry.id === currentDuty)));
createDutyButton.addEventListener("click", createDuty);
acceptDutyButton.addEventListener("click", acceptDuty);
updateDutyPermissionButton.addEventListener("click", updateDutyPermission);
refreshDutiesButton.addEventListener("click", () => loadDutyCatalog({ forceSelection: true }));
modelSelect.addEventListener("change", () => {
  if (modelSelect.value) {
    localStorage.setItem("pyash-model", modelSelect.value);
  }
  updateChatReadiness();
});

newSessionButton.addEventListener("click", async () => {
  const enteredName = window.prompt("Name this session");
  if (enteredName === null) return;
  const sessionName = normalizeSessionName(enteredName);
  if (!sessionName) {
    chatState.textContent = "Enter a session name with at least one letter or number.";
    return;
  }
  await loadSessions();
  if (sessionCatalog.some((session) => session.id === sessionName)) {
    chatState.textContent = `“${displaySessionName(sessionName)}” already exists; select it from Sessions.`;
    return;
  }
  currentSession = sessionName;
  localStorage.setItem("pyash-session", currentSession);
  await loadSessions();
  sessionSelect.value = currentSession;
  clearMessages();
  updateChatReadiness();
  messageInput.focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  if (sendButton.disabled) {
    updateChatReadiness();
    return;
  }
  addMessage("user", message);
  messageInput.value = "";
  messageInput.disabled = true;
  chatState.textContent = "Working...";
  try {
    if (conversationMode === "duty") {
      await submitDutyMessage(message);
      chatState.textContent = "Follow-up sent to duty";
      return;
    }
    const requestedModel = modelSelect.value;
    const data = await requestJson("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, session: currentSession, model: requestedModel })
    });
    recordModelUse(requestedModel);
    addMessage("assistant", data.text || "No answer returned.", { html: data.html, events: data.toolEvents, sources: data.sources });
    currentSession = data.session || currentSession;
    localStorage.setItem("pyash-session", currentSession);
    chatState.textContent = data.model ? `Ready · ${data.model}` : "Ready";
    await loadSessions();
    sessionSelect.value = currentSession;
  } catch (error) {
    addMessage("error", error.message);
    chatState.textContent = "Retry available";
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
    updateChatReadiness();
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (typeof chatForm.requestSubmit === "function") chatForm.requestSubmit();
});

jobIntent.addEventListener("change", () => {
  const kind = jobIntent.value === "hear" ? "comfyui-hear" : "comfyui-draw";
  try {
    const parsed = JSON.parse(jobSpec.value);
    parsed.kind = kind;
    jobSpec.value = JSON.stringify(parsed, null, 2);
  } catch {
    jobState.textContent = "Enter valid JSON before queuing.";
  }
});

jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let parsed;
  try {
    parsed = JSON.parse(jobSpec.value);
  } catch {
    jobState.textContent = "Invalid job JSON.";
    return;
  }
  jobState.textContent = "Submitting...";
  try {
    const data = await requestJson("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: jobIntent.value, profileName: document.querySelector("#job-profile").value, jobSpec: parsed })
    });
    const handleId = data.job?.handleId;
    jobState.textContent = handleId ? `Queued: ${handleId}` : "Queued";
    refreshStatus();
  } catch (error) {
    jobState.textContent = error.message;
  }
});

document.querySelector("#refresh-status").addEventListener("click", refreshStatus);
function startApp() {
  if (appStarted) return;
  appStarted = true;
  refreshStatus();
  loadTools();
  loadModels();
  loadSessions().then(async () => {
    if (conversationMode === "duty") {
      setConversationMode("duty");
      await loadDutyCatalog();
      if (currentDuty) await loadDuty(currentDuty);
    } else {
      setConversationMode("assistant");
      await loadSession(currentSession);
    }
  });
  setInterval(() => {
    refreshStatus();
    loadModels({ force: true });
    if (conversationMode === "duty") loadDutyCatalog();
  }, 5000);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type=submit]");
  const credentials = `${loginUsername.value.trim()}:${loginPassword.value}`;
  const candidate = `Basic ${window.btoa(credentials)}`;
  submitButton.disabled = true;
  loginError.hidden = true;
  try {
    const response = await fetch("/api/gpu", { headers: { authorization: candidate } });
    if (!response.ok) {
      loginError.textContent = response.status === 401
        ? "Sign-in failed. Check your username and password."
        : "Pyash could not verify your sign-in. Try again shortly.";
      loginError.hidden = false;
      return;
    }
    authorizationHeader = candidate;
    loginPassword.value = "";
    loginScreen.hidden = true;
    appShell.hidden = false;
    startApp();
    messageInput.focus();
  } catch {
    loginError.textContent = "Could not reach Pyash. Check the connection and try again.";
    loginError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

signOutButton.addEventListener("click", () => window.location.reload());
