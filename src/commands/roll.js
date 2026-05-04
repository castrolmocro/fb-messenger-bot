module.exports = {
  config: {
    name: "roll",
    aliases: ["dice", "random"],
    description: "Roll a dice (default 1-6, or specify max)",
    usage: "roll [max]",
    adminOnly: false,
  },
  async run({ api, event, args, threadID }) {
    const max = parseInt(args[0]) || 6;
    const result = Math.floor(Math.random() * max) + 1;
    api.sendMessage(`🎲 You rolled: ${result} (1-${max})`, threadID);
  },
};
