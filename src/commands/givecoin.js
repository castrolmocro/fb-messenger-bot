const { getOrCreateUser } = require("../utils/database");

module.exports = {
  config: {
    name: "givecoin",
    aliases: ["give", "transfer"],
    description: "Give coins to another user",
    usage: "givecoin @user <amount>",
    adminOnly: false,
  },
  async run({ api, event, args, threadID, senderID }) {
    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);
    if (!ids.length || !args[args.length - 1])
      return api.sendMessage("❌ Usage: /givecoin @user <amount>", threadID);

    const amount = parseInt(args[args.length - 1]);
    if (isNaN(amount) || amount <= 0)
      return api.sendMessage("❌ Invalid amount.", threadID);

    let senderName = "User";
    try {
      const info = await api.getUserInfo(senderID);
      if (info && info[senderID]) senderName = info[senderID].name;
    } catch {}

    const sender = await getOrCreateUser(senderID, senderName);
    if ((sender.money || 0) < amount)
      return api.sendMessage(`❌ You don't have enough coins. Balance: ${sender.money || 0}`, threadID);

    const targetID = ids[0];
    const target = await getOrCreateUser(targetID, mentions[targetID]);

    await sender.update({ money: (sender.money || 0) - amount });
    await target.update({ money: (target.money || 0) + amount });

    api.sendMessage(
      `✅ Transfer successful!\n` +
        `💸 ${senderName} → ${mentions[targetID]}: ${amount} coins\n` +
        `Your balance: ${(sender.money || 0) - amount}`,
      threadID
    );
  },
};
