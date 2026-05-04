module.exports = {
  config: {
    name: "add",
    aliases: [],
    description: "Add a user to the group (by UID)",
    usage: "add <userID>",
    adminOnly: true,
  },
  async run({ api, event, args, threadID }) {
    if (!args[0]) return api.sendMessage("❌ Usage: /add <userID>", threadID);
    try {
      await api.addUserToGroup(args[0], threadID);
      api.sendMessage(`✅ Added user ${args[0]} to the group.`, threadID);
    } catch (e) {
      api.sendMessage(`❌ Could not add user: ${e.message}`, threadID);
    }
  },
};
