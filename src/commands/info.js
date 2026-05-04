const moment = require("moment-timezone");

module.exports = {
  config: {
    name: "info",
    aliases: ["botinfo", "about"],
    description: "Show bot information",
    usage: "info",
    adminOnly: false,
  },
  async run({ api, event, threadID }) {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    const uptimeStr = `${h}h ${m}m ${s}s`;

    const mem = process.memoryUsage();
    const memMB = (mem.rss / 1024 / 1024).toFixed(1);
    const now = moment().tz("Asia/Cairo").format("YYYY-MM-DD HH:mm:ss");

    const adminCount = (global.config?.adminIDs || []).length;
    api.sendMessage(
      `🤖 معلومات البوت\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🏷️  الاسم: ${global.botName}\n` +
        `⏱️  وقت التشغيل: ${uptimeStr}\n` +
        `💾  الذاكرة: ${memMB} MB\n` +
        `📦  الأوامر: ${global.commands.size}\n` +
        `👑  الأدمنز: ${adminCount + 1}\n` +
        `🕐  الوقت: ${now}\n` +
        `📌  البريفكس: ${global.commandPrefix}\n` +
        `🔧  Node.js: ${process.version}`,
      threadID
    );
  },
};
