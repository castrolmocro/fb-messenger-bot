const { getOrCreateUser } = require("../utils/database");

module.exports = {
  config: {
    name: "unban",
    aliases: ["unblock"],
    description: "رفع الحظر عن مستخدم",
    usage: "unban @mention",
    adminOnly: true,
  },
  async run({ api, event, args, threadID }) {
    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);
    if (!ids.length) return api.sendMessage("❌ تاغ المستخدم.", threadID);

    for (const id of ids) {
      const user = await getOrCreateUser(id, mentions[id]);
      await user.update({ banned: false });
      api.sendMessage(`✅ تم رفع الحظر عن: ${mentions[id]}`, threadID);
    }
  },
};
