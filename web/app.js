const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message");
const chatState = document.querySelector("#chat-state");
const health = document.querySelector("#health");
const jobForm = document.querySelector("#job-form");
const jobIntent = document.querySelector("#job-intent");
const jobSpec = document.querySelector("#job-spec");
const jobState = document.querySelector("#job-state");

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
  body.textContent = text;
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
      body: JSON.stringify({ message })
    });
    addMessage("assistant", data.text || "No answer returned.", { events: data.toolEvents, sources: data.sources });
    chatState.textContent = "Ready";
  } catch (error) {
    addMessage("error", error.message);
    chatState.textContent = "Retry available";
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
  }
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
setInterval(refreshStatus, 10000);
