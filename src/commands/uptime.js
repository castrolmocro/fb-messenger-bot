module.exports = {
  config: {
    name: "uptime",
    aliases: ["up"],
    description: "Show how long the bot has been running",
    usage: "uptime",
    adminOnly: false,
  },
  async run({ api, event, threadID }) {
    const totalSeconds = Math.floor(process.uptime());
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    api.sendMessage(`⏱️ Bot has been online for: ${parts.join(" ")}`, threadID);
  },
};
