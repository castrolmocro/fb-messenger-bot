const moment = require("moment-timezone");

const TIMEZONES = {
  algeria: "Africa/Algiers",
  algiers: "Africa/Algiers",
  dz: "Africa/Algiers",
  egypt: "Africa/Cairo",
  cairo: "Africa/Cairo",
  london: "Europe/London",
  paris: "Europe/Paris",
  dubai: "Asia/Dubai",
  riyadh: "Asia/Riyadh",
  newyork: "America/New_York",
  "new york": "America/New_York",
  tokyo: "Asia/Tokyo",
  beijing: "Asia/Shanghai",
  moscow: "Europe/Moscow",
  sydney: "Australia/Sydney",
};

module.exports = {
  config: {
    name: "time",
    aliases: ["clock"],
    description: "Get current time for a city/timezone",
    usage: "time [city]",
    adminOnly: false,
  },
  async run({ api, event, args, threadID }) {
    const defaultTZ = (global.config && global.config.timezone) || "Africa/Algiers";
    const query = args.join(" ").toLowerCase() || defaultTZ;
    const tz = TIMEZONES[query] || query;

    try {
      const now = moment().tz(tz);
      api.sendMessage(
        `🕐 Time in ${tz.replace("_", " ")}\n` +
          `📅 ${now.format("dddd, MMMM Do YYYY")}\n` +
          `⏰ ${now.format("HH:mm:ss")}`,
        threadID
      );
    } catch {
      api.sendMessage(
        `❌ Unknown timezone "${tz}".\nTry: egypt, london, dubai, tokyo, newyork`,
        threadID
      );
    }
  },
};
