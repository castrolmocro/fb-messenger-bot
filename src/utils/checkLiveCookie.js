const axios = require("axios");

/**
 * Checks if a cookie string is valid by hitting mbasic.facebook.com/settings
 * @param {string} cookieStr Cookie string like "c_user=xxx; xs=xxx; datr=xxx"
 * @param {string} userAgent User agent string
 * @returns {Promise<boolean>}
 */
module.exports = async function checkLiveCookie(cookieStr, userAgent) {
  try {
    const response = await axios({
      url: "https://mbasic.facebook.com/settings",
      method: "GET",
      timeout: 15000,
      headers: {
        cookie: cookieStr,
        "user-agent": userAgent ||
          "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "ar,en-US;q=0.9,en;q=0.8",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "upgrade-insecure-requests": "1",
      },
    });
    return (
      response.data.includes("/privacy/xcs/action/logging/") ||
      response.data.includes("/notifications.php?") ||
      response.data.includes('href="/login/save-password-interstitial')
    );
  } catch (_) {
    return false;
  }
};
