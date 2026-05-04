module.exports = {
  config: {
    name: "say",
    aliases: ["echo"],
    description: "Make the bot say something",
    usage: "say <message>",
    adminOnly: true,
  },
  async run({ api, event, args, threadID, messageID }) {
    if (!args.length) return api.sendMessage("❌ Usage: /say <message>", threadID);
    api.unsendMessage(messageID);
    api.sendMessage(args.join(" "), threadID);
  },
};
