const fs = require("fs-extra");
const path = require("path");
const CONFIG_PATH = path.join(__dirname, "../../config.json");

module.exports = {
  config: {
    name: "admin",
    aliases: ["addadmin", "removeadmin", "admins"],
    description: "Manage bot admins",
    usage: "admin add/remove @mention | admin list",
    adminOnly: false,
    ownerOnly: true,
  },
  async run({ api, event, args, threadID }) {
    const sub = (args[0] || "list").toLowerCase();
    const config = fs.readJsonSync(CONFIG_PATH);
    if (!Array.isArray(config.adminIDs)) config.adminIDs = [];

    if (sub === "list") {
      const ids = [config.ownerID, ...config.adminIDs.filter((x) => x !== config.ownerID)];
      return api.sendMessage(
        `👑 أدمنز البوت:\n\n` +
          ids.map((id, i) => `${i === 0 ? "👑" : "🔰"} ${id}${i === 0 ? " (المالك)" : ""}`).join("\n"),
        threadID
      );
    }

    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);
    if (!ids.length) return api.sendMessage("❌ تاغ أحداً.", threadID);

    if (sub === "add") {
      const added = [];
      for (const id of ids) {
        if (!config.adminIDs.includes(id)) {
          config.adminIDs.push(id);
          added.push(mentions[id]);
        }
      }
      fs.writeJsonSync(CONFIG_PATH, config, { spaces: 2 });
      global.config.adminIDs = config.adminIDs;
      return api.sendMessage(`✅ تمت الإضافة كأدمن:\n${added.join("\n") || "لا أحد جديد"}`, threadID);
    }

    if (sub === "remove") {
      const removed = [];
      for (const id of ids) {
        if (String(id) === String(config.ownerID)) {
          api.sendMessage("⛔ لا يمكن إزالة المالك.", threadID);
          continue;
        }
        if (config.adminIDs.includes(id)) {
          config.adminIDs = config.adminIDs.filter((x) => x !== id);
          removed.push(mentions[id]);
        }
      }
      fs.writeJsonSync(CONFIG_PATH, config, { spaces: 2 });
      global.config.adminIDs = config.adminIDs;
      return api.sendMessage(`✅ تمت الإزالة من الأدمنز:\n${removed.join("\n") || "لا أحد"}`, threadID);
    }

    api.sendMessage(`الاستخدام: /admin add | remove | list`, threadID);
  },
};
