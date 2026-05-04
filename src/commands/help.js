module.exports = {
  config: {
    name: "help",
    aliases: ["commands", "cmds"],
    description: "Show all available commands",
    usage: "help [command]",
    adminOnly: false,
  },
  async run({ api, event, args, threadID }) {
    const commands = global.commands;
    const prefix = global.commandPrefix;

    if (args[0]) {
      const cmd = commands.get(args[0].toLowerCase());
      if (!cmd)
        return api.sendMessage(`❌ Command "${args[0]}" not found.`, threadID);
      return api.sendMessage(
        `📌 Command: ${prefix}${cmd.config.name}\n` +
          `📝 Description: ${cmd.config.description || "No description"}\n` +
          `🔧 Usage: ${prefix}${cmd.config.usage || cmd.config.name}\n` +
          `🔒 Admin only: ${cmd.config.adminOnly ? "Yes" : "No"}`,
        threadID
      );
    }

    const seen = new Set();
    const list = [];
    for (const [, cmd] of commands) {
      if (!seen.has(cmd.config.name)) {
        seen.add(cmd.config.name);
        list.push(`• ${prefix}${cmd.config.name} — ${cmd.config.description || "No description"}`);
      }
    }

    api.sendMessage(
      `🤖 ${global.botName} Commands\n\n${list.join("\n")}\n\nType ${prefix}help <command> for details.`,
      threadID
    );
  },
};
