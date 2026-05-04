const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const bodyParser = require("body-parser");
const fs         = require("fs-extra");
const crypto     = require("crypto");
const { getStats } = require("../utils/database");

const APPSTATE_PATH  = path.join(__dirname, "../../appstate.json");
const CONFIG_PATH    = path.join(__dirname, "../../config.json");
const COMMANDS_DIR   = path.join(__dirname, "../commands");
const DEFAULT_PASS   = "djamel2025*";

let io;

// ─── Sessions ────────────────────────────────────────────────────────────────
const sessions = new Map();

function genToken() { return crypto.randomBytes(32).toString("hex"); }

function parseCookies(str = "") {
  const out = {};
  for (const part of str.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function getDashPass() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return fs.readJsonSync(CONFIG_PATH).dashboardPassword || DEFAULT_PASS; } catch {}
  }
  return DEFAULT_PASS;
}

function isAuth(req) {
  const sid = parseCookies(req.headers.cookie || "")["_fca_sid"];
  return sid && sessions.has(sid);
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────
function normalizeCookies(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("يجب أن يكون JSON مصفوفة غير فارغة");
  const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  return raw.map(c => {
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

function dedup(arr) {
  const map = new Map();
  for (const c of arr) map.set(`${c.key}@${c.domain}`, c);
  return [...map.values()];
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authMW(req, res, next) {
  const open = ["/api/login", "/api/ping"];
  if (open.includes(req.path) || req.path.startsWith("/socket.io")) return next();
  if (isAuth(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ─── Start dashboard ──────────────────────────────────────────────────────────
async function startDashboard(port) {
  const app    = express();
  const server = http.createServer(app);

  app.set("trust proxy", 1);

  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],
    allowEIO3: true,
  });

  app.use(bodyParser.json({ limit: "10mb" }));
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(authMW);
  app.use(express.static(path.join(__dirname, "public")));

  // ── Auth ───────────────────────────────────────────────────────────────────
  app.post("/api/login", (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "كلمة المرور مطلوبة" });
    if (password !== getDashPass()) return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
    const token = genToken();
    sessions.set(token, { at: Date.now() });
    res.setHeader("Set-Cookie", `_fca_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    res.json({ success: true });
  });

  app.post("/api/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie || "")["_fca_sid"];
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", "_fca_sid=; Path=/; Max-Age=0");
    res.json({ success: true });
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await getStats();
      const cfg   = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      res.json({
        ...stats,
        uptime:     process.uptime(),
        commands:   global.commands ? global.commands.size : 0,
        botName:    global.botName  || "jarfis",
        prefix:     global.commandPrefix || "/",
        ownerID:    global.ownerID || "",
        adminCount: (cfg.adminIDs || []).length,
        online:     !!global.api,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Config ─────────────────────────────────────────────────────────────────
  app.get("/api/config", (_req, res) => {
    const cfg  = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
    const safe = { ...cfg };
    delete safe.dashboardPassword;
    res.json(safe);
  });

  app.post("/api/config", (req, res) => {
    try {
      const cur = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      const upd = { ...cur, ...req.body };
      if (!req.body.dashboardPassword) upd.dashboardPassword = cur.dashboardPassword;
      fs.writeJsonSync(CONFIG_PATH, upd, { spaces: 2 });
      global.config        = upd;
      global.botName       = upd.botName  || "jarfis";
      global.commandPrefix = upd.prefix   || "/";
      global.ownerID       = upd.ownerID  || "";
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/config/password", (req, res) => {
    const { current, newPassword } = req.body || {};
    if (!current || !newPassword) return res.status(400).json({ error: "الحقول مطلوبة" });
    if (current !== getDashPass()) return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
    try {
      const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      cfg.dashboardPassword = newPassword;
      fs.writeJsonSync(CONFIG_PATH, cfg, { spaces: 2 });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admins ─────────────────────────────────────────────────────────────────
  app.get("/api/admins", (_req, res) => {
    const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
    res.json({ ownerID: cfg.ownerID || "", adminIDs: cfg.adminIDs || [] });
  });

  app.post("/api/admins", (req, res) => {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: "uid مطلوب" });
    try {
      const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      const ids = cfg.adminIDs || [];
      if (!ids.includes(String(uid))) ids.push(String(uid));
      cfg.adminIDs = ids;
      fs.writeJsonSync(CONFIG_PATH, cfg, { spaces: 2 });
      if (global.config) global.config.adminIDs = ids;
      res.json({ success: true, adminIDs: ids });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admins/:uid", (req, res) => {
    try {
      const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      cfg.adminIDs = (cfg.adminIDs || []).filter(id => id !== req.params.uid);
      fs.writeJsonSync(CONFIG_PATH, cfg, { spaces: 2 });
      if (global.config) global.config.adminIDs = cfg.adminIDs;
      res.json({ success: true, adminIDs: cfg.adminIDs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Commands ───────────────────────────────────────────────────────────────
  app.get("/api/commands", (_req, res) => {
    if (!global.commands) return res.json([]);
    const seen = new Set();
    const list = [];
    for (const [, cmd] of global.commands) {
      if (!seen.has(cmd.config.name)) {
        seen.add(cmd.config.name);
        list.push({
          name:        cmd.config.name,
          description: cmd.config.description || "",
          usage:       cmd.config.usage       || cmd.config.name,
          adminOnly:   !!cmd.config.adminOnly,
          ownerOnly:   !!cmd.config.ownerOnly,
          aliases:     cmd.config.aliases || [],
        });
      }
    }
    res.json(list);
  });

  app.get("/api/commands/:name/source", (req, res) => {
    const fp = path.join(COMMANDS_DIR, `${req.params.name}.js`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "الأمر غير موجود" });
    try { res.json({ source: fs.readFileSync(fp, "utf8"), name: req.params.name }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/commands", (req, res) => {
    const { name, source } = req.body || {};
    if (!name || !source) return res.status(400).json({ error: "name و source مطلوبان" });
    const safe = name.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    if (!safe) return res.status(400).json({ error: "اسم غير صالح" });
    const fp = path.join(COMMANDS_DIR, `${safe}.js`);
    if (fs.existsSync(fp)) return res.status(409).json({ error: "الأمر موجود بالفعل" });
    try {
      fs.writeFileSync(fp, source, "utf8");
      try {
        delete require.cache[require.resolve(fp)];
        const cmd = require(fp);
        if (cmd.config?.name) {
          [cmd.config.name, ...(cmd.config.aliases || [])].forEach(n => global.commands?.set(n.toLowerCase(), cmd));
        }
      } catch (_) {}
      res.json({ success: true, name: safe });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/commands/:name", (req, res) => {
    const { source } = req.body || {};
    if (!source) return res.status(400).json({ error: "source مطلوب" });
    const fp = path.join(COMMANDS_DIR, `${req.params.name}.js`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "الأمر غير موجود" });
    try {
      fs.writeFileSync(fp, source, "utf8");
      try {
        delete require.cache[require.resolve(fp)];
        const cmd = require(fp);
        if (cmd.config?.name) {
          [cmd.config.name, ...(cmd.config.aliases || [])].forEach(n => global.commands?.set(n.toLowerCase(), cmd));
        }
      } catch (_) {}
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/commands/:name", (req, res) => {
    const fp = path.join(COMMANDS_DIR, `${req.params.name}.js`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "الأمر غير موجود" });
    try {
      fs.unlinkSync(fp);
      if (global.commands) {
        for (const [k, cmd] of global.commands) {
          if (cmd.config.name === req.params.name) global.commands.delete(k);
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Send ───────────────────────────────────────────────────────────────────
  app.post("/api/send", async (req, res) => {
    const { threadID, message } = req.body || {};
    if (!global.api)           return res.status(503).json({ error: "البوت غير متصل" });
    if (!threadID || !message) return res.status(400).json({ error: "threadID و message مطلوبان" });
    try {
      await new Promise((ok, fail) =>
        global.api.sendMessage(message, threadID, e => (e ? fail(e) : ok()))
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Cookies ────────────────────────────────────────────────────────────────
  app.post("/api/cookies", (req, res) => {
    try {
      let raw = req.body.cookies;
      if (typeof raw === "string") raw = JSON.parse(raw);
      const norm   = normalizeCookies(raw);
      const deduped = dedup(norm);
      if (!deduped.length) return res.status(400).json({ error: "مصفوفة الكوكيز فارغة" });

      const hasUser  = deduped.some(c => c.key === "c_user");
      const hasXS    = deduped.some(c => c.key === "xs");
      const hasMsess = deduped.some(c => c.key === "m_sess");
      const cUser    = deduped.find(c => c.key === "c_user");

      if (!hasUser) return res.status(400).json({ error: "c_user مفقود — الكوكيز ناقصة" });
      if (!hasXS)   return res.status(400).json({ error: "xs مفقود — الكوكيز ناقصة" });

      fs.writeJsonSync(APPSTATE_PATH, deduped, { spaces: 2 });
      res.json({ success: true, count: deduped.length, hasMsess, uid: cUser?.value || "" });
      if (io) io.emit("cookies-updated", { count: deduped.length, hasMsess, uid: cUser?.value || "" });
    } catch (e) { res.status(400).json({ error: "خطأ في التحليل: " + e.message }); }
  });

  app.get("/api/cookies", (_req, res) => {
    if (!fs.existsSync(APPSTATE_PATH)) return res.json({ exists: false, count: 0, hasMsess: false, uid: "" });
    try {
      const raw      = fs.readJsonSync(APPSTATE_PATH);
      const hasMsess = Array.isArray(raw) && raw.some(c => c.key === "m_sess");
      const cUser    = Array.isArray(raw) && raw.find(c => c.key === "c_user");
      res.json({ exists: true, count: Array.isArray(raw) ? raw.length : 0, hasMsess, uid: cUser?.value || "" });
    } catch { res.json({ exists: false, count: 0, hasMsess: false, uid: "" }); }
  });

  app.delete("/api/cookies", (_req, res) => {
    try {
      if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
      res.json({ success: true });
      if (io) io.emit("cookies-updated", { count: 0, hasMsess: false, uid: "" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Restart ────────────────────────────────────────────────────────────────
  app.post("/api/restart", (_req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 500);
  });

  // ── Ping ──────────────────────────────────────────────────────────────────
  app.get("/api/ping", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // ── Socket ─────────────────────────────────────────────────────────────────
  io.on("connection", socket => {
    const uid = global.api ? global.api.getCurrentUserID() : null;
    socket.emit("bot-status", {
      status:  global.api ? "online" : "offline",
      message: global.api ? `متصل ✔ (${uid})` : "البوت غير متصل",
    });
  });

  await new Promise(resolve => server.listen(port, "0.0.0.0", resolve));
  return { app, server, io };
}

function getIO() { return io; }
module.exports = { startDashboard, getIO };
