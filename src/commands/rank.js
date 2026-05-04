const { User } = require("../utils/database");

module.exports = {
  config: {
    name: "rank",
    aliases: ["leaderboard", "top"],
    description: "Show top users by EXP",
    usage: "rank",
    adminOnly: false,
  },
  async run({ api, event, threadID }) {
    const top = await User.findAll({
      order: [["exp", "DESC"]],
      limit: 10,
    });

    if (!top.length) return api.sendMessage("No users ranked yet!", threadID);

    const medals = ["🥇", "🥈", "🥉"];
    const list = top.map((u, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const level = Math.floor((u.exp || 0) / 100) + 1;
      return `${medal} ${u.name} — Lv.${level} (${u.exp} EXP)`;
    });

    api.sendMessage(`🏆 Top Users\n━━━━━━━━━━\n${list.join("\n")}`, threadID);
  },
};
