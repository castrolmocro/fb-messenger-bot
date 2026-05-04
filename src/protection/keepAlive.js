const axios = require("axios");

let pingTimer = null;

function randMs(minMin, maxMin) {
  return Math.floor(Math.random() * ((maxMin - minMin) * 60_000 + 1)) + minMin * 60_000;
}

async function doPing() {
  try {
    const api = global.api;
    if (!api) return;
    const appState = api.getAppState();
    if (!appState?.length) return;

    const cookieStr = appState.map(c => `${c.key}=${c.value}`).join("; ");
    let userAgent;
    try {
      const stealth = require("./stealth");
      userAgent = stealth.isRunning() ? stealth.getCurrentUA() : null;
    } catch (_) {}
    userAgent = userAgent || global.config?.userAgent ||
      "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36";

    const response = await axios.head("https://mbasic.facebook.com/", {
      headers: { cookie: cookieStr, "user-agent": userAgent, "accept": "text/html,*/*;q=0.8" },
      timeout: 10000, validateStatus: null, maxRedirects: 2,
    });

    const isExpired = response.status === 302 ||
      (response.headers?.location || "").includes("login");

    if (isExpired) {
      console.log("[KEEP_ALIVE] ⚠️ Session may have expired");
      const { getIO } = require("../dashboard/server");
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: "الجلسة انتهت — أعد رفع الكوكيز" });
    } else {
      global._lastMqttActivity = Date.now();
    }
  } catch (_) {}
  schedulePing();
}

function schedulePing() {
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = setTimeout(doPing, randMs(8, 18));
}

function start() {
  if (pingTimer) clearTimeout(pingTimer);
  console.log("[KEEP_ALIVE] Started — ping every 8–18 min");
  schedulePing();
}

function stop() {
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = null;
}

module.exports = { start, stop };
