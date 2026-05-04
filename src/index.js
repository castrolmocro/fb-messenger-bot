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

// ─── Cookie system ────────────────────────────────────────────────────────────
// Converts c3c format (key) or Cookie-Editor format (name) → fca-unofficial format
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

// Keep last occurrence of each key+domain pair
function dedupCookies(cookies) {
  const map = new Map();
  for (const c of cookies) map.set(`${c.key}@${c.domain}`, c);
  return [...map.values()];
}

// ─── Fetch m_sess from messenger.com using existing cookies ───────────────────
// When we have Facebook cookies but no m_sess, we visit messenger.com which
// sets m_sess automatically in the Set-Cookie response headers.
function fetchMessengerCookies(appState) {
  return new Promise((resolve) => {
    const cookieHeader = appState.map((c) => `${c.key}=${c.value}`).join("; ");
    const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    const options = {
      hostname: "www.messenger.com",
      path:     "/",
      method:   "GET",
      headers:  {
        "Cookie":     cookieHeader,
        "User-Agent": global.config?.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
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

        // Extract domain from cookie string
        let domain = "messenger.com";
        const domainPart = parts.find((p) => p.trim().toLowerCase().startsWith("domain="));
        if (domainPart) domain = domainPart.split("=")[1].trim().replace(/^\./, "");

        newCookies.push({
          key,
          value,
          domain,
          path:         "/",
          hostOnly:     false,
          creation:     new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          expires:      FAR,
        });
      }

      if (newCookies.length) {
        log.ok(`Fetched ${chalk.cyan(newCookies.length)} cookies from messenger.com`);
        const hasMsess = newCookies.some((c) => c.key === "m_sess");
        if (hasMsess) log.ok("m_sess obtained ✔ — MQTT will work");
        else          log.warn("messenger.com didn't return m_sess — session may be expired");
      } else {
        log.warn("No new cookies from messenger.com");
      }

      resolve(newCookies);
    });

    req.on("error", (e) => {
      log.warn(`messenger.com request failed: ${e.message}`);
      resolve([]);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      log.warn("messenger.com request timed out");
      resolve([]);
    });

    req.end();
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  const lines = [
    "  ╔══════════════════════════════════════════╗",
    "  ║   📦 FB Messenger Userbot  v2.2.0        ║",
    "  ║   ⚡ Powered by fca-unofficial           ║",
    "  ║   🌍 github.com/castrolmocro             ║",
    "  ╚══════════════════════════════════════════╝",
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
    botName: "FCA Bot", prefix: "/", ownerID: "",
    adminIDs: [], dashboardPort: 8080, timezone: "Africa/Algiers", cronJobs: [],
  };
  const config = fs.existsSync(CONFIG_PATH)
    ? { ...defaults, ...fs.readJsonSync(CONFIG_PATH) }
    : defaults;

  if (!fs.existsSync(CONFIG_PATH)) log.warn("config.json not found — using defaults");

  global.config        = config;
  global.commandPrefix = config.prefix || "/";
  global.ownerID       = config.ownerID || "";
  global.botName       = config.botName || "FCA Bot";

  log.info(`Bot: ${chalk.bold.cyan(global.botName)}  prefix: ${chalk.cyan(global.commandPrefix)}  owner: ${chalk.cyan(global.ownerID || "not set")}`);

  const commands = loadCommands(path.join(__dirname, "commands"));
  global.commands = commands;
  log.ok(`Loaded ${chalk.bold(commands.size)} commands`);

  // Start dashboard on 0.0.0.0 so Replit proxy can reach it
  const port = parseInt(process.env.PORT || config.dashboardPort || 8080, 10);
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const loginOptions = {
    forceLogin:       false,   // MUST be false for cookie-based login
    logLevel:         "silent",
    listenEvents:     true,
    selfListen:       false,
    autoReconnect:    false,
    autoMarkDelivery: false,
    autoMarkRead:     false,
    userAgent,
  };

  // ── Load & normalise cookies ───────────────────────────────────────────────
  if (hasAppState) {
    let raw;
    try { raw = fs.readJsonSync(APPSTATE_PATH); }
    catch (e) { log.error(`Cannot read appstate.json: ${e.message}`); return; }

    let appState;
    try {
      appState = cookiesToAppState(raw);
      appState = dedupCookies(appState);
    } catch (e) { log.error(`Cookie error: ${e.message}`); return; }

    const cUser   = appState.find((c) => c.key === "c_user");
    const hasMsess = appState.some((c) => c.key === "m_sess");
    const hasXS    = appState.some((c) => c.key === "xs");

    log.info(
      `Cookies: ${chalk.cyan(appState.length)}  c_user: ${chalk.cyan(cUser?.value || "?")}  ` +
      `xs: ${hasXS ? chalk.green("✔") : chalk.red("✘")}  m_sess: ${hasMsess ? chalk.green("✔") : chalk.yellow("✘")}`
    );

    // ── If m_sess is missing, fetch it from messenger.com first ───────────────
    if (!hasMsess) {
      log.info("m_sess not found — fetching from messenger.com…");
      const messengerCookies = await fetchMessengerCookies(appState);
      if (messengerCookies.length) {
        appState = dedupCookies([...appState, ...messengerCookies]);
        fs.writeJsonSync(APPSTATE_PATH, appState, { spaces: 2 });
        const gotMsess = appState.some((c) => c.key === "m_sess");
        log.info(`AppState updated: ${chalk.cyan(appState.length)} cookies  m_sess: ${gotMsess ? chalk.green("✔") : chalk.yellow("✘")}`);
      }
    } else {
      fs.writeJsonSync(APPSTATE_PATH, appState, { spaces: 2 });
    }

    loginOptions.appState = appState;

  } else {
    loginOptions.email    = config.email;
    loginOptions.password = config.password;
    log.info(`Login with email: ${chalk.cyan(config.email)}`);
  }

  console.log();
  doLogin(loginOptions, commands, config, userAgent, 1);
}

// ─── Login with retry ─────────────────────────────────────────────────────────
function doLogin(loginOptions, commands, config, userAgent, attempt) {
  const MAX = 3;

  login(loginOptions, async (err, api) => {
    if (err) {
      const msg = err.error || err.message || String(err);
      log.error(`Login failed (attempt ${attempt}): ${msg}`);
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: `Login error: ${msg}` });

      if (attempt < MAX) {
        const delay = attempt * 5000;
        log.info(`Retrying in ${delay / 1000}s…`);
        setTimeout(() => doLogin(loginOptions, commands, config, userAgent, attempt + 1), delay);
      } else {
        if (io) io.emit("bot-status", { status: "offline", message: "فشل الدخول — تحقق من الكوكيز" });
      }
      return;
    }

    // Save refreshed appState (includes any new cookies Facebook set)
    try {
      const fresh = api.getAppState();
      if (fresh && fresh.length) {
        // Merge: keep messenger.com cookies + fresh facebook.com ones
        let saved = [];
        try { saved = fs.readJsonSync(APPSTATE_PATH); } catch (_) {}
        const merged = dedupCookies([...fresh, ...saved.filter((c) =>
          !fresh.some((f) => f.key === c.key && f.domain === c.domain)
        )]);
        fs.writeJsonSync(APPSTATE_PATH, merged, { spaces: 2 });

        const hasMsess = merged.some((c) => c.key === "m_sess");
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
    startListening(api, commands, config, 1);
  });
}

// ─── MQTT Listener ────────────────────────────────────────────────────────────
function startListening(api, commands, config, attempt) {
  const MAX   = 10;
  const delay = Math.min(attempt * 8000, 60000);

  log.info(`Listener starting (attempt ${chalk.cyan(attempt)}/${MAX})…`);

  api.listenMqtt((err, event) => {
    if (err) {
      const io  = getIO();
      const msg = err.error || err.message || String(err);

      if (err.code === 21 || msg.includes("MQTT_AUTH_REFUSED") || msg.includes("Not logged in")) {
        log.error(`MQTT auth failed — m_sess missing or expired`);
        console.log(chalk.yellow("\n  ┌─ الحل ─────────────────────────────────────────────────────┐"));
        console.log(chalk.yellow("  │  ١. افتح messenger.com في Chrome وأنت مسجّل الدخول         │"));
        console.log(chalk.yellow("  │  ٢. اضغط على أي محادثة                                     │"));
        console.log(chalk.yellow("  │  ٣. Cookie-Editor → Export JSON → الصق في لوحة التحكم      │"));
        console.log(chalk.yellow("  └────────────────────────────────────────────────────────────┘\n"));
        if (io) io.emit("bot-status", {
          status: "error",
          message: "MQTT رُفض — الصق كوكيز messenger.com في لوحة التحكم",
        });
        return;
      }

      log.error(`Listener error: ${msg}`);
      if (io) io.emit("bot-status", {
        status: "error",
        message: `إعادة الاتصال خلال ${delay / 1000}ث… (${attempt}/${MAX})`,
      });

      if (attempt < MAX) {
        setTimeout(() => startListening(api, commands, config, attempt + 1), delay);
      } else {
        log.error("Max reconnect attempts reached");
        if (io) io.emit("bot-status", { status: "offline", message: "انقطع الاتصال — أعد تشغيل البوت" });
      }
      return;
    }

    if (!event) return;

    const io = getIO();
    if (io) io.emit("event", { type: event.type, timestamp: Date.now() });

    handleEvent(api, event, commands, config).catch((e) =>
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
    if (io) io.emit("typing", { from: event.from, isTyping: event.isTyping, timestamp: Date.now() });
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
