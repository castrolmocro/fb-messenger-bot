const axios = require("axios");

/**
 * Convert a Facebook full-permission token (EAAAA...) to a cookie appstate array
 * @param {string} token Facebook token starting with EAAAA
 * @returns {Promise<Array>} appstate cookie array
 */
module.exports = async function getFbstateFromToken(token) {
  const res1 = await axios({
    url: "https://graph.facebook.com/app",
    method: "GET",
    params: { access_token: token },
    timeout: 15000,
  });
  if (res1.data.error) throw new Error("التوكن غير صالح");

  const res2 = await axios({
    url: "https://api.facebook.com/method/auth.getSessionforApp",
    method: "GET",
    params: {
      access_token: token,
      format: "json",
      new_app_id: res1.data.id,
      generate_session_cookies: "1",
    },
    timeout: 15000,
  });

  if (res2.data.error_code) throw new Error("فشل تحويل التوكن: " + res2.data.error_msg);

  const cookies = res2.data.session_cookies;
  if (!cookies || !cookies.length) throw new Error("لم يتم إرجاع كوكيز من التوكن");

  const FAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  return cookies.map((c) => ({
    key: c.name || c.key,
    value: String(c.value || ""),
    domain: (c.domain || "facebook.com").replace(/^\./, ""),
    path: c.path || "/",
    hostOnly: c.hostOnly ?? false,
    creation: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    expires: c.expires || FAR,
  }));
};
