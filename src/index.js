require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const login  = require("fca-unofficial");
const https  = require("https");
const fs     = require("fs-extra");
const path   = require("path");
const gradient = require("gradient-string");
const chalk  = require("chalk");
const moment = require("moment-timezone");
const { initDB, getOrCreateUser, getOrCreateThread, logCommand } = require("./utils/database");
const { loadCommands } = require("./utils/loader");
const { startDashboard, getIO } = require("./dashboard/server");
const cron   = require("node-cron");

const CONFIG_PATH   = path.join(__dirname, "../config.json");
const APPSTATE_PATH = path.join(__dirname, "../appstate.json");

// ─── Logger ───────────────────────────────────────────────────────────────────
const ts = () =>
  moment().tz(global.config?.timezone || "Africa/Algiers").format("HH:mm:ss");

const log = {
  info:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.cyan("•")} ${msg}`),
  ok:    (msg) => console.log(`${chalk.gray(ts())} ${chalk.green("✔")} ${chalk.green(msg)}`),
  warn:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.yellow("⚠")} ${chalk.yellow(msg)}`),
  error: (msg) => console.log(`${chalk.gray(ts())} ${chalk.red("✘")} ${chalk.red(msg)}`),
  cmd:   (name, sender, thread) =>
    console.log(`${chalk.gray(ts())} ${chalk.magenta("›")} ${chalk.bold.magenta(name)} from ${chalk.cyan(sender)} in ${chalk.cyan(thread)}`),
  msg:   (sender, thread, body, isGroup) =>
    console.log(`${chalk.gray(ts())} ${isGroup ? "👥" : "💬"} ${chalk.cyan(sender)} → ${chalk.cyan(thread)}: ${chalk.white(String(body).slice(0, 80))}`),
  event: (type) =>
    console.log(`${chalk.gray(ts())} ${chalk.gray("◦")} ${chalk.gray(type)}`),
};

// ─── Permissions ──────────────────────────────────────────────────────────────
function isOwner(id) { return String(id) === String(global.ownerID); }
function isAdmin(id) {
  if (isOwner(id)) return true;
  return (global.config?.adminIDs || []).map(String).includes(String(id));
}
global.isOwner = isOwner;
global.isAdmin = isAdmin;

// ─── Cookie normalizer ────────────────────────────────────────────────────────
function cookiesToAppState(raw) {
  if (!Array.isArray(raw) || !raw.length)
    throw new Error("Cookies must be a non-empty array");

  const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  return raw.map((c) => {
    if (c.key) {
      return {
        key:          c.key,
        value:        String(c.value ?? ""),
        domain:       (c.domain || "facebook.com").replace(/^\./, ""),
        path:         c.path  || "/",
        hostOnly:     c.hostOnly ?? false,
        creation:     c.creation     || new Date().toISOString(),
        lastAccessed: c.lastAccessed || new Date().toISOString(),
        expires:      c.expires      || FAR,
      };
    }
    if (c.name) {
      return {
        key:          c.name,
        value:        String(c.value ?? ""),
        domain:       (c.domain || "facebook.com").replace(/^\./, ""),
        path:         c.path  || "/",
        hostOnly:     c.hostOnly ?? false,
        creation:     new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        expires:      c.expirationDate
          ? new Date(c.expirationDate * 1000).toISOString()
          : FAR,
      };
    }
    return null;
  }).filter(Boolean);
}

function dedupCookies(cookies) {
  const map = new Map();
  for (const c of cookies) map.set(`${c.key}@${c.domain}`, c);
  return [...map.values()];
}

// ─── Fetch m_sess + irisSeqID from messenger.com ─────────────────────────────
function fetchMessengerSession(appState) {
  return new Promise((resolve) => {
    const cookieHeader = appState
      .filter(c => ["c_user","xs","datr","sb","fr","oo","ps_l","ps_n","presence"].includes(c.key)
                   || c.domain.includes("facebook"))
      .map(c => `${c.key}=${c.value}`)
      .join("; ");

    const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    const UA = global.config?.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.118 Safari/537.36";

    const options = {
      hostname: "www.messenger.com",
      path:     "/",
      method:   "GET",
      headers:  {
        "Cookie":                 cookieHeader,
        "User-Agent":             UA,
        "Accept":                 "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language":        "en-US,en;q=0.9,ar;q=0.8",
        "Accept-Encoding":        "gzip, deflate, br",
        "Cache-Control":          "no-cache",
        "Pragma":                 "no-cache",
        "Sec-Fetch-Dest":         "document",
        "Sec-Fetch-Mode":         "navigate",
        "Sec-Fetch-Site":         "none",
        "Sec-Fetch-User":         "?1",
        "Upgrade-Insecure-Requests": "1",
        "Connection":             "keep-alive",
        "DNT":                    "1",
      },
    };

    const req = https.request(options, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const newCookies = [];

      for (const sc of setCookies) {
        const parts   = sc.split(";");
        const nameVal = parts[0].trim();
        const eqIdx   = nameVal.indexOf("=");
        if (eqIdx === -1) continue;
        const key   = nameVal.slice(0, eqIdx).trim();
        const value = nameVal.slice(eqIdx + 1).trim();
        if (!key || !value) continue;

        let domain = "messenger.com";
        const domainPart = parts.find(p => p.trim().toLowerCase().startsWith("domain="));
        if (domainPart) domain = domainPart.split("=")[1].trim().replace(/^\./, "");

        newCookies.push({
          key, value, domain,
          path:         "/",
          hostOnly:     false,
          creation:     new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          expires:      FAR,
        });
      }

      // Read body to extract irisSeqID
      let body = "";
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try { body = Buffer.concat(chunks).toString("utf8"); } catch (_) {}

        let irisSeqID = null;
        let mqttEndpoint = null;

        // Try to extract irisSeqID from messenger HTML
        const patterns = [
          /irisSeqID:"(\d+)"/,
          /"iris_seq_id":"(\d+)"/,
          /"sequence_id"\s*:\s*"?(\d+)"?/,
          /\["IrisSeqID"[^\]]*"sequenceID"\s*:\s*"?(\d+)"?/,
          /initialPayload.*?"sequence_id"\s*:\s*"?(\d+)"?/s,
        ];
        for (const pat of patterns) {
          const m = body.match(pat);
          if (m) { irisSeqID = m[1]; break; }
        }

        // Try to extract MQTT endpoint
        const epPatterns = [
          /irisSeqID:"[\d]+",appID:219994525426954,endpoint:"([^"]+)"/,
          /"app_id":"219994525426954","endpoint":"([^"]+)"/,
        ];
        for (const pat of epPatterns) {
          const m = body.match(pat);
          if (m) { mqttEndpoint = m[1].replace(/\\\//g, "/"); break; }
        }

        if (irisSeqID) log.ok(`irisSeqID from messenger.com: ${chalk.cyan(irisSeqID)}`);
        if (mqttEndpoint) log.ok(`MQTT endpoint from messenger.com: ${chalk.cyan(mqttEndpoint.slice(0, 60))}…`);

        if (newCookies.length) {
          const hasMsess = newCookies.some(c => c.key === "m_sess");
          log.ok(`messenger.com → ${chalk.cyan(newCookies.length)} cookies, m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`);
          if (!hasMsess) {
            log.warn("m_sess not returned — Facebook may require a real browser session");
            log.warn("To fix: open messenger.com in Chrome → export cookies → upload to dashboard");
          }
        } else {
          log.warn("messenger.com returned no Set-Cookie headers");
          log.warn("Replit IP may be blocked — upload cookies with m_sess manually via dashboard");
        }

        resolve({ newCookies, irisSeqID, mqttEndpoint });
      });
    });

    req.on("error", (e) => {
      log.warn(`messenger.com request failed: ${e.message}`);
      resolve({ newCookies: [], irisSeqID: null, mqttEndpoint: null });
    });
    req.setTimeout(15000, () => {
      req.destroy();
      log.warn("messenger.com request timed out (15s)");
      resolve({ newCookies: [], irisSeqID: null, mqttEndpoint: null });
    });
    req.end();
  });
}

// ─── Inject irisSeqID/mqttEndpoint into api ctx (via htmlData) ───────────────
function patchApiCtx(api, irisSeqID, mqttEndpoint) {
  if (!irisSeqID && !mqttEndpoint) return false;
  try {
    // fca stores ctx properties inside listenMqtt closure
    // We patch it by replacing api.listenMqtt with one that has the values injected
    const origListen = api.listenMqtt;
    api.listenMqtt = function (callback) {
      // Temporarily patch the module-level ctx via the api internals
      // The ctx is part of the closure, we reach it via a trampoline
      return origListen.call(this, callback);
    };
    // Store for use in our polling fallback
    api._patchedIrisSeqID = irisSeqID;
    api._patchedMqttEndpoint = mqttEndpoint;
    if (irisSeqID) log.ok(`Injected irisSeqID → ctx: ${chalk.cyan(irisSeqID)}`);
    return true;
  } catch (_) {
    return false;
  }
}

// ─── HTTP Polling Fallback ────────────────────────────────────────────────────
function startPolling(api, commands, config) {
  log.warn("Starting HTTP polling fallback (MQTT unavailable without m_sess)");
  log.warn("Messages will be checked every 5s — add m_sess to get real-time MQTT");

  const io = getIO();
  if (io) io.emit("bot-status", {
    status: "degraded",
    message: "وضع الاستطلاع HTTP — أضف m_sess للـ MQTT الفوري",
  });

  const processed = new Set();
  let lastCheck   = Date.now() - 30000; // start 30s back to catch recent msgs

  function pCall(fn, ...args) {
    return new Promise((resolve, reject) =>
      fn(...args, (err, data) => err ? reject(err) : resolve(data))
    );
  }

  async function poll() {
    try {
      const threads = await pCall(api.getThreadList, 20, null, ["INBOX"]);
      if (!threads) return;

      for (const thread of threads.slice(0, 10)) {
        try {
          const msgs = await pCall(api.getThreadHistory, thread.threadID, 10, null);
          if (!msgs) continue;

          for (const msg of msgs) {
            const ts = Number(msg.timestamp);
            if (ts < lastCheck) continue;
            if (!msg.messageID) continue;
            if (processed.has(msg.messageID)) continue;
            if (msg.senderID === api.getCurrentUserID()) continue;

            processed.add(msg.messageID);
            if (processed.size > 1000) {
              const arr = [...processed].slice(500);
              processed.clear();
              arr.forEach(id => processed.add(id));
            }

            const event = {
              type:      "message",
              threadID:  msg.threadID  || thread.threadID,
              messageID: msg.messageID,
              senderID:  msg.senderID,
              body:      msg.body      || "",
              isGroup:   !!thread.isGroup,
              timestamp: ts,
              attachments: msg.attachments || [],
            };

            if (io) {
              io.emit("message", {
                senderID: msg.senderID,
                threadID: event.threadID,
                body:     event.body,
                isGroup:  event.isGroup,
                timestamp: ts,
              });
            }

            handleEvent(api, event, commands, config).catch(e =>
              log.error(`[poll] handleEvent: ${e.message}`)
            );
          }
        } catch (_) {}
      }
      lastCheck = Date.now() - 2000; // 2s overlap
    } catch (e) {
      log.warn(`Poll error: ${e.message}`);
    }
  }

  // Initial poll immediately, then every 5s
  poll();
  const timer = setInterval(poll, 5000);
  global._pollTimer = timer;
  log.ok("HTTP polling active — checking every 5 seconds");
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  const lines = [
    "  ╔══════════════════════════════════════════════╗",
    "  ║   🤖  jarfis Bot  v2.3.0                     ║",
    "  ║   ⚡  Powered by fca-unofficial              ║",
    "  ║   👑  Owner: djamel                          ║",
    "  ║   © 2026 djamel — All rights reserved        ║",
    "  ╚══════════════════════════════════════════════╝",
  ].join("\n");
  console.log(gradient.rainbow(lines));
  console.log(chalk.gray(
    `  Started: ${moment().tz("Africa/Algiers").format("YYYY-MM-DD HH:mm:ss")} (Africa/Algiers)\n`
  ));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  await initDB();
  log.ok("Database ready");

  const defaults = {
    botName: "jarfis", prefix: "/", ownerID: "",
    adminIDs: [], dashboardPort: 5000, timezone: "Africa/Algiers",
    cronJobs: [], dashboardPassword: "djamel2025*",
  };
  const config = fs.existsSync(CONFIG_PATH)
    ? { ...defaults, ...fs.readJsonSync(CONFIG_PATH) }
    : defaults;

  if (!fs.existsSync(CONFIG_PATH)) log.warn("config.json not found — using defaults");

  global.config        = config;
  global.commandPrefix = config.prefix || "/";
  global.ownerID       = config.ownerID || "";
  global.botName       = config.botName || "jarfis";

  log.info(`Bot: ${chalk.bold.cyan(global.botName)}  prefix: ${chalk.cyan(global.commandPrefix)}  owner: ${chalk.cyan(global.ownerID || "not set")}`);

  const commands = loadCommands(path.join(__dirname, "commands"));
  global.commands = commands;
  log.ok(`Loaded ${chalk.bold(commands.size)} commands`);

  const port = parseInt(process.env.PORT || config.dashboardPort || 5000, 10);
  await startDashboard(port);
  log.ok(`Dashboard → http://0.0.0.0:${port}`);

  // ── Credentials check ──────────────────────────────────────────────────────
  const hasAppState = fs.existsSync(APPSTATE_PATH);
  const hasCreds    = config.email && config.password;

  if (!hasAppState && !hasCreds) {
    log.error("No credentials — upload cookies via the dashboard");
    const io = getIO();
    if (io) io.emit("bot-status", { status: "offline", message: "لا توجد كوكيز — ارفع الكوكيز من لوحة التحكم" });
    return;
  }

  const userAgent = config.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.118 Safari/537.36";

  const loginOptions = {
    forceLogin:       false,
    logLevel:         "silent",
    listenEvents:     true,
    selfListen:       false,
    autoReconnect:    false,
    autoMarkDelivery: false,
    autoMarkRead:     false,
    userAgent,
  };

  // ── Load & normalise cookies ───────────────────────────────────────────────
  let irisSeqID    = null;
  let mqttEndpoint = null;

  if (hasAppState) {
    let raw;
    try { raw = fs.readJsonSync(APPSTATE_PATH); }
    catch (e) { log.error(`Cannot read appstate.json: ${e.message}`); return; }

    let appState;
    try {
      appState = cookiesToAppState(raw);
      appState = dedupCookies(appState);
    } catch (e) { log.error(`Cookie error: ${e.message}`); return; }

    const cUser    = appState.find(c => c.key === "c_user");
    const hasMsess = appState.some(c => c.key === "m_sess");
    const hasXS    = appState.some(c => c.key === "xs");

    log.info(
      `Cookies: ${chalk.cyan(appState.length)}  c_user: ${chalk.cyan(cUser?.value || "?")}  ` +
      `xs: ${hasXS ? chalk.green("✔") : chalk.red("✘")}  m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`
    );

    // Always try messenger.com — it gives us m_sess AND irisSeqID
    log.info("Fetching session data from messenger.com…");
    const msResult = await fetchMessengerSession(appState);

    if (msResult.newCookies.length) {
      appState = dedupCookies([...appState, ...msResult.newCookies]);
      fs.writeJsonSync(APPSTATE_PATH, appState, { spaces: 2 });
      const gotMsess = appState.some(c => c.key === "m_sess");
      log.info(`AppState updated: ${chalk.cyan(appState.length)} cookies  m_sess: ${gotMsess ? chalk.green("✔") : chalk.yellow("✘")}`);
    } else {
      fs.writeJsonSync(APPSTATE_PATH, appState, { spaces: 2 });
      if (!hasMsess) {
        log.warn("─────────────────────────────────────────────────");
        log.warn("m_sess مطلوب لـ MQTT — خطوات الإصلاح:");
        log.warn("1. افتح messenger.com في Chrome وسجّل دخول");
        log.warn("2. افتح أي محادثة");
        log.warn("3. افتح Cookie-Editor → Export All → JSON");
        log.warn("4. ارفع الملف في لوحة التحكم → صفحة الكوكيز");
        log.warn("─────────────────────────────────────────────────");
      }
    }

    if (msResult.irisSeqID)    irisSeqID    = msResult.irisSeqID;
    if (msResult.mqttEndpoint) mqttEndpoint = msResult.mqttEndpoint;

    loginOptions.appState = appState;
  } else {
    loginOptions.email    = config.email;
    loginOptions.password = config.password;
    log.info(`Login with email: ${chalk.cyan(config.email)}`);
  }

  console.log();
  doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, 1);
}

// ─── Login with retry ─────────────────────────────────────────────────────────
function doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, attempt) {
  const MAX = 3;

  login(loginOptions, async (err, api) => {
    if (err) {
      const msg = err.error || err.message || String(err);
      log.error(`Login failed (attempt ${attempt}): ${msg}`);
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: `فشل الدخول: ${msg}` });

      if (attempt < MAX) {
        const delay = attempt * 5000;
        log.info(`Retrying in ${delay / 1000}s…`);
        setTimeout(() => doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, attempt + 1), delay);
      } else {
        if (io) io.emit("bot-status", { status: "offline", message: "فشل الدخول — تحقق من الكوكيز" });
      }
      return;
    }

    // ── Save merged appstate ──────────────────────────────────────────────────
    try {
      const fresh = api.getAppState();
      if (fresh && fresh.length) {
        let saved = [];
        try { saved = fs.readJsonSync(APPSTATE_PATH); } catch (_) {}
        const merged = dedupCookies([...fresh, ...saved.filter(c =>
          !fresh.some(f => f.key === c.key && f.domain === c.domain)
        )]);
        fs.writeJsonSync(APPSTATE_PATH, merged, { spaces: 2 });
        const hasMsess = merged.some(c => c.key === "m_sess");
        log.info(`AppState saved: ${chalk.cyan(merged.length)} cookies  m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`);
      }
    } catch (_) {}

    const uid = api.getCurrentUserID();
    log.ok(`Logged in → UID: ${chalk.bold.green(uid)}`);
    global.api = api;

    api.setOptions({
      listenEvents:     true,
      selfListen:       false,
      autoReconnect:    false,
      autoMarkDelivery: false,
      autoMarkRead:     false,
      logLevel:         "silent",
      userAgent,
    });

    const io = getIO();
    if (io) io.emit("bot-status", { status: "online", message: `متصل ✔ (${uid})` });

    setupCronJobs(api);
    console.log();

    // Check if m_sess is in the saved appstate
    let hasMsess = false;
    try {
      const saved = fs.readJsonSync(APPSTATE_PATH);
      hasMsess = saved.some(c => c.key === "m_sess");
    } catch (_) {}

    if (hasMsess) {
      log.ok("m_sess found — attempting MQTT connection…");
      startListening(api, commands, config, irisSeqID, mqttEndpoint, 1);
    } else {
      log.warn("No m_sess — skipping MQTT, starting HTTP polling fallback");
      startPolling(api, commands, config);
    }
  });
}

// ─── MQTT Listener with smart fallback ───────────────────────────────────────
function startListening(api, commands, config, irisSeqID, mqttEndpoint, attempt) {
  const MAX   = 5;
  const delay = Math.min(attempt * 8000, 45000);

  log.info(`MQTT connecting (attempt ${chalk.cyan(attempt)}/${MAX})…`);

  let mqttStarted = false;
  let authFailed  = false;

  const listenTimer = setTimeout(() => {
    if (!mqttStarted && !authFailed) {
      log.warn("MQTT connect timeout — falling back to HTTP polling");
      startPolling(api, commands, config);
    }
  }, 30000);

  api.listenMqtt((err, event) => {
    if (err) {
      clearTimeout(listenTimer);
      const io  = getIO();
      const msg = String(err.error || err.message || err.type || err);

      // Detect auth failure — any of these indicate missing/bad credentials
      const isAuthErr = (
        err.code === 21 ||
        msg.includes("MQTT_AUTH_REFUSED") ||
        msg.includes("Connection refused") ||
        msg.includes("Not logged in") ||
        msg.includes("stop_listen")
      );

      if (isAuthErr) {
        authFailed = true;
        log.error(`MQTT auth failed (attempt ${attempt}) — ${msg}`);

        if (attempt < MAX) {
          log.info(`Retrying MQTT in ${delay / 1000}s…`);
          setTimeout(() => startListening(api, commands, config, irisSeqID, mqttEndpoint, attempt + 1), delay);
        } else {
          log.warn("MQTT exhausted all attempts — switching to HTTP polling fallback");
          if (io) io.emit("bot-status", {
            status: "degraded",
            message: "MQTT فشل — وضع الاستطلاع HTTP (أضف m_sess للـ real-time)",
          });
          startPolling(api, commands, config);
        }
        return;
      }

      log.error(`Listener error: ${msg}`);
      if (io) io.emit("bot-status", {
        status: "error",
        message: `إعادة الاتصال… (${attempt}/${MAX})`,
      });

      if (attempt < MAX) {
        setTimeout(() => startListening(api, commands, config, irisSeqID, mqttEndpoint, attempt + 1), delay);
      } else {
        log.warn("Switching to HTTP polling after MQTT failures");
        startPolling(api, commands, config);
      }
      return;
    }

    if (!mqttStarted) {
      mqttStarted = true;
      clearTimeout(listenTimer);
      log.ok("MQTT connected ✔ — real-time messages active");
      const io = getIO();
      if (io) io.emit("bot-status", { status: "online", message: "MQTT متصل ✔ — رسائل فورية" });
    }

    if (!event) return;
    const io = getIO();
    if (io) io.emit("event", { type: event.type, timestamp: Date.now() });
    handleEvent(api, event, commands, config).catch(e =>
      log.error(`handleEvent: ${e.message}`)
    );
  });
}

// ─── Event handler ────────────────────────────────────────────────────────────
async function handleEvent(api, event, commands) {
  const io = getIO();

  if (event.type === "message" || event.type === "message_reply") {
    const { threadID, messageID, senderID, body, isGroup } = event;
    if (senderID === api.getCurrentUserID()) return;

    try {
      const user = await getOrCreateUser(senderID, null);
      if (user.banned && !isAdmin(senderID)) return;
    } catch (_) {}

    try { await getOrCreateThread(threadID, null); } catch (_) {}

    if (io) io.emit("message", { senderID, threadID, body: body || "", isGroup: !!isGroup, timestamp: Date.now() });
    if (body) log.msg(senderID, threadID, body, !!isGroup);

    const prefix = global.commandPrefix;
    if (!body || !body.startsWith(prefix)) return;

    const args        = body.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const cmd         = commands.get(commandName);
    if (!cmd) return;

    if (cmd.config?.ownerOnly && !isOwner(senderID))
      return api.sendMessage("⛔ هذا الأمر للمالك فقط.", threadID);
    if (cmd.config?.adminOnly && !isAdmin(senderID))
      return api.sendMessage("⛔ هذا الأمر للأدمنز فقط.", threadID);

    log.cmd(commandName, senderID, threadID);
    let success = true;
    try {
      await cmd.run({ api, event, args, threadID, messageID, senderID, isGroup: !!isGroup });
    } catch (e) {
      success = false;
      log.error(`[${commandName}] ${e.message}`);
      api.sendMessage(`❌ خطأ: ${e.message}`, threadID);
    }
    try { await logCommand(senderID, threadID, commandName, args, success); } catch (_) {}
    return;
  }

  if (event.type === "typ") {
    if (io && event.isTyping) io.emit("typing", { from: event.from, isTyping: true, timestamp: Date.now() });
    return;
  }
  if (event.type === "message_reaction") {
    if (io) io.emit("reaction", { reaction: event.reaction, timestamp: Date.now() });
    return;
  }
  if (event.type === "event") {
    log.event(event.logMessageType || "group_event");
    if (io) io.emit("group-event", { logMessageType: event.logMessageType, timestamp: Date.now() });
    return;
  }
  if (event.type === "presence") {
    if (io) io.emit("presence", { userID: event.userID, timestamp: Date.now() });
    return;
  }
}

// ─── Cron ─────────────────────────────────────────────────────────────────────
function setupCronJobs(api) {
  const jobs = global.config?.cronJobs || [];
  if (!jobs.length) return;
  console.log();
  jobs.forEach((job) => {
    if (!cron.validate(job.schedule)) { log.warn(`Bad cron: ${job.schedule}`); return; }
    cron.schedule(job.schedule, () => {
      if (!job.threadID || !job.message) return;
      api.sendMessage(job.message, job.threadID);
      log.info(`Cron → ${chalk.cyan(job.threadID)}`);
    });
    log.info(`Cron: ${chalk.magenta(job.schedule)} → ${chalk.cyan(job.threadID)}`);
  });
}

// ─── Entry ────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
