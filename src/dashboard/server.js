const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const bodyParser = require("body-parser");
const fs         = require("fs-extra");
const crypto     = require("crypto");
const multer     = require("multer");

const ACCOUNT_PATH  = path.join(__dirname, "../../account.txt");
const CONFIG_PATH   = path.join(__dirname, "../../config.json");
const COMMANDS_DIR  = path.join(__dirname, "../commands");
const UPLOADS_DIR   = path.join(__dirname, "public/uploads");
const DEFAULT_PASS  = "djamel2025*";

fs.ensureDirSync(UPLOADS_DIR);

let io;
const sessions = new Map();

// ─── Multer for media uploads ──────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|wav|m4a|pdf|txt)$/i;
    cb(null, allowed.test(file.originalname));
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
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
function authMW(req, res, next) {
  const open = ["/api/login", "/api/ping"];
  if (open.includes(req.path) || req.path.startsWith("/socket.io")) return next();
  if (isAuth(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ─── Cookie parsing (same as utils/cookieParser.js — standalone for server) ───
const { parseCookieInput, cookiesToString, hasMandatory, dedup } = require("../utils/cookieParser");
const checkLiveCookie = require("../utils/checkLiveCookie");

async function startDashboard(port) {
  const app    = express();
  const server = http.createServer(app);
  app.set("trust proxy", 1);

  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],
    allowEIO3: true,
  });

  app.use(bodyParser.json({ limit: "15mb" }));
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

  // ── Ping ──────────────────────────────────────────────────────────────────
  app.get("/api/ping", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // ── Stats ──────────────────────────────────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    try {
      const { getStats } = require("../utils/database");
      const stats = await getStats();
      const cfg   = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      res.json({
        ...stats,
        uptime:      process.uptime(),
        commands:    global.commands ? global.commands.size : 0,
        botName:     global.botName  || "jarfis",
        prefix:      global.commandPrefix || "/",
        ownerID:     global.ownerID || "",
        adminCount:  (cfg.adminIDs || []).length,
        online:      !!global.api,
        uid:         global.api ? global.api.getCurrentUserID() : null,
        memMB:       Math.round(process.memoryUsage().rss / 1024 / 1024),
        nodeVersion: process.version,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Config ─────────────────────────────────────────────────────────────────
  app.get("/api/config", (_req, res) => {
    const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
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
          usage:       cmd.config.usage || cmd.config.name,
          adminOnly:   !!cmd.config.adminOnly,
          ownerOnly:   !!cmd.config.ownerOnly,
          aliases:     cmd.config.aliases || [],
          category:    cmd.config.category || "general",
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
        if (cmd.config?.name)
          [cmd.config.name, ...(cmd.config.aliases || [])].forEach(n => global.commands?.set(n.toLowerCase(), cmd));
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
        if (cmd.config?.name)
          [cmd.config.name, ...(cmd.config.aliases || [])].forEach(n => global.commands?.set(n.toLowerCase(), cmd));
      } catch (_) {}
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/commands/:name", (req, res) => {
    const fp = path.join(COMMANDS_DIR, `${req.params.name}.js`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "الأمر غير موجود" });
    try {
      fs.unlinkSync(fp);
      if (global.commands)
        for (const [k, cmd] of global.commands)
          if (cmd.config.name === req.params.name) global.commands.delete(k);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Send ───────────────────────────────────────────────────────────────────
  app.post("/api/send", async (req, res) => {
    const { threadID, message } = req.body || {};
    if (!global.api) return res.status(503).json({ error: "البوت غير متصل" });
    if (!threadID || !message) return res.status(400).json({ error: "threadID و message مطلوبان" });
    try {
      await new Promise((ok, fail) => global.api.sendMessage(message, threadID, e => e ? fail(e) : ok()));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Cookies (account.txt) ──────────────────────────────────────────────────
  // GET current cookie status
  app.get("/api/cookies", (_req, res) => {
    if (!fs.existsSync(ACCOUNT_PATH)) return res.json({ exists: false, count: 0, uid: "" });
    try {
      const raw = fs.readFileSync(ACCOUNT_PATH, "utf8").trim();
      if (!raw) return res.json({ exists: false, count: 0, uid: "" });

      // Is it a token?
      if (/^EAA[A-Za-z0-9]+$/.test(raw)) {
        return res.json({ exists: true, count: 0, uid: "", isToken: true, format: "token" });
      }

      // Try to parse
      const { parseCookieInput: parseCI } = require("../utils/cookieParser");
      const parsed = parseCI(raw);
      if (parsed.isToken) return res.json({ exists: true, count: 0, uid: "", isToken: true, format: "token" });
      const cookies = parsed.cookies || [];
      const cUser = cookies.find(c => c.key === "c_user");
      return res.json({
        exists: true,
        count: cookies.length,
        uid: cUser?.value || "",
        format: "cookies",
      });
    } catch {
      return res.json({ exists: true, count: 0, uid: "", format: "unknown" });
    }
  });

  // POST save cookies (all formats) + hot-swap bot account
  app.post("/api/cookies", async (req, res) => {
    try {
      let raw = req.body.cookies;
      if (typeof raw === "string") raw = raw.trim();
      if (!raw) return res.status(400).json({ error: "الكوكيز فارغة" });

      const userAgent = global.config?.userAgent ||
        "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36";

      // Parse
      let parsed;
      try { parsed = parseCookieInput(raw); }
      catch (e) { return res.status(400).json({ error: e.message }); }

      // If token — convert directly
      if (parsed.isToken) {
        const getFbstate = require("../utils/getFbstateFromToken");
        try {
          const cookies = await getFbstate(parsed.token);
          const deduped = dedup(cookies);
          if (!deduped.length) return res.status(400).json({ error: "التوكن لم يُرجع كوكيز" });
          const cUser = deduped.find(c => c.key === "c_user");
          // Save as JSON array
          fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(deduped, null, 2), "utf8");
          if (io) io.emit("cookies-updated", { count: deduped.length, uid: cUser?.value || "", format: "token" });
          // Hot-swap
          setTimeout(() => { if (global.reLoginBot) global.reLoginBot(); }, 500);
          return res.json({ success: true, count: deduped.length, uid: cUser?.value || "", format: "token" });
        } catch (e) {
          return res.status(400).json({ error: "خطأ في التوكن: " + e.message });
        }
      }

      const cookies = parsed.cookies || [];
      if (!cookies.length) return res.status(400).json({ error: "لا توجد كوكيز صالحة" });
      if (!hasMandatory(cookies)) return res.status(400).json({ error: "c_user أو xs مفقود — الكوكيز ناقصة" });

      // Validate live
      const valid = await checkLiveCookie(cookiesToString(cookies), userAgent);

      // Save as JSON array (most reliable format)
      fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(cookies, null, 2), "utf8");

      const cUser = cookies.find(c => c.key === "c_user");
      if (io) io.emit("cookies-updated", { count: cookies.length, uid: cUser?.value || "", valid, format: "cookies" });

      // Hot-swap: re-login without restart
      setTimeout(() => { if (global.reLoginBot) global.reLoginBot(); }, 500);

      res.json({
        success: true,
        count:   cookies.length,
        uid:     cUser?.value || "",
        valid,
        format: "cookies",
        message: valid ? "✅ الكوكيز صالحة — جارٍ تغيير الحساب..." : "⚠️ قد تكون منتهية الصلاحية — سيتم المحاولة",
      });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Validate only (no save)
  app.post("/api/cookies/validate", async (req, res) => {
    try {
      let raw = req.body.cookies;
      if (typeof raw === "string") raw = raw.trim();
      const parsed = parseCookieInput(raw);
      if (parsed.isToken) return res.json({ valid: null, format: "token", message: "توكن — سيتم التحقق عند الحفظ" });
      const cookies = parsed.cookies || [];
      if (!hasMandatory(cookies)) return res.json({ valid: false, message: "c_user أو xs مفقود" });
      const cookieStr = cookiesToString(cookies);
      const userAgent = global.config?.userAgent ||
        "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36";
      const valid = await checkLiveCookie(cookieStr, userAgent);
      const cUser = cookies.find(c => c.key === "c_user");
      res.json({
        valid, count: cookies.length, uid: cUser?.value || "",
        message: valid ? "✅ الكوكيز صالحة وتعمل" : "⚠️ الكوكيز قد تكون منتهية الصلاحية",
      });
    } catch (e) { res.status(400).json({ valid: false, message: e.message }); }
  });

  // DELETE cookies
  app.delete("/api/cookies", (_req, res) => {
    try {
      fs.writeFileSync(ACCOUNT_PATH, "", "utf8");
      if (io) io.emit("cookies-updated", { count: 0, uid: "" });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Media Upload & Management ──────────────────────────────────────────────
  app.post("/api/media/upload", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع أي ملف" });
    res.json({
      success: true,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  });

  app.get("/api/media", (_req, res) => {
    try {
      const files = fs.readdirSync(UPLOADS_DIR).map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        const ext  = path.extname(f).toLowerCase();
        let type = "file";
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(f)) type = "image";
        else if (/\.(mp4|mov|avi)$/i.test(f)) type = "video";
        else if (/\.(mp3|ogg|wav|m4a)$/i.test(f)) type = "audio";
        return { filename: f, url: `/uploads/${f}`, size: stat.size, type, ext };
      }).filter(f => !f.filename.startsWith("."));
      res.json(files);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/media/:filename", (req, res) => {
    const safe = path.basename(req.params.filename);
    const fp   = path.join(UPLOADS_DIR, safe);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Protection ─────────────────────────────────────────────────────────────
  app.get("/api/protection", (_req, res) => {
    const throttle = (() => { try { return require("../protection/outgoingThrottle").getStatus(); } catch { return null; } })();
    const stealth  = (() => { try { return require("../protection/stealth").getStatus(); } catch { return null; } })();
    const cfg      = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
    res.json({
      stealth:     { enabled: cfg.stealth?.enable !== false, ...stealth },
      throttle:    { enabled: cfg.stealth?.outgoingThrottle?.enable !== false, ...throttle },
      humanTyping: { enabled: cfg.humanTyping?.enable !== false },
      mqttHealth:  { enabled: cfg.mqttHealthCheck?.enable !== false },
      keepAlive:   { enabled: cfg.keepAlive?.enable !== false },
    });
  });
  app.post("/api/protection/toggle", (req, res) => {
    const { system, enable } = req.body || {};
    try {
      const cfg = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      if (system === "stealth")     { if (!cfg.stealth) cfg.stealth = {};          cfg.stealth.enable = !!enable; }
      if (system === "humanTyping") { if (!cfg.humanTyping) cfg.humanTyping = {};  cfg.humanTyping.enable = !!enable; }
      if (system === "mqttHealth")  { if (!cfg.mqttHealthCheck) cfg.mqttHealthCheck = {}; cfg.mqttHealthCheck.enable = !!enable; }
      if (system === "keepAlive")   { if (!cfg.keepAlive) cfg.keepAlive = {};      cfg.keepAlive.enable = !!enable; }
      fs.writeJsonSync(CONFIG_PATH, cfg, { spaces: 2 });
      if (global.config) global.config = cfg;
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Backup ─────────────────────────────────────────────────────────────────
  app.get("/api/backup", (_req, res) => {
    try { res.json(require("../utils/autoBackup").getStatus()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/backup/now", async (_req, res) => {
    try {
      await require("../utils/autoBackup").doBackup();
      res.json({ success: true, ...require("../utils/autoBackup").getStatus() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/backup/restore/:ts", async (req, res) => {
    try {
      const n = await require("../utils/autoBackup").restoreBackup(req.params.ts);
      res.json({ success: true, restored: n });
      setTimeout(() => { if (global.reLoginBot) global.reLoginBot(); }, 1000);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/backup/download/:ts", (req, res) => {
    const { backupDir } = require("../utils/autoBackup").getStatus();
    const dir = require("path").join(backupDir, req.params.ts);
    if (!require("fs-extra").existsSync(dir)) return res.status(404).json({ error: "غير موجود" });
    const archive = require("archiver")("zip", { zlib: { level: 6 } });
    res.attachment(`backup_${req.params.ts}.zip`);
    archive.pipe(res);
    archive.directory(dir, false);
    archive.finalize();
  });

  // ── Restart (hot-swap re-login only) ──────────────────────────────────────
  app.post("/api/restart", (_req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 400);
  });

  // Hot-swap (re-login without full restart)
  app.post("/api/relogin", async (_req, res) => {
    res.json({ success: true, message: "جارٍ إعادة تسجيل الدخول…" });
    setTimeout(() => { if (global.reLoginBot) global.reLoginBot(); }, 300);
  });

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
