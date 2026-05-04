module.exports = {
  config: {
    name: "ping",
    aliases: ["p"],
    description: "Check bot response time",
    usage: "ping",
    adminOnly: false,
  },
  async run({ api, event, threadID }) {
    const start = Date.now();
    api.sendMessage("🏓 Pong! Calculating...", threadID, (err, info) => {
      const ms = Date.now() - start;
      api.editMessage(`🏓 Pong! Response time: ${ms}ms`, info.messageID);
    });
  },
};
