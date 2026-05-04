const axios = require("axios");

module.exports = {
  config: {
    name: "weather",
    aliases: ["w"],
    description: "Get current weather for a city",
    usage: "weather <city>",
    adminOnly: false,
  },
  async run({ api, event, args, threadID }) {
    if (!args.length) return api.sendMessage("❌ Usage: /weather <city>", threadID);

    const city = args.join(" ");
    try {
      const res = await axios.get(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`
      );
      const data = res.data;
      const current = data.current_condition[0];
      const area = data.nearest_area[0];
      const areaName = area.areaName[0].value;
      const country = area.country[0].value;

      const desc = current.weatherDesc[0].value;
      const temp = current.temp_C;
      const feels = current.FeelsLikeC;
      const humidity = current.humidity;
      const wind = current.windspeedKmph;
      const uv = current.uvIndex;

      api.sendMessage(
        `🌤️ Weather in ${areaName}, ${country}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🌡️ Temp: ${temp}°C (Feels like ${feels}°C)\n` +
          `☁️ Condition: ${desc}\n` +
          `💧 Humidity: ${humidity}%\n` +
          `🌬️ Wind: ${wind} km/h\n` +
          `☀️ UV Index: ${uv}`,
        threadID
      );
    } catch (e) {
      api.sendMessage(`❌ Could not get weather for "${city}"`, threadID);
    }
  },
};
