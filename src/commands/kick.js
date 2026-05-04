module.exports = {
  config: {
    name: "kick",
    aliases: [],
    description: "Kick a user from the group",
    usage: "kick @user",
    adminOnly: true,
  },
  async run({ api, event, args, threadID }) {
    const mentions = event.mentions || {};
    const ids = Object.keys(mentions);
    if (!ids.length) return api.sendMessage("❌ Mention a user to kick.", threadID);

    for (const id of ids) {
      try {
        await api.removeUserFromGroup(id, threadID);
        api.sendMessage(`✅ Kicked ${mentions[id]} from the group.`, threadID);
      } catch (e) {
        api.sendMessage(`❌ Could not kick ${mentions[id]}: ${e.message}`, threadID);
      }
    }
  },
};
