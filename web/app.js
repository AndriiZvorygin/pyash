const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message");
const chatState = document.querySelector("#chat-state");
const health = document.querySelector("#health");
const sessionSelect = document.querySelector("#session-select");
const modelSelect = document.querySelector("#model-select");
const sendButton = chatForm.querySelector("button[type=submit]");
const newSessionButton = document.querySelector("#new-session");
const assistantModeButton = document.querySelector("#assistant-mode");
const dutyModeButton = document.querySelector("#duty-mode");
const dutySelect = document.querySelector("#duty-select");
const dutyWorkerSelect = document.querySelector("#duty-worker");
const dutyRepositorySelect = document.querySelector("#duty-repository");
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
let currentSession = localStorage.getItem("pyash-session") || "web";
let currentDuty = localStorage.getItem("pyash-duty") || "";
let conversationMode = localStorage.getItem("pyash-mode") === "duty" ? "duty" : "assistant";
let modelCatalog = null;
let dutyCatalog = [];
let dutyWorkers = [];
let dutyPollGeneration = 0;

function setSelectOptions(select, values, selectedValue, format = (value) => value) {
  select.textContent = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value.value ?? value;
    option.textContent = format(value);
    option.disabled = value.ready === false;
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
      chatState.textContent = "Duty blocked · send an instruction to resume";
      sendButton.disabled = false;
      return;
    }
    const queued = duty.messages?.some((entry) => entry.role === "user" && ["pending", "running"].includes(entry.state));
    chatState.textContent = duty.active
      ? "Duty running · next instruction queues"
      : queued ? "Instruction queued" : "Duty ready";
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
  sessionSelect.disabled = conversationMode === "duty";
  newSessionButton.disabled = conversationMode === "duty";
  messageInput.placeholder = conversationMode === "duty" ? "Send an instruction to this duty..." : "Ask Pyash...";
  updateChatReadiness();
}

function clearMessages() {
  messages.innerHTML = '<div class="empty-state">Ask a question, request a search, or bring a task into the queue.</div>';
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
  const response = await fetch(url, options);
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
  try {
    const data = await requestJson(`/api/models${force ? "?refresh=1" : ""}`);
    modelCatalog = data;
    const models = data.modelOptions || (data.models || []).map((name) => ({ value: name, label: name }));
    setSelectOptions(modelSelect, models, localStorage.getItem("pyash-model") || data.selected, formatModelOption);
    if (modelSelect.value) localStorage.setItem("pyash-model", modelSelect.value);
    updateChatReadiness();
  } catch (error) {
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
    const sessions = (data.sessions || []).map((session) => ({
      value: session.id,
      label: `${session.id} (${session.messageCount})`
    }));
    if (!sessions.some((session) => session.value === currentSession)) {
      sessions.unshift({ value: currentSession, label: `${currentSession} (new)` });
    }
    setSelectOptions(sessionSelect, sessions, currentSession, (entry) => entry.label);
  } catch (error) {
    setSelectOptions(sessionSelect, [{ value: currentSession, label: currentSession }], currentSession, (entry) => entry.label);
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
    setSelectOptions(dutyRepositorySelect, [{ value: "", label: "No directories available" }], "", (entry) => entry.label);
  }
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
      setSelectOptions(dutyWorkerSelect, [{ value: "", label: "No worker online" }], "", (entry) => entry.label);
    }
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
      ? `${dutyWorkers.length} worker${dutyWorkers.length === 1 ? "" : "s"} online`
      : "No coding workers online";
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
    updateChatReadiness();
    return null;
  }
  setConversationMode("duty");
  try {
    const data = await requestJson(`/api/duties/${encodeURIComponent(currentDuty)}`);
    const duty = data.duty;
    dutyCatalog = [duty, ...dutyCatalog.filter((entry) => entry.id !== duty.id)];
    renderDutyMessages(duty);
    dutyState.textContent = `${duty.status} · ${duty.workerId} · ${duty.repositoryId} · ${duty.backend}:${duty.model}`;
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
      dutyState.textContent = `${duty.status} · ${duty.workerId} · ${duty.repositoryId} · ${duty.backend}:${duty.model}`;
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
    dutyState.textContent = "Choose a worker and directory, then enter a title and instruction.";
    return;
  }
  createDutyButton.disabled = true;
  dutyState.textContent = "Creating duty...";
  try {
    const data = await requestJson("/api/duties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId, repositoryId, title, initialMessage, model: modelSelect.value })
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
createDutyButton.addEventListener("click", createDuty);
acceptDutyButton.addEventListener("click", acceptDuty);
refreshDutiesButton.addEventListener("click", () => loadDutyCatalog({ forceSelection: true }));
modelSelect.addEventListener("change", () => {
  if (modelSelect.value) {
    localStorage.setItem("pyash-model", modelSelect.value);
  }
  updateChatReadiness();
});

newSessionButton.addEventListener("click", async () => {
  currentSession = `chat-${Date.now().toString(36)}`;
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
      chatState.textContent = "Instruction queued";
      return;
    }
    const data = await requestJson("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, session: currentSession, model: modelSelect.value })
    });
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
}, 5000);
