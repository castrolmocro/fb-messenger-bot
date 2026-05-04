module.exports = {
  config: {
    name: "flip",
    aliases: ["coin", "coinflip"],
    description: "Flip a coin",
    usage: "flip",
    adminOnly: false,
  },
  async run({ api, event, threadID }) {
    const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
    api.sendMessage(`🎲 Coin flip result: ${result}`, threadID);
  },
};
