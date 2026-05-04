module.exports = {
  config: {
    name: "react",
    aliases: ["like"],
    description: "React to the replied message",
    usage: "react <emoji>",
    adminOnly: false,
  },
  async run({ api, event, args, threadID, messageID }) {
    const emoji = args[0] || "👍";
    const targetID = event.messageReply?.messageID || messageID;
    try {
      await api.setMessageReaction(emoji, targetID, () => {}, true);
    } catch (e) {
      api.sendMessage(`❌ Could not react: ${e.message}`, threadID);
    }
  },
};
