const { getOrCreateUser } = require("../utils/database");

module.exports = {
  config: {
    name: "balance",
    aliases: ["bal", "coins", "money"],
    description: "Check your coin balance",
    usage: "balance",
    adminOnly: false,
  },
  async run({ api, event, threadID, senderID }) {
    let name = "User";
    try {
      const info = await api.getUserInfo(senderID);
      if (info && info[senderID]) name = info[senderID].name;
    } catch {}

    const user = await getOrCreateUser(senderID, name);
    api.sendMessage(
      `💰 Balance for ${name}\n` +
        `Coins: ${user.money || 0}\n` +
        `EXP: ${user.exp || 0}\n` +
        `Level: ${Math.floor((user.exp || 0) / 100) + 1}`,
      threadID
    );
  },
};
