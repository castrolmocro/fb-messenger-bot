const { getOrCreateUser, User } = require("../utils/database");
const moment = require("moment-timezone");

module.exports = {
  config: {
    name: "daily",
    aliases: ["claim"],
    description: "Claim your daily coins reward",
    usage: "daily",
    adminOnly: false,
  },
  async run({ api, event, threadID, senderID }) {
    let name = "User";
    try {
      const info = await api.getUserInfo(senderID);
      if (info && info[senderID]) name = info[senderID].name;
    } catch {}

    const user = await getOrCreateUser(senderID, name);
    const now = moment();
    const lastClaim = user.updatedAt ? moment(user.updatedAt) : null;

    if (lastClaim && now.diff(lastClaim, "hours") < 24) {
      const remaining = 24 - now.diff(lastClaim, "hours");
      return api.sendMessage(
        `⏳ You already claimed today!\nCome back in ${remaining} hour(s).`,
        threadID
      );
    }

    const reward = Math.floor(Math.random() * 200) + 100;
    const expGain = Math.floor(Math.random() * 30) + 10;

    await user.update({
      money: (user.money || 0) + reward,
      exp: (user.exp || 0) + expGain,
    });

    api.sendMessage(
      `🎁 Daily Reward Claimed!\n` +
        `💰 +${reward} coins\n` +
        `⭐ +${expGain} EXP\n` +
        `💼 Total coins: ${(user.money || 0) + reward}`,
      threadID
    );
  },
};
