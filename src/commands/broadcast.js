const { Thread } = require("../utils/database");

module.exports = {
  config: {
    name: "broadcast",
    aliases: ["bc", "announce"],
    description: "إرسال رسالة جماعية لجميع المحادثات",
    usage: "broadcast <رسالة>",
    ownerOnly: true,
    adminOnly: true,
  },
  async run({ api, event, args, threadID, senderID }) {
    if (!global.isOwner(senderID)) {
      return api.sendMessage("⛔ هذا الأمر للمالك فقط.", threadID);
    }
    if (!args.length) return api.sendMessage("❌ Usage: /broadcast <message>", threadID);

    const msg = args.join(" ");
    const threads = await Thread.findAll({ where: { banned: false } });

    let sent = 0;
    for (const t of threads) {
      try {
        await new Promise((res, rej) =>
          api.sendMessage(`📢 Announcement:\n${msg}`, t.threadID, (e) => (e ? rej(e) : res()))
        );
        sent++;
      } catch {}
    }

    api.sendMessage(`✅ Broadcasted to ${sent}/${threads.length} threads.`, threadID);
  },
};
