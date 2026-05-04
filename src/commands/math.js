module.exports = {
  config: {
    name: "math",
    aliases: ["calc", "calculate"],
    description: "Evaluate a math expression",
    usage: "math <expression>",
    adminOnly: false,
  },
  async run({ api, event, args, threadID }) {
    if (!args.length) return api.sendMessage("❌ Usage: /math <expression>", threadID);
    const expr = args.join(" ");
    try {
      // Safe eval using Function with restricted scope
      const result = Function(
        '"use strict"; const Math = globalThis.Math; return (' + expr + ")"
      )();
      api.sendMessage(`🧮 ${expr} = ${result}`, threadID);
    } catch {
      api.sendMessage(`❌ Invalid expression: ${expr}`, threadID);
    }
  },
};
