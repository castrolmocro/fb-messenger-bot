const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");

function loadCommands(dir) {
  const commands = new Map();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return commands;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const cmd = require(path.join(dir, file));
      if (!cmd.config || !cmd.config.name) {
        console.warn(chalk.yellow(`⚠️  Skipping ${file}: missing config.name`));
        continue;
      }
      const names = [cmd.config.name, ...(cmd.config.aliases || [])];
      for (const name of names) {
        commands.set(name.toLowerCase(), cmd);
      }
      console.log(chalk.green(`  ↳ Loaded: ${cmd.config.name}`));
    } catch (e) {
      console.error(chalk.red(`❌ Failed to load ${file}:`), e.message);
    }
  }

  return commands;
}

module.exports = { loadCommands };
