import fs from "node:fs";

export function isEscribeUrl(url = "") {
  try {
    return /(?:^|\.)escribemeetings\.com$/iu.test(new URL(String(url || "")).hostname);
  } catch {
    return false;
  }
}

export function canonicalEscribeMeetingPageUrl(pageUrl = "") {
  const value = String(pageUrl || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!isEscribeUrl(url.href) || !/\/MeetingsCalendarView\.aspx\/Meeting$/iu.test(url.pathname)) {
      return url.href;
    }
    const meetingId = String(url.searchParams.get("Id") || "").trim();
    if (!meetingId) return url.href;
    const agenda = String(url.searchParams.get("Agenda") || "Agenda").trim() || "Agenda";
    const lang = String(url.searchParams.get("lang") || "English").trim() || "English";
    return `${url.origin}/Meeting.aspx?Id=${encodeURIComponent(meetingId)}&Agenda=${encodeURIComponent(agenda)}&lang=${encodeURIComponent(lang)}`;
  } catch {
    return value;
  }
}

function findChromiumExecutable() {
  const configured = String(process.env.PYA_CHROMIUM_EXECUTABLE || "").trim();
  const candidates = [configured, "/snap/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

export async function downloadPdfThroughBrowser({ url, pdfPath, pageUrl, browserState }) {
  if (!browserState.browser) {
    const { chromium } = await import("playwright");
    const executablePath = findChromiumExecutable();
    browserState.browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    });
    browserState.page = await browserState.browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    });
  }

  const page = browserState.page;
  const targetPageUrl = canonicalEscribeMeetingPageUrl(pageUrl || url);
  if (targetPageUrl && browserState.pageUrl !== targetPageUrl) {
    // The eScribe calendar route may return a lightweight 404 while still
    // setting the challenge cookie needed by FileStream. DOM readiness is
    // sufficient; waiting for network idle can stall on its long polling.
    await page.goto(targetPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1_500);
    browserState.pageUrl = targetPageUrl;
  }
  const fetchTimeoutMs = Math.max(5_000, Number(process.env.PYA_ESCRIBE_BROWSER_FETCH_TIMEOUT_MS) || 45_000);
  const payload = await page.evaluate(async ({ target, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, { credentials: "include", signal: controller.signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, contentType: response.headers.get("content-type") || "", bytes };
    } finally {
      clearTimeout(timer);
    }
  }, { target: String(url || ""), timeoutMs: fetchTimeoutMs });
  const bytes = Buffer.from(payload.bytes || []);
  if (Number(payload.status) < 200 || Number(payload.status) >= 300) {
    throw new Error(`browser_http_${payload.status}`);
  }
  if (bytes.length < 8 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`browser_response_not_pdf:${String(payload.contentType || "")}`);
  }
  fs.writeFileSync(pdfPath, bytes);
}

export async function closePdfBrowser(browserState) {
  if (browserState?.browser) await browserState.browser.close();
}
