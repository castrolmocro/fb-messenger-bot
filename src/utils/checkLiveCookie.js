const axios = require("axios");

/**
 * التحقق من صحة الكوكيز عبر mbasic.facebook.com — مثل WHITE-V3
 * @param {string} cookieStr  "c_user=xxx; xs=xxx; ..."
 * @param {string} userAgent
 * @returns {Promise<boolean>}
 */
module.exports = async function checkLiveCookie(cookieStr, userAgent) {
  try {
    const UA = userAgent || "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36";
    const resp = await axios.get("https://mbasic.facebook.com/settings", {
      timeout: 15000,
      headers: {
        cookie: cookieStr,
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-language": "ar,en-US;q=0.9,en;q=0.8",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "upgrade-insecure-requests": "1",
      },
    });
    const html = resp.data || "";
    return (
      html.includes("/privacy/xcs/action/logging/") ||
      html.includes("/notifications.php?") ||
      html.includes('href="/login/save-password-interstitial') ||
      html.includes("account/settings") ||
      html.includes("logout")
    );
  } catch {
    return false;
  }
};
