require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const login = require("fca-unofficial");
const fs = require("fs-extra");
const path = require("path");
const gradient = require("gradient-string");
const chalk = require("chalk");
const moment = require("moment-timezone");
const { initDB, getOrCreateUser } = require("./utils/database");
const { loadCommands } = require("./utils/loader");
const { startDashboard, getIO } = require("./dashboard/server");
const cron = require("node-cron");

const CONFIG_PATH = path.join(__dirname, "../config.json");
const APPSTATE_PATH = path.join(__dirname, "../appstate.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ts = () => moment().tz(global.config?.timezone || "Africa/Algiers").format("HH:mm:ss");

const log = {
  info:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.cyan("•")} ${msg}`),
  ok:    (msg) => console.log(`${chalk.gray(ts())} ${chalk.green("✔")} ${chalk.green(msg)}`),
  warn:  (msg) => console.log(`${chalk.gray(ts())} ${chalk.yellow("⚠")} ${chalk.yellow(msg)}`),
  error: (msg) => console.log(`${chalk.gray(ts())} ${chalk.red("✘")} ${chalk.red(msg)}`),
  cmd:   (name, sender, thread) =>
    console.log(`${chalk.gray(ts())} ${chalk.magenta("›")} cmd ${chalk.bold.magenta(name)} ${chalk.gray("from")} ${chalk.cyan(sender)} ${chalk.gray("in")} ${chalk.cyan(thread)}`),
  msg:   (sender, thread, body) =>
    console.log(`${chalk.gray(ts())} ${chalk.blue("↩")} ${chalk.blue(sender)} ${chalk.gray("→")} ${chalk.blue(thread)}: ${chalk.white(String(body).slice(0, 80))}`),
  event: (type) =>
    console.log(`${chalk.gray(ts())} ${chalk.gray("◦")} event ${chalk.gray(type)}`),
};

// ─── Admin helpers ────────────────────────────────────────────────────────────
function isOwner(id) {
  return String(id) === String(global.ownerID);
}
function isAdmin(id) {
  if (isOwner(id)) return true;
  return (global.config?.adminIDs || []).map(String).includes(String(id));
}
global.isOwner = isOwner;
global.isAdmin = isAdmin;

// ─── Cookie normalizer: c3c (key), Cookie-Editor (name), any format ───────────
function normalizeCookies(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return raw;
  const first = raw[0];
  if (first.key) {
    return raw.map((c) => ({
      ...c,
      domain: (c.domain || "facebook.com").replace(/^\./, ""),
      expires: c.expires || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    }));
  }
  if (first.name) {
    return raw.map((c) => ({
      key: c.name,
      value: c.value,
      domain: (c.domain || "facebook.com").replace(/^\./, ""),
      path: c.path || "/",
      hostOnly: c.hostOnly || false,
      expires: c.expirationDate
        ? new Date(c.expirationDate * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      creation: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    }));
  }
  return raw;
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  const lines = [
    "  ╔══════════════════════════════════════════╗",
    "  ║   📦 FB Messenger Userbot  v1.0.0        ║",
    "  ║   ⚡ Powered by fca-unofficial           ║",
    "  ║   🌍 github.com/castrolmocro/fb-bot      ║",
    "  ╚══════════════════════════════════════════╝",
  ].join("\n");
  console.log(gradient.rainbow(lines));
  const tz = "Africa/Algiers";
  console.log(chalk.gray(`  Started: ${moment().tz(tz).format("YYYY-MM-DD HH:mm:ss")} (${tz})\n`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  await initDB();
  log.ok("Database ready");

  let config = {
    botName: "FCA Bot",
    prefix: "/",
    ownerID: "",
    adminIDs: [],
    dashboardPort: 3000,
    timezone: "Africa/Algiers",
    cronJobs: [],
  };

  if (fs.existsSync(CONFIG_PATH)) {
    config = { ...config, ...fs.readJsonSync(CONFIG_PATH) };
  } else {
    log.warn("config.json not found — running in dashboard-only mode");
  }

  global.config        = config;
  global.commandPrefix = config.prefix || "/";
  global.ownerID       = config.ownerID || "";
  global.botName       = config.botName || "FCA Bot";

  log.info(`Owner: ${chalk.cyan(global.ownerID || "not set")}   Admins: ${chalk.cyan((config.adminIDs || []).length)}`);

  const commands = loadCommands(path.join(__dirname, "commands"));
  global.commands = commands;
  log.ok(`Loaded ${chalk.bold(commands.size)} commands`);

  // Use PORT env var (set by Replit workflow) or fallback to config
  const port = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || config.dashboardPort || 3000, 10);
  await startDashboard(port);
  log.ok(`Dashboard → http://localhost:${port}`);

  // Check credentials
  const hasAppState   = fs.existsSync(APPSTATE_PATH);
  const hasCreds      = config.email && config.password;

  if (!hasAppState && !hasCreds) {
    log.error("No credentials! Add appstate.json or email/password in config.json");
    const io = getIO();
    if (io) io.emit("bot-status", { status: "offline", message: "No credentials — add appstate.json" });
    return;
  }

  // ── Build login options ────────────────────────────────────────────────────
  const loginOptions = {
    forceLogin: false,
    logLevel: "silent",
    userAgent: config.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  if (hasAppState) {
    let raw = fs.readJsonSync(APPSTATE_PATH);
    const norm = normalizeCookies(raw);
    if (JSON.stringify(norm) !== JSON.stringify(raw)) {
      fs.writeJsonSync(APPSTATE_PATH, norm, { spaces: 2 });
      log.info("Cookies normalized to c3c format");
      raw = norm;
    }
    loginOptions.appState = raw;
    const hasMsess = raw.some((c) => c.key === "m_sess");
    log.info(`AppState: ${chalk.cyan(raw.length)} cookies  |  m_sess: ${hasMsess ? chalk.green("✔") : chalk.red("✘")}`);
  } else {
    loginOptions.email    = config.email;
    loginOptions.password = config.password;
    log.info(`Logging in as ${chalk.cyan(config.email)} …`);
  }

  console.log();

  // ── Login ──────────────────────────────────────────────────────────────────
  login(loginOptions, (err, api) => {
    if (err) {
      log.error(`Login failed: ${err.error || err.message || String(err)}`);
      const io = getIO();
      if (io) io.emit("bot-status", { status: "error", message: String(err.error || err.message || err) });
      return;
    }

    // Save refreshed appState
    fs.writeJsonSync(APPSTATE_PATH, api.getAppState(), { spaces: 2 });
    log.ok(`Logged in as ${chalk.bold.green(api.getCurrentUserID())}`);

    global.api = api;
    api.setOptions({
      listenEvents: true,
      selfListen:   false,
      autoReconnect: false,
      online:       true,
      logLevel:     "silent",
      userAgent:    loginOptions.userAgent,
    });

    const io = getIO();
    if (io) io.emit("bot-status", { status: "online", message: "Bot logged in — starting listener…" });

    setupCronJobs(api);
    console.log();
    startListening(api, commands, config);
  });
}

// ─── Listener with auto-reconnect ─────────────────────────────────────────────
function startListening(api, commands, config, attempt = 1) {
  const MAX     = 8;
  const delay   = Math.min(attempt * 8000, 45000);

  log.info(`Starting listener… (attempt ${chalk.cyan(attempt)}/${MAX})`);

  api.listenMqtt((err, event) => {
    if (err) {
      const io  = getIO();
      const code = err.code;
      const msg  = err.error || err.message || "";

      // Code 21 = auth refused — missing m_sess, explain clearly and stop
      if (code === 21 || msg === "MQTT_AUTH_REFUSED") {
        console.log();
        log.error("MQTT auth refused (code 21) — m_sess cookie missing");
        console.log(chalk.yellow("  ┌─ How to fix ──────────────────────────────────────────┐"));
        console.log(chalk.yellow("  │  1. Open https://www.messenger.com in Chrome           │"));
        console.log(chalk.yellow("  │  2. Click on any conversation to open it               │"));
        console.log(chalk.yellow("  │  3. Click Cookie-Editor → Export JSON → copy           │"));
        console.log(chalk.yellow("  │  4. Paste into appstate.json and restart the bot       │"));
        console.log(chalk.yellow("  └────────────────────────────────────────────────────────┘"));
        console.log();
        if (io) io.emit("bot-status", {
          status: "error",
          message: "❌ m_sess missing — export cookies from messenger.com (open a chat first), paste in appstate.json, restart."
        });
        return;
      }

      log.error(`Listener error: ${msg || JSON.stringify(err).slice(0, 100)}`);
      if (io) io.emit("bot-status", { status: "error", message: `Reconnecting in ${delay / 1000}s…` });

      if (attempt < MAX) {
        setTimeout(() => startListening(api, commands, config, attempt + 1), delay);
      } else {
        log.error("Max reconnect attempts reached — giving up");
        if (io) io.emit("bot-status", { status: "offline", message: "Bot disconnected — max retries." });
      }
      return;
    }

    if (!event) return;

    const io = getIO();
    if (io) io.emit("event", { type: event.type, timestamp: Date.now() });

    handleEvent(api, event, commands, config);
  });
}

// ─── Event handler ────────────────────────────────────────────────────────────
async function handleEvent(api, event, commands, config) {
  const io = getIO();

  // ── Message / reply ──────────────────────────────────────────────────────
  if (event.type === "message" || event.type === "message_reply") {
    const { threadID, messageID, senderID, body } = event;

    if (senderID === api.getCurrentUserID()) return;

    // Ban check
    try {
      const user = await getOrCreateUser(senderID, null);
      if (user.banned && !isAdmin(senderID)) {
        return; // silently ignore banned users
      }
    } catch (_) {}

    if (io) io.emit("message", { senderID, threadID, body: body || "", timestamp: Date.now() });
    if (body) log.msg(senderID, threadID, body);

    const prefix = global.commandPrefix;
    if (!body || !body.startsWith(prefix)) return;

    const args        = body.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const cmd         = commands.get(commandName);
    if (!cmd) return;

    // Permission check
    if (cmd.config?.ownerOnly && !isOwner(senderID)) {
      return api.sendMessage("⛔ هذا الأمر للمالك فقط.", threadID);
    }
    if (cmd.config?.adminOnly && !isAdmin(senderID)) {
      return api.sendMessage("⛔ هذا الأمر للأدمنز فقط.", threadID);
    }

    log.cmd(commandName, senderID, threadID);

    try {
      await cmd.run({ api, event, args, threadID, messageID, senderID });
    } catch (e) {
      log.error(`[${commandName}] ${e.message}`);
      api.sendMessage(`❌ خطأ في الأمر: ${e.message}`, threadID);
    }
    return;
  }

  // ── Typing ───────────────────────────────────────────────────────────────
  if (event.type === "typ") {
    if (io) io.emit("typing", { from: event.from, isTyping: event.isTyping, timestamp: Date.now() });
    return;
  }

  // ── Reactions ────────────────────────────────────────────────────────────
  if (event.type === "message_reaction") {
    if (io) io.emit("reaction", { reaction: event.reaction, timestamp: Date.now() });
    return;
  }

  // ── Group events ─────────────────────────────────────────────────────────
  if (event.type === "event") {
    log.event(event.logMessageType || "group_event");
    if (io) io.emit("group-event", { logMessageType: event.logMessageType, timestamp: Date.now() });
    return;
  }

  // ── Presence ─────────────────────────────────────────────────────────────
  if (event.type === "presence") {
    if (io) io.emit("presence", { userID: event.userID, timestamp: Date.now() });
    return;
  }
}

// ─── Cron jobs ────────────────────────────────────────────────────────────────
function setupCronJobs(api) {
  const jobs = global.config?.cronJobs || [];
  if (!jobs.length) return;
  console.log();
  jobs.forEach((job) => {
    if (!cron.validate(job.schedule)) return;
    cron.schedule(job.schedule, () => {
      if (!job.threadID || !job.message) return;
      api.sendMessage(job.message, job.threadID);
      log.info(`Cron → ${job.threadID}`);
    });
    log.info(`Cron registered: ${chalk.magenta(job.schedule)} → ${chalk.cyan(job.threadID)}`);
  });
}

// ─── Entry ────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
