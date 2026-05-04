"use strict";

function log(level, msg) {
  const chalk = require("chalk");
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  if (level === "warn") console.log(`${chalk.gray(ts)} ${chalk.yellow("⚠")} ${chalk.yellow("[THROTTLE] " + msg)}`);
  if (level === "info") console.log(`${chalk.gray(ts)} ${chalk.cyan("•")} [THROTTLE] ${msg}`);
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const threadSendTimes = new Map();
const globalSendTimes = [];
let burstCoolingUntil = 0;
let burstTriggerCount = 0;
let burstWindowStart  = Date.now();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [tid, times] of threadSendTimes.entries()) {
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) threadSendTimes.delete(tid);
    else threadSendTimes.set(tid, fresh);
  }
  const gi = globalSendTimes.findIndex(t => t > cutoff);
  if (gi > 0) globalSendTimes.splice(0, gi);
}, 15 * 60 * 1000);

function getConfig() {
  const cfg = global.config?.stealth?.outgoingThrottle || {};
  return {
    enable:        cfg.enable !== false,
    maxPerThread:  cfg.maxPerThread  || 12,
    threadWindowMs:(cfg.threadWindowMinutes || 5) * 60_000,
    maxGlobal:     cfg.maxGlobal     || 40,
    globalWindowMs:(cfg.globalWindowMinutes || 10) * 60_000,
    coolingMinMs:  (cfg.coolingMinSeconds || 15) * 1000,
    coolingMaxMs:  (cfg.coolingMaxSeconds || 80) * 1000,
  };
}

function getBurstConfig() {
  const cfg = global.config?.stealth?.burstCooling || {};
  return {
    enable:          cfg.enable !== false,
    triggerCount:    cfg.triggerCount || 3,
    triggerWindowMs: (cfg.triggerWindowMinutes || 25) * 60_000,
    coolingMinMs:    (cfg.coolingMinMinutes || 2) * 60_000,
    coolingMaxMs:    (cfg.coolingMaxMinutes || 6) * 60_000,
  };
}

function isAdminExempt(threadID) {
  const admins = (global.config?.adminIDs || []).map(String);
  const owner  = String(global.ownerID || "");
  return admins.includes(String(threadID)) || String(threadID) === owner;
}

async function applyThrottle(threadID) {
  const cfg = getConfig();
  if (!cfg.enable) return;
  if (isAdminExempt(threadID)) return;

  if (Date.now() < burstCoolingUntil) {
    const waitMs = burstCoolingUntil - Date.now();
    log("warn", `🧊 Burst cooling — waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  const now = Date.now();
  if (!threadSendTimes.has(threadID)) threadSendTimes.set(threadID, []);
  const threadTimes = threadSendTimes.get(threadID).filter(t => now - t < cfg.threadWindowMs);
  threadSendTimes.set(threadID, threadTimes);

  if (threadTimes.length >= cfg.maxPerThread) {
    const delay = randInt(cfg.coolingMinMs, cfg.coolingMaxMs);
    log("warn", `🐢 Thread ${threadID}: cooling ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  } else if (threadTimes.length >= Math.floor(cfg.maxPerThread * 0.7)) {
    await sleep(randInt(2000, 8000));
  }

  const globalRecent = globalSendTimes.filter(t => now - t < cfg.globalWindowMs);
  globalSendTimes.length = 0;
  globalSendTimes.push(...globalRecent);

  if (globalSendTimes.length >= cfg.maxGlobal) {
    const delay = randInt(cfg.coolingMinMs * 2, cfg.coolingMaxMs * 2);
    log("warn", `⛔ Global rate limit — cooling ${Math.round(delay / 1000)}s`);
    const burstCfg = getBurstConfig();
    if (burstCfg.enable) {
      if (now - burstWindowStart > burstCfg.triggerWindowMs) { burstTriggerCount = 0; burstWindowStart = now; }
      burstTriggerCount++;
      if (burstTriggerCount >= burstCfg.triggerCount) {
        const coolingMs = randInt(burstCfg.coolingMinMs, burstCfg.coolingMaxMs);
        burstCoolingUntil = now + coolingMs;
        log("warn", `🚨 BURST (${burstTriggerCount}x) — ${Math.round(coolingMs / 60000)} min cooling`);
        burstTriggerCount = 0; burstWindowStart = now;
      }
    }
    await sleep(delay);
  }

  const ts = Date.now();
  threadSendTimes.get(threadID).push(ts);
  globalSendTimes.push(ts);
}

function wrapSendMessage(api) {
  if (api.__throttleWrapped) return;
  api.__throttleWrapped = true;
  const _orig = api.sendMessage.bind(api);
  api.sendMessage = async function(msg, threadID, callback, messageID) {
    try { await applyThrottle(String(threadID)); } catch (_) {}
    return _orig(msg, threadID, callback, messageID);
  };
  log("info", "✅ Outgoing throttle active");
}

module.exports = {
  wrapSendMessage,
  applyThrottle,
  getStatus() {
    return {
      burstCoolingActive: Date.now() < burstCoolingUntil,
      burstCoolingUntil,
      burstTriggerCount,
      globalQueueSize: globalSendTimes.length,
      trackedThreads:  threadSendTimes.size,
    };
  }
};
