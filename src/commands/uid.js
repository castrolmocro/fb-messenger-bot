module.exports = {
  config: {
    name: "uid",
    aliases: ["id"],
    description: "Get your or a mentioned user's UID",
    usage: "uid [@user]",
    adminOnly: false,
  },
  async run({ api, event, args, threadID, senderID }) {
    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);

    if (!ids.length) {
      return api.sendMessage(`🆔 Your UID: ${senderID}\n📌 Thread ID: ${threadID}`, threadID);
    }

    const list = ids.map((id) => `• ${mentions[id]}: ${id}`).join("\n");
    api.sendMessage(`🆔 User IDs:\n${list}`, threadID);
  },
};
