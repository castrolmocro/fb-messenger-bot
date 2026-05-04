module.exports = {
  config: {
    name: "unsend",
    aliases: ["delete"],
    description: "Unsend (delete) a replied message sent by the bot",
    usage: "unsend (reply to bot message)",
    adminOnly: true,
  },
  async run({ api, event, threadID }) {
    const reply = event.messageReply;
    if (!reply) return api.sendMessage("❌ Reply to a bot message to unsend it.", threadID);

    const botID = api.getCurrentUserID();
    if (reply.senderID !== botID) {
      return api.sendMessage("❌ I can only unsend my own messages.", threadID);
    }

    try {
      await api.unsendMessage(reply.messageID);
    } catch (e) {
      api.sendMessage(`❌ Could not unsend: ${e.message}`, threadID);
    }
  },
};
