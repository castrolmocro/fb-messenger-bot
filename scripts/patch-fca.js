#!/usr/bin/env node
/**
 * patch-fca.js — Patches fca-unofficial to:
 * 1. Include messenger.com cookies (m_sess) in the MQTT WebSocket headers
 * 2. Use edge-chat.messenger.com when m_sess is available
 * 3. Add more irisSeqID regex patterns for newer Facebook HTML
 * Run automatically via: npm postinstall
 */

const fs   = require("fs");
const path = require("path");

const FCA_DIR = path.join(__dirname, "../node_modules/fca-unofficial");

// ─── 1. Patch listenMqtt.js ───────────────────────────────────────────────────
const LISTEN_PATH = path.join(FCA_DIR, "src/listenMqtt.js");

if (fs.existsSync(LISTEN_PATH)) {
  let src = fs.readFileSync(LISTEN_PATH, "utf8");

  const OLD_COOKIES = `var cookies = ctx.jar.getCookies("https://www.facebook.com").join("; ");`;
  const NEW_COOKIES = `var fbCookies = ctx.jar.getCookies("https://www.facebook.com").join("; ");
  var msCookies = ctx.jar.getCookies("https://www.messenger.com").join("; ");
  var cookies = msCookies ? fbCookies + "; " + msCookies : fbCookies;
  var hasMsess = !!(msCookies && msCookies.includes("m_sess="));`;

  if (src.includes(OLD_COOKIES)) {
    src = src.replace(OLD_COOKIES, NEW_COOKIES);
    console.log("  ✔ Patched: cookie merger (facebook + messenger)");
  } else if (!src.includes("hasMsess")) {
    console.warn("  ⚠ Cookie patch already applied or pattern changed");
  }

  const OLD_HOST_END = `  } else {\n    host = \`wss://edge-chat.facebook.com/chat?sid=\${sessionID}\`;\n  }`;
  const NEW_HOST_END = `  } else if (hasMsess) {
    host = \`wss://edge-chat.messenger.com/chat?sid=\${sessionID}\`;
  } else {
    host = \`wss://edge-chat.facebook.com/chat?sid=\${sessionID}\`;
  }`;

  if (src.includes(OLD_HOST_END)) {
    src = src.replace(OLD_HOST_END, NEW_HOST_END);
    console.log("  ✔ Patched: MQTT host → edge-chat.messenger.com when m_sess present");
  }

  // Also fix region fallback to use messenger.com
  const OLD_REGION = `host = \`wss://edge-chat.facebook.com/chat?region=\${ctx.region.toLocaleLowerCase()}&sid=\${sessionID}\`;`;
  const NEW_REGION = `host = \`wss://edge-chat.messenger.com/chat?region=\${ctx.region.toLocaleLowerCase()}&sid=\${sessionID}\`;`;
  if (src.includes(OLD_REGION)) {
    src = src.replace(OLD_REGION, NEW_REGION);
    console.log("  ✔ Patched: region host → messenger.com");
  }

  const OLD_ORIGIN_HEADER = `        'Origin': 'https://www.facebook.com',`;
  const NEW_ORIGIN_HEADER = `        'Origin': host.includes("messenger.com") ? "https://www.messenger.com" : "https://www.facebook.com",`;
  if (src.includes(OLD_ORIGIN_HEADER)) {
    src = src.replace(OLD_ORIGIN_HEADER, NEW_ORIGIN_HEADER);
    console.log("  ✔ Patched: WebSocket Origin header");
  }

  const OLD_REFERER = `        'Referer': 'https://www.facebook.com/',`;
  const NEW_REFERER = `        'Referer': host.includes("messenger.com") ? "https://www.messenger.com/" : "https://www.facebook.com/",`;
  if (src.includes(OLD_REFERER)) {
    src = src.replace(OLD_REFERER, NEW_REFERER);
    console.log("  ✔ Patched: WebSocket Referer header");
  }

  const OLD_ORIGIN_WS = `      origin: 'https://www.facebook.com',`;
  const NEW_ORIGIN_WS = `      origin: host.includes("messenger.com") ? "https://www.messenger.com" : "https://www.facebook.com",`;
  if (src.includes(OLD_ORIGIN_WS)) {
    src = src.replace(OLD_ORIGIN_WS, NEW_ORIGIN_WS);
    console.log("  ✔ Patched: websocket-stream origin");
  }

  fs.writeFileSync(LISTEN_PATH, src, "utf8");
  console.log("  ✔ Saved listenMqtt.js\n");
} else {
  console.error("  ✘ listenMqtt.js not found at:", LISTEN_PATH);
}

// ─── 2. Patch index.js (more irisSeqID regex + messenger fetch) ───────────────
const INDEX_PATH = path.join(FCA_DIR, "index.js");

if (fs.existsSync(INDEX_PATH)) {
  let src = fs.readFileSync(INDEX_PATH, "utf8");

  // Add extra irisSeqID patterns after the existing "Cannot get MQTT region" warn
  const OLD_NO_MQTT = `        log.warn("login", "Cannot get MQTT region & sequence ID.");
        noMqttData = html;`;

  const NEW_NO_MQTT = `        // Try additional newer Facebook HTML patterns
        let extraMatch1 = html.match(/"sequence_id"\\s*:\\s*"?(\\d+)"?/);
        let extraMatch2 = html.match(/\\["IrisSeqID",[^,]*,\\{[^}]*"sequenceID"\\s*:\\s*"?(\\d+)"?/);
        let extraMatch3 = html.match(/"initialPayload".*?"syncToken"\\s*:\\s*"([^"]+)"/s);
        let extraMatch4 = html.match(/DTSGInitialData.*?"token":"([^"]+)"/);
        if (extraMatch1) {
          irisSeqID = extraMatch1[1];
          log.info("login", \`Got iris sequence ID via fallback pattern: \${irisSeqID}\`);
        } else if (extraMatch2) {
          irisSeqID = extraMatch2[1];
          log.info("login", \`Got iris sequence ID via fallback pattern 2: \${irisSeqID}\`);
        } else {
          log.warn("login", "Cannot get MQTT region & sequence ID.");
        }
        noMqttData = html;`;

  if (src.includes(OLD_NO_MQTT)) {
    src = src.replace(OLD_NO_MQTT, NEW_NO_MQTT);
    console.log("  ✔ Patched: extra irisSeqID regex patterns in index.js");
    fs.writeFileSync(INDEX_PATH, src, "utf8");
    console.log("  ✔ Saved index.js\n");
  } else {
    console.warn("  ⚠ index.js irisSeqID patch already applied or pattern changed");
  }
} else {
  console.error("  ✘ fca-unofficial/index.js not found");
}

console.log("✔ fca-unofficial patch complete\n");
