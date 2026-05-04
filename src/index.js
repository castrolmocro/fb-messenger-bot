require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const login    = require("fca-unofficial");
const fs       = require("fs-extra");
const path     = require("path");
const gradient = require("gradient-string");
const chalk    = require("chalk");
const moment   = require("moment-timezone");
const axios    = require("axios");
const https    = require("https");

const { initDB }       = require("./utils/database");
const { loadCommands } = require("./utils/loader");
const { startDashboard, getIO } = require("./dashboard/server");
const checkLiveCookie  = require("./utils/checkLiveCookie");
const getFbstateFromToken = require("./utils/getFbstateFromToken");
const cron = require("node-cron");

const CONFIG_PATH   = path.join(__dirname, "../config.json");
const APPSTATE_PATH = path.join(__dirname, "../appstate.json");

// ─── Logger ───────────────────────────────────────────────────────────────────
const ts = () => moment().tz(global.config?.timezone || "Africa/Algiers").format("HH:mm:ss");
const log = {
  info:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.cyan("•")} ${msg}`),
  ok:    (msg) => console.log(`${chalk.gray(ts())} ${chalk.green("✔")} ${chalk.green(msg)}`),
  warn:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.yellow("⚠")} ${chalk.yellow(msg)}`),
  error: (msg) => console.log(`${chalk.gray(ts())} ${chalk.red("✘")} ${chalk.red(msg)}`),
  cmd:   (name, sender, thread) =>
    console.log(`${chalk.gray(ts())} ${chalk.magenta("›")} ${chalk.bold.magenta(name)} from ${chalk.cyan(sender)} in ${chalk.cyan(thread)}`),
  msg:   (sender, thread, body, isGroup) =>
    console.log(`${chalk.gray(ts())} ${isGroup ? "👥" : "💬"} ${chalk.cyan(sender)} → ${chalk.cyan(thread)}: ${chalk.white(String(body).slice(0, 80))}`),
};

// ─── Permissions ──────────────────────────────────────────────────────────────
function isOwner(id) { return String(id) === String(global.ownerID); }
function isAdmin(id) {
  if (isOwner(id)) return true;
  return (global.config?.adminIDs || []).map(String).includes(String(id));
}
global.isOwner = isOwner;
global.isAdmin = isAdmin;

// ─── Universal Cookie Parser (like WHITE-V3) ──────────────────────────────────
function parseCookieInput(raw) {
  const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  // 1. String? Could be cookie string "c_user=xxx; xs=xxx" or JSON
  if (typeof raw === "string") {
    raw = raw.trim();

    // Token: EAAAA...
    if (raw.startsWith("EAAAA") || raw.startsWith("EAA")) {
      throw { isToken: true, token: raw };
    }

    // Cookie string: "c_user=xxx; xs=xxx; datr=xxx"
    if (raw.match(/^(?:\s*\w[\w-]*\s*=\s*[^;\n]*;?\s*)+$/m) && raw.includes("=") && !raw.startsWith("[")) {
      const parts = raw.split(/[;\n]/);
      const cookies = parts.map(p => {
        const eq = p.indexOf("=");
        if (eq < 1) return null;
        const key   = p.slice(0, eq).trim();
        const value = p.slice(eq + 1).trim();
        if (!key || key === "x-referer") return null;
        return {
          key, value,
          domain: "facebook.com", path: "/",
          hostOnly: false,
          creation: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          expires: FAR,
        };
      }).filter(Boolean);
      if (cookies.length > 0) return cookies;
    }

    // Try JSON parse
    try { raw = JSON.parse(raw); }
    catch (e) { throw new Error("صيغة الكوكيز غير مدعومة — يجب أن تكون JSON مصفوفة أو نص كوكيز أو توكن"); }
  }

  // 2. Array (JSON)
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error("يجب أن يكون JSON مصفوفة غير فارغة");

  return raw.map(c => {
    // Support both {key, value} and {name, value} formats
    const key   = c.key || c.name;
    const value = String(c.value ?? "");
    if (!key || !value || key === "x-referer") return null;
    return {
      key,
      value,
      domain:       (c.domain || "facebook.com").replace(/^\./, ""),
      path:         c.path         || "/",
      hostOnly:     c.hostOnly     ?? false,
      creation:     c.creation     || new Date().toISOString(),
      lastAccessed: c.lastAccessed || new Date().toISOString(),
      expires:      c.expires || c.expirationDate
        ? (c.expires || new Date(c.expirationDate * 1000).toISOString())
        : FAR,
    };
  }).filter(Boolean);
}

function dedupCookies(cookies) {
  const map = new Map();
  for (const c of cookies) map.set(`${c.key}@${c.domain}`, c);
  return [...map.values()];
}

function cookiesToString(appState) {
  return appState.map(c => `${c.key}=${c.value}`).join("; ");
}

// ─── Fetch m_sess from messenger.com (optional, for MQTT) ─────────────────────
function fetchMessengerSession(appState) {
  return new Promise((resolve) => {
    const cookieHeader = cookiesToString(appState);
    const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const UA  = global.config?.userAgent ||
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";

    const req = https.request({
      hostname: "www.messenger.com", path: "/", method: "GET",
      headers: { "Cookie": cookieHeader, "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9", "Cache-Control": "no-cache",
        "Connection": "keep-alive" },
    }, (res) => {
      const newCookies = (res.headers["set-cookie"] || []).map(sc => {
        const parts  = sc.split(";");
        const nameVal = parts[0].trim();
        const eqIdx  = nameVal.indexOf("=");
        if (eqIdx < 1) return null;
        const key   = nameVal.slice(0, eqIdx).trim();
        const value = nameVal.slice(eqIdx + 1).trim();
        if (!key || !value) return null;
        let domain = "messenger.com";
        const domPart = parts.find(p => p.trim().toLowerCase().startsWith("domain="));
        if (domPart) domain = domPart.split("=")[1].trim().replace(/^\./, "");
        return { key, value, domain, path: "/", hostOnly: false,
          creation: new Date().toISOString(), lastAccessed: new Date().toISOString(), expires: FAR };
      }).filter(Boolean);

      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        let irisSeqID = null, mqttEndpoint = null;
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          for (const pat of [/irisSeqID:"(\d+)"/, /"iris_seq_id":"(\d+)"/, /"sequence_id"\s*:\s*"?(\d+)"?/]) {
            const m = body.match(pat);
            if (m) { irisSeqID = m[1]; break; }
          }
          for (const pat of [/irisSeqID:"[\d]+",appID:219994525426954,endpoint:"([^"]+)"/, /"app_id":"219994525426954","endpoint":"([^"]+)"/]) {
            const m = body.match(pat);
            if (m) { mqttEndpoint = m[1].replace(/\\\//g, "/"); break; }
          }
        } catch (_) {}
        if (newCookies.length) {
          const hasMsess = newCookies.some(c => c.key === "m_sess");
          log.ok(`messenger.com → ${chalk.cyan(newCookies.length)} cookies, m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`);
        }
        resolve({ newCookies, irisSeqID, mqttEndpoint });
      });
    });
    req.on("error", () => resolve({ newCookies: [], irisSeqID: null, mqttEndpoint: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ newCookies: [], irisSeqID: null, mqttEndpoint: null }); });
    req.end();
  });
}

// ─── Human Typing Simulation ──────────────────────────────────────────────────
async function simulateTyping(api, threadID, replyText) {
  try {
    if (global.config?.humanTyping?.enable === false) return;
    const len = typeof replyText === "string" ? replyText.length : 80;
    const ms  = Math.min(Math.max(len * 35, 600), 7000);
    const jitter = Math.round(ms * (0.80 + Math.random() * 0.40));
    try { api.sendTypingIndicator(threadID); } catch (_) {}
    await new Promise(r => setTimeout(r, jitter));
    await new Promise(r => setTimeout(r, 200 + Math.random() * 500));
  } catch (_) {}
}
global.simulateTyping = simulateTyping;

// ─── HTTP Polling Fallback ─────────────────────────────────────────────────────
function startPolling(api, commands, config) {
  log.warn("MQTT غير متاح — وضع HTTP polling كل 5 ثوانٍ");
  const io = getIO();
  if (io) io.emit("bot-status", { status: "degraded", message: "وضع HTTP Polling — أضف m_sess للـ MQTT الفوري" });

  const processed = new Set();
  let lastCheck   = Date.now() - 30000;

  function pCall(fn, ...args) {
    return new Promise((resolve, reject) =>
      fn(...args, (err, data) => err ? reject(err) : resolve(data))
    );
  }

  let errCount = 0;

  async function poll() {
    try {
      const threads = await pCall(api.getThreadList, 20, null, ["INBOX"]);
      if (!threads) return;
      errCount = 0;
      for (const thread of threads.slice(0, 10)) {
        try {
          const msgs = await pCall(api.getThreadHistory, thread.threadID, 10, null);
          if (!msgs) continue;
          for (const msg of msgs) {
            const ts = Number(msg.timestamp);
            if (ts < lastCheck || !msg.messageID || processed.has(msg.messageID)) continue;
            if (msg.senderID === api.getCurrentUserID()) continue;
            processed.add(msg.messageID);
            if (processed.size > 1000) { const arr = [...processed].slice(500); processed.clear(); arr.forEach(id => processed.add(id)); }
            const event = { type: "message", threadID: msg.threadID || thread.threadID,
              messageID: msg.messageID, senderID: msg.senderID,
              body: msg.body || "", isGroup: !!thread.isGroup,
              timestamp: ts, attachments: msg.attachments || [] };
            if (io) io.emit("message", { senderID: msg.senderID, threadID: event.threadID, body: event.body, isGroup: event.isGroup, timestamp: ts });
            handleEvent(api, event, commands, config).catch(() => {});
          }
        } catch (_) {}
      }
      lastCheck = Date.now() - 2000;
    } catch (e) {
      errCount++;
      if (errCount === 1 || errCount % 10 === 0) {
        const m = (() => { try { return e?.message || e?.error || String(e) || "unknown"; } catch(_){ return "error"; } })();
        log.warn(`Poll (${errCount}x): ${m}`);
      }
    }
  }

  poll();
  const timer = setInterval(poll, 5000);
  global._pollTimer = timer;
  log.ok("HTTP polling نشط — كل 5 ثوانٍ");
}

// ─── Event Handler ────────────────────────────────────────────────────────────
async function handleEvent(api, event, commands, config) {
  const io = getIO();

  if (event.type === "message" || event.type === "message_reply") {
    const body      = event.body || "";
    const prefix    = global.commandPrefix || "/";
    const threadID  = event.threadID;
    const senderID  = event.senderID;
    const isGroup   = event.isGroup;

    log.msg(senderID, threadID, body, isGroup);
    if (io) io.emit("message", { senderID, threadID, body, isGroup, timestamp: Date.now() });

    // Update MQTT activity
    global._lastMqttActivity = Date.now();
    try { require("./protection/mqttHealthCheck").onMqttActivity(); } catch (_) {}

    if (!body.startsWith(prefix)) return;

    const args    = body.slice(prefix.length).trim().split(/\s+/);
    const cmdName = args.shift().toLowerCase();
    const cmd     = commands.get(cmdName);
    if (!cmd) return;

    if (cmd.config.ownerOnly && !isOwner(senderID)) {
      return api.sendMessage("❌ هذا الأمر للمالك فقط.", threadID);
    }
    if (cmd.config.adminOnly && !isAdmin(senderID)) {
      return api.sendMessage("❌ هذا الأمر للأدمنز فقط.", threadID);
    }

    // Rate limit check
    try {
      const rl = require("./protection/rateLimit");
      const key = `cmd:${senderID}:${threadID}`;
      const res = rl.check(key, 8, 10000); // max 8 commands per 10s
      if (res.exceeded) {
        if (!res.warned) {
          rl.setWarned(key);
          api.sendMessage("⚠️ أنت ترسل أوامر بسرعة كبيرة! انتظر قليلاً.", threadID);
        }
        return;
      }
    } catch (_) {}

    log.cmd(cmdName, senderID, threadID);

    const { getOrCreateUser, getOrCreateThread, logCommand } = require("./utils/database");
    try {
      const [user, thread] = await Promise.all([
        getOrCreateUser(senderID),
        getOrCreateThread(threadID, isGroup),
      ]);
      await logCommand(senderID, threadID, cmdName);

      await cmd.run({
        api, event, args, body,
        threadID, senderID, isGroup,
        user, thread,
        prefix,
        isOwner: isOwner(senderID),
        isAdmin: isAdmin(senderID),
        commands,
        config: global.config,
        simulateTyping: (text) => simulateTyping(api, threadID, text),
      });
    } catch (e) {
      log.error(`Command ${cmdName}: ${e.message}`);
      try { api.sendMessage(`❌ خطأ في الأمر: ${e.message}`, threadID); } catch (_) {}
    }
  } else if (event.type === "event") {
    log.info(`حدث جماعي: ${chalk.gray(event.logMessageType || "unknown")}`);
    if (io) io.emit("group-event", { type: event.logMessageType, threadID: event.threadID });
    global._lastMqttActivity = Date.now();
  } else if (event.type === "typ") {
    if (io) io.emit("typing", { from: event.from, isTyping: event.isTyping });
    global._lastMqttActivity = Date.now();
  } else if (event.type === "message_reaction") {
    if (io) io.emit("reaction", { reaction: event.reaction, senderID: event.senderID });
    global._lastMqttActivity = Date.now();
  }
}

// ─── MQTT Listener ────────────────────────────────────────────────────────────
function startListening(api, commands, config, irisSeqID, mqttEndpoint, attempt) {
  const MAX = 5;
  const delay = Math.min(attempt * 8000, 45000);

  log.info(`MQTT اتصال (محاولة ${chalk.cyan(attempt)}/${MAX})…`);

  let mqttStarted = false;
  let authFailed  = false;

  const listenTimer = setTimeout(() => {
    if (!mqttStarted && !authFailed) {
      log.warn("MQTT timeout — تحويل إلى HTTP polling");
      startPolling(api, commands, config);
    }
  }, 30000);

  api.listenMqtt((err, event) => {
    if (err) {
      clearTimeout(listenTimer);
      const io  = getIO();
      const msg = String(err.error || err.message || err.type || err);

      if (msg.includes("Not logged in") || msg.includes("Connection refused")) {
        log.error(`MQTT: ${msg}`);
        authFailed = true;
        if (io) io.emit("bot-status", { status: "error", message: `MQTT فشل: ${msg}` });
        if (attempt < MAX) {
          log.info(`إعادة محاولة MQTT بعد ${delay / 1000}s…`);
          setTimeout(() => startListening(api, commands, config, irisSeqID, mqttEndpoint, attempt + 1), delay);
        } else {
          log.warn("فشل MQTT — تحويل إلى polling");
          startPolling(api, commands, config);
        }
        return;
      }

      if (!mqttStarted) {
        log.warn(`MQTT خطأ: ${msg} — تحويل إلى polling`);
        startPolling(api, commands, config);
        return;
      }

      log.warn(`MQTT خطأ: ${msg}`);
      if (io) io.emit("bot-status", { status: "degraded", message: `MQTT: ${msg}` });
      return;
    }

    if (!mqttStarted) {
      mqttStarted = true;
      clearTimeout(listenTimer);
      log.ok(`MQTT متصل ✔`);
      const io = getIO();
      if (io) io.emit("bot-status", { status: "online", message: `متصل عبر MQTT ✔ (${api.getCurrentUserID()})` });
      global._lastMqttActivity = Date.now();
    }

    if (event) handleEvent(api, event, commands, config).catch(() => {});
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  const lines = [
    "  ╔══════════════════════════════════════════════╗",
    "  ║   🤖  jarfis Bot  v3.0.0                     ║",
    "  ║   ⚡  Powered by fca-unofficial              ║",
    "  ║   🛡️  Protected by jarfis Shield             ║",
    "  ║   👑  Owner: djamel                          ║",
    "  ║   © 2026 djamel — All rights reserved        ║",
    "  ╚══════════════════════════════════════════════╝",
  ].join("\n");
  console.log(gradient.rainbow(lines));
  console.log(chalk.gray(`  Started: ${moment().tz("Africa/Algiers").format("YYYY-MM-DD HH:mm:ss")} (Africa/Algiers)\n`));
}

// ─── Login with retry ─────────────────────────────────────────────────────────
function doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, attempt) {
  const MAX = 3;

  login(loginOptions, async (err, api) => {
    if (err) {
      const msg = err.error || err.message || String(err);
      log.error(`فشل الدخول (محاولة ${attempt}): ${msg}`);
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: `فشل الدخول: ${msg}` });

      if (attempt < MAX) {
        const d = attempt * 5000;
        log.info(`إعادة المحاولة بعد ${d / 1000}s…`);
        setTimeout(() => doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, attempt + 1), d);
      } else {
        if (io) io.emit("bot-status", { status: "offline", message: "فشل الدخول — تحقق من الكوكيز" });
      }
      return;
    }

    // Save merged appstate
    try {
      const fresh = api.getAppState();
      if (fresh?.length) {
        let saved = [];
        try { saved = fs.readJsonSync(APPSTATE_PATH); } catch (_) {}
        const merged = dedupCookies([...fresh, ...saved.filter(c =>
          !fresh.some(f => f.key === c.key && f.domain === c.domain))]);
        fs.writeJsonSync(APPSTATE_PATH, merged, { spaces: 2 });
        log.info(`AppState محفوظ: ${chalk.cyan(merged.length)} كوكي`);
      }
    } catch (_) {}

    const uid = api.getCurrentUserID();
    log.ok(`دخول ناجح ← UID: ${chalk.bold.green(uid)}`);
    global.api = api;
    global._reLoginBot = () => doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, 1);

    api.setOptions({ listenEvents: true, selfListen: false, autoReconnect: false,
      autoMarkDelivery: false, autoMarkRead: false, logLevel: "silent", userAgent });

    const io = getIO();
    if (io) io.emit("bot-status", { status: "online", message: `متصل ✔ (${uid})` });

    // Start protection systems
    try { require("./protection/outgoingThrottle").wrapSendMessage(api); } catch (_) {}
    try { require("./protection/humanTyping").wrapWithTyping(api); } catch (_) {}
    try { require("./protection/stealth").start(api); } catch (_) {}
    try { require("./protection/keepAlive").start(); } catch (_) {}
    try { require("./protection/mqttHealthCheck").startHealthCheck(); } catch (_) {}

    log.ok("🛡️ أنظمة الحماية نشطة (stealth + throttle + typing + keepAlive + MQTT health)");

    setupCronJobs(api);

    // Check m_sess
    let hasMsess = false;
    try { const s = fs.readJsonSync(APPSTATE_PATH); hasMsess = s.some(c => c.key === "m_sess"); } catch (_) {}

    if (hasMsess) {
      log.ok("m_sess موجود — اتصال MQTT…");
      startListening(api, commands, config, irisSeqID, mqttEndpoint, 1);
    } else {
      log.warn("لا يوجد m_sess — تحويل إلى HTTP polling");
      startPolling(api, commands, config);
    }
  });
}

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
function setupCronJobs(api) {
  const jobs = global.config?.cronJobs || [];
  for (const job of jobs) {
    if (!job.cron || !job.threadID || !job.message) continue;
    try {
      cron.schedule(job.cron, () => {
        api.sendMessage(job.message, job.threadID, () => {});
      });
      log.ok(`Cron: "${job.cron}" → ${job.threadID}`);
    } catch (e) {
      log.warn(`Cron خطأ: ${e.message}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  await initDB();
  log.ok("قاعدة البيانات جاهزة");

  const defaults = { botName: "jarfis", prefix: "/", ownerID: "", adminIDs: [],
    dashboardPort: 5000, timezone: "Africa/Algiers", cronJobs: [], dashboardPassword: "djamel2025*",
    humanTyping: { enable: true }, stealth: { enable: true },
    mqttHealthCheck: { enable: true }, keepAlive: { enable: true } };

  const config = fs.existsSync(CONFIG_PATH)
    ? { ...defaults, ...fs.readJsonSync(CONFIG_PATH) }
    : defaults;

  if (!fs.existsSync(CONFIG_PATH)) { fs.writeJsonSync(CONFIG_PATH, defaults, { spaces: 2 }); log.warn("config.json مُنشأ بالقيم الافتراضية"); }

  global.config        = config;
  global.commandPrefix = config.prefix || "/";
  global.ownerID       = config.ownerID || "";
  global.botName       = config.botName || "jarfis";

  log.info(`البوت: ${chalk.bold.cyan(global.botName)}  بادئة: ${chalk.cyan(global.commandPrefix)}  مالك: ${chalk.cyan(global.ownerID || "غير محدد")}`);

  const commands = loadCommands(path.join(__dirname, "commands"));
  global.commands = commands;
  log.ok(`تم تحميل ${chalk.bold(commands.size)} أمر`);

  const port = parseInt(process.env.PORT || config.dashboardPort || 5000, 10);
  await startDashboard(port);
  log.ok(`لوحة التحكم → http://0.0.0.0:${port}`);

  const hasAppState = fs.existsSync(APPSTATE_PATH);
  const hasCreds    = config.email && config.password;

  if (!hasAppState && !hasCreds) {
    log.error("لا توجد كوكيز — ارفع الكوكيز من لوحة التحكم");
    const io = getIO();
    if (io) io.emit("bot-status", { status: "offline", message: "لا توجد كوكيز — ارفع الكوكيز من لوحة التحكم" });
    return;
  }

  const userAgent = config.userAgent ||
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";

  const loginOptions = { forceLogin: false, logLevel: "silent", listenEvents: true,
    selfListen: false, autoReconnect: false, autoMarkDelivery: false, autoMarkRead: false, userAgent };

  let irisSeqID = null, mqttEndpoint = null;

  if (hasAppState) {
    let rawFile;
    try { rawFile = fs.readJsonSync(APPSTATE_PATH); }
    catch (e) { log.error(`خطأ في appstate.json: ${e.message}`); return; }

    let appState;
    try { appState = parseCookieInput(rawFile); appState = dedupCookies(appState); }
    catch (e) {
      if (e.isToken) {
        log.info("كوكيز بصيغة توكن — جارٍ التحويل…");
        try { appState = await getFbstateFromToken(e.token); appState = dedupCookies(appState); }
        catch (e2) { log.error(`خطأ في التوكن: ${e2.message}`); return; }
      } else {
        log.error(`خطأ في الكوكيز: ${e.message}`); return;
      }
    }

    const cUser    = appState.find(c => c.key === "c_user");
    const hasMsess = appState.some(c => c.key === "m_sess");
    const hasXS    = appState.some(c => c.key === "xs");

    log.info(`كوكيز: ${chalk.cyan(appState.length)}  c_user: ${chalk.cyan(cUser?.value || "?")}  xs: ${hasXS ? chalk.green("✔") : chalk.red("✘")}  m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`);

    // Validate cookies via mbasic.facebook.com
    log.info("جارٍ التحقق من الكوكيز عبر mbasic.facebook.com…");
    const cookieStr = cookiesToString(appState);
    const isValid   = await checkLiveCookie(cookieStr, userAgent);

    if (!isValid) {
      log.warn("⚠️ قد تكون الكوكيز منتهية الصلاحية أو غير صالحة — محاولة الدخول على أي حال…");
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: "الكوكيز قد تكون منتهية — جرّب رفع كوكيز جديدة" });
    } else {
      log.ok("✔ الكوكيز صالحة (mbasic.facebook.com)");
    }

    // Try to get m_sess from messenger.com
    log.info("جارٍ جلب m_sess من messenger.com…");
    const msResult = await fetchMessengerSession(appState);
    if (msResult.newCookies.length) {
      appState = dedupCookies([...appState, ...msResult.newCookies]);
    }
    fs.writeJsonSync(APPSTATE_PATH, appState, { spaces: 2 });
    if (msResult.irisSeqID)    irisSeqID    = msResult.irisSeqID;
    if (msResult.mqttEndpoint) mqttEndpoint = msResult.mqttEndpoint;

    loginOptions.appState = appState;
  } else {
    loginOptions.email    = config.email;
    loginOptions.password = config.password;
    log.info(`دخول بالإيميل: ${chalk.cyan(config.email)}`);
  }

  doLogin(loginOptions, commands, config, userAgent, irisSeqID, mqttEndpoint, 1);
}

main().catch(e => { console.error("خطأ رئيسي:", e); process.exit(1); });
