"use strict";

const axios = require("axios");

function log(level, msg) {
  const chalk = require("chalk");
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  if (level === "info") console.log(`${chalk.gray(ts)} ${chalk.cyan("•")} ${chalk.cyan("[STEALTH]")} ${msg}`);
  if (level === "warn") console.log(`${chalk.gray(ts)} ${chalk.yellow("⚠")} ${chalk.yellow("[STEALTH] " + msg)}`);
}

function randMs(minMin, maxMin) {
  return Math.floor(Math.random() * ((maxMin - minMin) * 60_000 + 1)) + minMin * 60_000;
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function localHour() {
  const tz = global.config?.timezone || "Africa/Algiers";
  try {
    return parseInt(new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }), 10);
  } catch (_) { return new Date().getHours(); }
}

function isSleepHour() {
  const cfg = global.config?.stealth || {};
  const start = cfg.sleepHourStart ?? 1;
  const end   = cfg.sleepHourEnd   ?? 8;
  const h = localHour();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

function cookieStr(api) {
  try {
    const st = api.getAppState();
    if (!st?.length) return null;
    return st.map(c => `${c.key}=${c.value}`).join("; ");
  } catch (_) { return null; }
}

const UA_POOL = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; OnePlus 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/459.0.0.29.109;]",
];

let _uaIdx = randInt(0, UA_POOL.length - 1);
function getUA() { return UA_POOL[_uaIdx]; }
function rotateUA() {
  _uaIdx = (_uaIdx + randInt(1, UA_POOL.length - 1)) % UA_POOL.length;
  log("info", `🔄 UA rotated → ${UA_POOL[_uaIdx].slice(0, 60)}…`);
}

const PAGE_POOL = [
  { url: "https://m.facebook.com/",               label: "Home feed",     method: "GET"  },
  { url: "https://m.facebook.com/?sk=h_nor",       label: "News feed",     method: "HEAD" },
  { url: "https://m.facebook.com/notifications",   label: "Notifications", method: "GET"  },
  { url: "https://m.facebook.com/messages",        label: "Messages",      method: "HEAD" },
  { url: "https://m.facebook.com/profile.php",     label: "Own profile",   method: "GET"  },
  { url: "https://mbasic.facebook.com/",           label: "mbasic home",   method: "GET"  },
  { url: "https://mbasic.facebook.com/me",         label: "mbasic profile","method": "HEAD" },
  { url: "https://mbasic.facebook.com/notifications","label":"mbasic notifs","method":"HEAD" },
];

let running = false;
let _api    = null;
let _startTime = Date.now();
const _timers = [];

function addTimer(fn, ms) {
  const id = setTimeout(() => { const i = _timers.indexOf(id); if (i !== -1) _timers.splice(i, 1); fn(); }, ms);
  _timers.push(id);
  return id;
}
function clearAll() { _timers.forEach(id => clearTimeout(id)); _timers.length = 0; }

function isWarmup() {
  const w = (global.config?.stealth?.warmupMinutes ?? 15) * 60_000;
  return (Date.now() - _startTime) < w;
}

async function presenceLoop() {
  if (!running) return;
  const api = _api;
  try {
    if (isSleepHour()) {
      try { api.setOptions({ online: false }); } catch (_) {}
      log("info", "🌙 Sleep — presence: offline");
      return addTimer(presenceLoop, randMs(25, 55));
    }
    if (isWarmup()) {
      try { api.setOptions({ online: false }); } catch (_) {}
      return addTimer(presenceLoop, randMs(3, 8));
    }
    const roll = Math.random();
    if (roll < 0.50) {
      try { api.setOptions({ online: true }); } catch (_) {}
      log("info", "🟢 Presence → online");
      addTimer(presenceLoop, randMs(6, 18));
    } else if (roll < 0.80) {
      try { api.setOptions({ online: false }); } catch (_) {}
      log("info", "💤 Presence → idle");
      addTimer(presenceLoop, randMs(5, 15));
    } else {
      try { api.setOptions({ online: false }); } catch (_) {}
      log("info", "📴 Presence → offline break");
      addTimer(presenceLoop, randMs(10, 25));
    }
  } catch (_) { addTimer(presenceLoop, randMs(10, 20)); }
}

async function browseLoop() {
  if (!running) return;
  const api = _api;
  try {
    const cookies = cookieStr(api);
    if (!cookies || isSleepHour() || isWarmup()) return addTimer(browseLoop, randMs(20, 40));
    if (Math.random() < 0.10) rotateUA();
    const page = PAGE_POOL[randInt(0, PAGE_POOL.length - 1)];
    const ua   = getUA();
    const method = (Math.random() < 0.4 || page.method === "GET") ? "get" : "head";
    await axios[method](page.url, {
      headers: {
        cookie: cookies, "user-agent": ua,
        "accept": "text/html,*/*;q=0.8",
        "accept-language": "ar-DZ,ar;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
      },
      timeout: 12000, validateStatus: null, maxRedirects: 3,
    });
    log("info", `🌐 Browsed: ${page.label}`);
  } catch (_) {}
  addTimer(browseLoop, isSleepHour() ? randMs(50, 100) : randMs(15, 35));
}

async function uaRotationLoop() {
  if (!running) return;
  rotateUA();
  addTimer(uaRotationLoop, randMs(60, 180));
}

module.exports.start = function(api) {
  if (running) return;
  const cfg = global.config?.stealth || {};
  if (cfg.enable === false) { log("info", "Stealth disabled in config."); return; }
  running    = true;
  _api       = api;
  _startTime = Date.now();
  log("info", `🕵️ Stealth engine started (sleep: ${cfg.sleepHourStart ?? 1}:00–${cfg.sleepHourEnd ?? 8}:00)`);
  addTimer(presenceLoop,   randMs(0, 2));
  addTimer(browseLoop,     randMs(20, 35));
  addTimer(uaRotationLoop, randMs(70, 130));
};

module.exports.stop = function() { running = false; clearAll(); log("info", "🛑 Stealth stopped."); };
module.exports.isRunning   = () => running;
module.exports.getCurrentUA = getUA;
module.exports.jitter = (ms) => Math.round(ms * (0.85 + Math.random() * 0.30));
module.exports.getStatus = function() {
  const cfg = global.config?.stealth || {};
  return { running, isSleepHour: isSleepHour(), isWarmup: isWarmup(), localHour: localHour(),
    sleepStart: cfg.sleepHourStart ?? 1, sleepEnd: cfg.sleepHourEnd ?? 8,
    warmupMinutes: cfg.warmupMinutes ?? 15, currentUA: getUA().slice(0, 60) + "…" };
};
