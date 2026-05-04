"use strict";

/**
 * Human Typing Simulation
 * Sends realistic typing indicators before bot replies
 * based on message length — like a real human would.
 */

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Calculate realistic typing delay based on message length
 * Average human types ~40 WPM = ~200 chars/min = ~3.3 chars/sec
 * We use a faster rate (bot "thinks" faster) with jitter
 */
function calcTypingMs(text) {
  if (!text || typeof text !== "string") return randInt(800, 2000);
  const len = text.length;
  // Base: 40ms per char, with floor at 800ms and cap at 8000ms
  const base = Math.min(Math.max(len * 40, 800), 8000);
  // Add ±20% jitter
  return Math.round(base * (0.80 + Math.random() * 0.40));
}

/**
 * Send typing indicator and wait realistic time before sending
 * @param {object} api - fca-unofficial api object
 * @param {string} threadID - thread to type in
 * @param {string|object} replyMessage - the message about to be sent (for length calc)
 * @param {boolean} force - skip config check
 */
async function simulateTyping(api, threadID, replyMessage, force = false) {
  try {
    const cfg = global.config?.humanTyping || {};
    if (cfg.enable === false && !force) return;

    // Extract text length from message
    let text = "";
    if (typeof replyMessage === "string") text = replyMessage;
    else if (replyMessage?.body) text = replyMessage.body;
    else if (replyMessage?.message) text = replyMessage.message;

    const typingMs = calcTypingMs(text);

    // Send typing indicator
    try { await api.sendTypingIndicator(threadID); } catch (_) {}

    // Wait realistic time
    await sleep(typingMs);

    // Add small "finishing up" pause (human pauses before hitting send)
    await sleep(randInt(200, 600));

  } catch (_) {}
}

/**
 * Wrap api.sendMessage to auto-simulate typing before every send
 * Call once after login: wrapWithTyping(api)
 */
function wrapWithTyping(api) {
  if (api.__typingWrapped) return;
  api.__typingWrapped = true;

  const _orig = api.sendMessage.bind(api);

  api.sendMessage = async function(msg, threadID, callback, messageID) {
    try {
      const cfg = global.config?.humanTyping || {};
      if (cfg.enable !== false) {
        await simulateTyping(api, threadID, msg, true);
      }
    } catch (_) {}
    return _orig(msg, threadID, callback, messageID);
  };

  console.log("[HUMAN_TYPING] ✅ Typing simulation active");
}

module.exports = { simulateTyping, wrapWithTyping, calcTypingMs };
