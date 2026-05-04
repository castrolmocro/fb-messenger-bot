const { getOrCreateUser } = require("../utils/database");

module.exports = {
  config: {
    name: "ban",
    aliases: ["block"],
    description: "حظر مستخدم من البوت",
    usage: "ban @mention [سبب]",
    adminOnly: true,
  },
  async run({ api, event, args, threadID }) {
    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);
    if (!ids.length) return api.sendMessage("❌ تاغ المستخدم الذي تريد حظره.", threadID);

    const reason = args.slice(ids.length).join(" ") || "لا يوجد سبب";

    for (const id of ids) {
      if (global.isOwner(id)) {
        api.sendMessage(`⛔ لا يمكن حظر المالك.`, threadID);
        continue;
      }
      const user = await getOrCreateUser(id, mentions[id]);
      await user.update({ banned: true });
      api.sendMessage(
        `🚫 تم حظر المستخدم: ${mentions[id]}\n📋 السبب: ${reason}`,
        threadID
      );
    }
  },
};
