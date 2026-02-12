export function attachImagesToMessages(rawMessages, rawImages) {
  const messages = Array.isArray(rawMessages)
    ? rawMessages.map((message) => ({ ...(message ?? {}) }))
    : [];
  const images = Array.isArray(rawImages)
    ? rawImages.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!images.length) return messages;

  let userIndex = -1;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    if (String(messages[idx]?.role ?? "").toLowerCase() === "user") {
      userIndex = idx;
      break;
    }
  }

  if (userIndex === -1) {
    messages.push({ role: "user", content: "", images: [...images] });
    return messages;
  }

  const existing = Array.isArray(messages[userIndex]?.images)
    ? messages[userIndex].images.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  messages[userIndex].images = [...existing, ...images];
  return messages;
}
