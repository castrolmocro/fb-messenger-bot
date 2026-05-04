const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const bodyParser = require("body-parser");
const fs         = require("fs-extra");
const { getStats } = require("../utils/database");

const APPSTATE_PATH = path.join(__dirname, "../../appstate.json");
const CONFIG_PATH   = path.join(__dirname, "../../config.json");

let io;

// Normalize cookie arrays (c3c or Cookie-Editor)
function normalizeCookies(raw) {
  if (!Array.isArray(raw) || !raw.length) return raw;
  const f = raw[0];
  if (f.key) return raw.map((c) => ({ ...c, domain: (c.domain || "facebook.com").replace(/^\./, ""), expires: c.expires || new Date(Date.now() + 365*24*3600*1000).toISOString() }));
  if (f.name) return raw.map((c) => ({ key: c.name, value: c.value, domain: (c.domain || "facebook.com").replace(/^\./, ""), path: c.path || "/", hostOnly: c.hostOnly || false, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : new Date(Date.now() + 365*24*3600*1000).toISOString(), creation: new Date().toISOString(), lastAccessed: new Date().toISOString() }));
  return raw;
}

async function startDashboard(port) {
  const app    = express();
  const server = http.createServer(app);
  io = new Server(server);

  app.use(bodyParser.json({ limit: "5mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // ── Stats ──────────────────────────────────────────────────────────────────
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await getStats();
      const cfg   = fs.existsSync(CONFIG_PATH) ? fs.readJsonSync(CONFIG_PATH) : {};
      res.json({
        ...stats,
        uptime:     process.uptime(),
        commands:   global.commands ? global.commands.size : 0,
        botName:    global.botName  || "FCA Bot",
        prefix:     global.commandPrefix || "/",
        ownerID:    global.ownerID || "",
        adminCount: (cfg.adminIDs || []).length,
        online:     !!global.api,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Commands list ──────────────────────────────────────────────────────────
  app.get("/api/commands", (req, res) => {
    if (!global.commands) return res.json([]);
    const seen = new Set();
    const list = [];
    for (const [, cmd] of global.commands) {
      if (!seen.has(cmd.config.name)) {
        seen.add(cmd.config.name);
        list.push({ name: cmd.config.name, description: cmd.config.description, usage: cmd.config.usage, adminOnly: cmd.config.adminOnly, ownerOnly: cmd.config.ownerOnly, aliases: cmd.config.aliases || [] });
      }
    }
    res.json(list);
  });

  // ── Send message ───────────────────────────────────────────────────────────
  app.post("/api/send", async (req, res) => {
    const { threadID, message } = req.body;
    if (!global.api)           return res.status(503).json({ error: "Bot not connected" });
    if (!threadID || !message) return res.status(400).json({ error: "threadID and message required" });
    try {
      await new Promise((ok, fail) => global.api.sendMessage(message, threadID, (e) => e ? fail(e) : ok()));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Upload / paste cookies ─────────────────────────────────────────────────
  app.post("/api/cookies", (req, res) => {
    try {
      let raw = req.body.cookies;
      if (typeof raw === "string") raw = JSON.parse(raw);
      const norm = normalizeCookies(raw);
      if (!norm || !norm.length) return res.status(400).json({ error: "Invalid cookie array" });
      fs.writeJsonSync(APPSTATE_PATH, norm, { spaces: 2 });
      const hasMsess = norm.some((c) => c.key === "m_sess");
      res.json({ success: true, count: norm.length, hasMsess });
      if (io) io.emit("cookies-updated", { count: norm.length, hasMsess });
    } catch (e) { res.status(400).json({ error: "Parse error: " + e.message }); }
  });

  // ── Check current cookies ──────────────────────────────────────────────────
  app.get("/api/cookies", (req, res) => {
    if (!fs.existsSync(APPSTATE_PATH)) return res.json({ exists: false, count: 0, hasMsess: false });
    const raw      = fs.readJsonSync(APPSTATE_PATH);
    const hasMsess = Array.isArray(raw) && raw.some((c) => c.key === "m_sess");
    res.json({ exists: true, count: Array.isArray(raw) ? raw.length : 0, hasMsess });
  });

  // ── Socket ─────────────────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    socket.emit("bot-status", {
      status:  global.api ? "online" : "offline",
      message: global.api ? "Bot is online" : "Bot not connected",
    });
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return { app, server, io };
}

function getIO() { return io; }

module.exports = { startDashboard, getIO };
