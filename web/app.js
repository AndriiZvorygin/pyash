const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message");
const chatState = document.querySelector("#chat-state");
const health = document.querySelector("#health");
const sessionSelect = document.querySelector("#session-select");
const modelSelect = document.querySelector("#model-select");
const newSessionButton = document.querySelector("#new-session");
const jobForm = document.querySelector("#job-form");
const jobIntent = document.querySelector("#job-intent");
const jobSpec = document.querySelector("#job-spec");
const jobState = document.querySelector("#job-state");
let currentSession = localStorage.getItem("pyash-session") || "web";

function setSelectOptions(select, values, selectedValue, format = (value) => value) {
  select.textContent = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value.value ?? value;
    option.textContent = format(value);
    select.append(option);
  }
  if (selectedValue && values.some((value) => (value.value ?? value) === selectedValue)) {
    select.value = selectedValue;
  }
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

async function loadModels() {
  try {
    const data = await requestJson("/api/models");
    const models = (data.models || []).map((name) => ({ value: name, label: name }));
    setSelectOptions(modelSelect, models, localStorage.getItem("pyash-model") || data.selected, (entry) => entry.label);
    if (modelSelect.value) localStorage.setItem("pyash-model", modelSelect.value);
  } catch (error) {
    modelSelect.textContent = "";
    const option = document.createElement("option");
    option.textContent = "Model unavailable";
    option.disabled = true;
    option.selected = true;
    modelSelect.append(option);
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
    chatState.textContent = data.session?.model ? `Ready · ${data.session.model}` : "Ready";
  } catch (error) {
    chatState.textContent = "History unavailable";
  }
}

sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));
modelSelect.addEventListener("change", () => {
  if (modelSelect.value) {
    localStorage.setItem("pyash-model", modelSelect.value);
    chatState.textContent = `Ready · ${modelSelect.value}`;
  }
});

newSessionButton.addEventListener("click", async () => {
  currentSession = `chat-${Date.now().toString(36)}`;
  localStorage.setItem("pyash-session", currentSession);
  await loadSessions();
  sessionSelect.value = currentSession;
  clearMessages();
  chatState.textContent = "Ready";
  messageInput.focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  addMessage("user", message);
  messageInput.value = "";
  messageInput.disabled = true;
  chatState.textContent = "Working...";
  try {
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
loadSessions().then(() => loadSession(currentSession));
setInterval(refreshStatus, 10000);
