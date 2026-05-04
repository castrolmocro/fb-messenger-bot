"use strict";
/**
 * autoBackup.js — نسخ احتياطي تلقائي كل ساعة
 * يحفظ: account.txt + data/bot.db + config.json
 */

const fs   = require("fs-extra");
const path = require("path");

const ROOT      = path.join(__dirname, "../..");
const BACKUP_DIR = path.join(ROOT, "backups");
const MAX_BACKUPS = 24; // احتفظ بـ 24 نسخة (يوم كامل بنسخة كل ساعة)

let _timer = null;
let _lastBackup = null;

function getTS() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}_${String(d.getHours()).padStart(2,"0")}-${String(d.getMinutes()).padStart(2,"0")}`;
}

async function doBackup() {
  try {
    fs.ensureDirSync(BACKUP_DIR);

    const ts  = getTS();
    const dir = path.join(BACKUP_DIR, ts);
    fs.ensureDirSync(dir);

    const filesToBackup = [
      { src: path.join(ROOT, "account.txt"),         dst: "account.txt"  },
      { src: path.join(ROOT, "config.json"),          dst: "config.json"  },
      { src: path.join(ROOT, "data/bot.db"),          dst: "bot.db"       },
    ];

    let backed = 0;
    for (const { src, dst } of filesToBackup) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, dst));
        backed++;
      }
    }

    _lastBackup = { ts, count: backed, at: Date.now() };

    // Prune old backups
    const all = fs.readdirSync(BACKUP_DIR)
      .filter(n => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory())
      .sort();
    while (all.length > MAX_BACKUPS) {
      const old = all.shift();
      fs.removeSync(path.join(BACKUP_DIR, old));
    }

    const chalk = require("chalk");
    const moment = require("moment-timezone");
    const tz = global.config?.timezone || "Africa/Algiers";
    const t = moment().tz(tz).format("HH:mm:ss");
    console.log(`${chalk.gray(t)} ${chalk.green("💾")} ${chalk.green(`نسخة احتياطية محفوظة → backups/${ts} (${backed} ملفات)`)}`);
  } catch (e) {
    console.error("[BACKUP] خطأ:", e.message);
  }

  scheduleNext();
}

function scheduleNext() {
  if (_timer) clearTimeout(_timer);
  const intervalMs = (global.config?.backupIntervalMinutes || 60) * 60 * 1000;
  _timer = setTimeout(doBackup, intervalMs);
}

function start() {
  if (_timer) return;
  scheduleNext();
  const chalk = require("chalk");
  const interval = global.config?.backupIntervalMinutes || 60;
  console.log(`[BACKUP] ✅ نسخ احتياطي تلقائي كل ${interval} دقيقة`);
}

function stop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function getStatus() {
  const all = [];
  try {
    if (fs.existsSync(BACKUP_DIR)) {
      fs.readdirSync(BACKUP_DIR)
        .filter(n => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory())
        .sort().reverse()
        .forEach(n => all.push(n));
    }
  } catch {}
  return { lastBackup: _lastBackup, backups: all, backupDir: BACKUP_DIR };
}

async function restoreBackup(ts) {
  const dir = path.join(BACKUP_DIR, ts);
  if (!fs.existsSync(dir)) throw new Error("النسخة الاحتياطية غير موجودة");

  const filesToRestore = [
    { src: path.join(dir, "account.txt"), dst: path.join(ROOT, "account.txt") },
    { src: path.join(dir, "config.json"), dst: path.join(ROOT, "config.json") },
  ];

  let restored = 0;
  for (const { src, dst } of filesToRestore) {
    if (fs.existsSync(src)) { fs.copyFileSync(src, dst); restored++; }
  }
  return restored;
}

module.exports = { start, stop, doBackup, getStatus, restoreBackup };
