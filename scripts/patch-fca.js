#!/usr/bin/env node
/**
 * patch-fca.js — Patches fca-unofficial:
 * 1. messenger.com cookies (m_sess) in MQTT headers
 * 2. edge-chat.messenger.com when m_sess available
 * 3. Extra irisSeqID regex patterns
 * 4. getSeqID retry (3x) instead of immediate failure
 * 5. Null-safe getThreadList + getThreadHistory
 */

const fs   = require("fs");
const path = require("path");

const FCA_DIR    = path.join(__dirname, "../node_modules/fca-unofficial");
const LISTEN_PATH = path.join(FCA_DIR, "src/listenMqtt.js");
const INDEX_PATH  = path.join(FCA_DIR, "index.js");
const GTL_PATH    = path.join(FCA_DIR, "src/getThreadList.js");
const GTH_PATH    = path.join(FCA_DIR, "src/getThreadHistory.js");

// ─── 1. Patch listenMqtt.js ───────────────────────────────────────────────────
if (fs.existsSync(LISTEN_PATH)) {
  let src = fs.readFileSync(LISTEN_PATH, "utf8");
  let changed = false;

  // 1a. Cookie merger (facebook + messenger)
  const OLD_COOKIES = `var cookies = ctx.jar.getCookies("https://www.facebook.com").join("; ");`;
  const NEW_COOKIES = `var fbCookies = ctx.jar.getCookies("https://www.facebook.com").join("; ");
  var msCookies = ctx.jar.getCookies("https://www.messenger.com").join("; ");
  var cookies = msCookies ? fbCookies + "; " + msCookies : fbCookies;
  var hasMsess = !!(msCookies && msCookies.includes("m_sess="));`;

  if (src.includes(OLD_COOKIES)) {
    src = src.replace(OLD_COOKIES, NEW_COOKIES);
    console.log("  ✔ Patched: cookie merger (facebook + messenger)");
    changed = true;
  }

  // 1b. MQTT host → messenger.com when m_sess
  const OLD_HOST = `  } else {\n    host = \`wss://edge-chat.facebook.com/chat?sid=\${sessionID}\`;\n  }`;
  const NEW_HOST = `  } else if (hasMsess) {\n    host = \`wss://edge-chat.messenger.com/chat?sid=\${sessionID}\`;\n  } else {\n    host = \`wss://edge-chat.facebook.com/chat?sid=\${sessionID}\`;\n  }`;
  if (src.includes(OLD_HOST)) {
    src = src.replace(OLD_HOST, NEW_HOST);
    console.log("  ✔ Patched: MQTT host → messenger.com when m_sess");
    changed = true;
  }

  // 1c. Region host → messenger
  const OLD_REGION = `host = \`wss://edge-chat.facebook.com/chat?region=\${ctx.region.toLocaleLowerCase()}&sid=\${sessionID}\`;`;
  const NEW_REGION = `host = hasMsess ? \`wss://edge-chat.messenger.com/chat?region=\${ctx.region.toLocaleLowerCase()}&sid=\${sessionID}\` : \`wss://edge-chat.facebook.com/chat?region=\${ctx.region.toLocaleLowerCase()}&sid=\${sessionID}\`;`;
  if (src.includes(OLD_REGION)) {
    src = src.replace(OLD_REGION, NEW_REGION);
    console.log("  ✔ Patched: region host → messenger.com");
    changed = true;
  }

  // 1d. WebSocket Origin
  const OLD_ORIGIN = `        'Origin': 'https://www.facebook.com',`;
  const NEW_ORIGIN = `        'Origin': host.includes("messenger.com") ? "https://www.messenger.com" : "https://www.facebook.com",`;
  if (src.includes(OLD_ORIGIN)) {
    src = src.replace(OLD_ORIGIN, NEW_ORIGIN);
    console.log("  ✔ Patched: WebSocket Origin header");
    changed = true;
  }

  // 1e. WebSocket Referer
  const OLD_REF = `        'Referer': 'https://www.facebook.com/',`;
  const NEW_REF = `        'Referer': host.includes("messenger.com") ? "https://www.messenger.com/" : "https://www.facebook.com/",`;
  if (src.includes(OLD_REF)) {
    src = src.replace(OLD_REF, NEW_REF);
    console.log("  ✔ Patched: WebSocket Referer");
    changed = true;
  }

  // 1f. websocket-stream origin
  const OLD_WSORI = `      origin: 'https://www.facebook.com',`;
  const NEW_WSORI = `      origin: host.includes("messenger.com") ? "https://www.messenger.com" : "https://www.facebook.com",`;
  if (src.includes(OLD_WSORI)) {
    src = src.replace(OLD_WSORI, NEW_WSORI);
    console.log("  ✔ Patched: websocket-stream origin");
    changed = true;
  }

  // 1g. CRITICAL: Add getSeqID retry (3 times with 5s backoff)
  const OLD_CATCH = `      .catch((err) => {
        log.error("getSeqId", err);
        if (utils.getType(err) == "Object" && err.error === "Not logged in") {
          ctx.loggedIn = false;
        }
        return globalCallback(err);
      });`;

  const NEW_CATCH = `      .catch((err) => {
        log.error("getSeqId", err);
        if (utils.getType(err) == "Object" && err.error === "Not logged in") {
          ctx.loggedIn = false;
          // Retry getSeqID up to 3 times before failing
          if (typeof _seqRetryCount === "undefined") { _seqRetryCount = 0; }
          if (_seqRetryCount < 3) {
            _seqRetryCount++;
            log.warn("getSeqId", "Not logged in — retry " + _seqRetryCount + "/3 in 8s...");
            return setTimeout(getSeqID, _seqRetryCount * 8000);
          }
          _seqRetryCount = 0;
        }
        return globalCallback(err);
      });`;

  if (src.includes(OLD_CATCH) && !src.includes("_seqRetryCount")) {
    // Add _seqRetryCount variable declaration before getSeqID
    src = src.replace(
      `  getSeqID = function getSeqID() {`,
      `  var _seqRetryCount = 0;\n  getSeqID = function getSeqID() {`
    );
    src = src.replace(OLD_CATCH, NEW_CATCH);
    // Reset counter on success
    src = src.replace(
      `        if (resData[0].o0.data.viewer.message_threads.sync_sequence_id) {`,
      `        _seqRetryCount = 0;\n        if (resData[0].o0.data.viewer.message_threads.sync_sequence_id) {`
    );
    console.log("  ✔ Patched: getSeqID retry (3x with backoff)");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(LISTEN_PATH, src, "utf8");
    console.log("  ✔ Saved listenMqtt.js\n");
  } else {
    console.log("  ℹ listenMqtt.js already patched or patterns changed\n");
  }
} else {
  console.error("  ✘ listenMqtt.js not found:", LISTEN_PATH);
}

// ─── 2. Patch index.js (irisSeqID fallback patterns) ─────────────────────────
if (fs.existsSync(INDEX_PATH)) {
  let src = fs.readFileSync(INDEX_PATH, "utf8");

  const OLD_NO_MQTT = `        log.warn("login", "Cannot get MQTT region & sequence ID.");
        noMqttData = html;`;

  const NEW_NO_MQTT = `        // Try additional regex patterns for newer Facebook HTML
        var extraMatch1 = html.match(/"sequence_id"\\s*:\\s*"?(\\d+)"?/);
        var extraMatch2 = html.match(/\\["IrisSeqID",[^,]*,\\{[^}]*"sequenceID"\\s*:\\s*"?(\\d+)"?/);
        if (extraMatch1) {
          irisSeqID = extraMatch1[1];
          log.info("login", "Got irisSeqID via fallback-1: " + irisSeqID);
        } else if (extraMatch2) {
          irisSeqID = extraMatch2[1];
          log.info("login", "Got irisSeqID via fallback-2: " + irisSeqID);
        } else {
          log.warn("login", "Cannot get MQTT region & sequence ID.");
        }
        noMqttData = html;`;

  if (src.includes(OLD_NO_MQTT)) {
    src = src.replace(OLD_NO_MQTT, NEW_NO_MQTT);
    fs.writeFileSync(INDEX_PATH, src, "utf8");
    console.log("  ✔ Patched: extra irisSeqID patterns in index.js\n");
  } else {
    console.log("  ℹ index.js irisSeqID patch already applied\n");
  }
} else {
  console.error("  ✘ fca-unofficial/index.js not found");
}

// ─── 3. Patch getThreadList.js ────────────────────────────────────────────────
if (fs.existsSync(GTL_PATH)) {
  let src = fs.readFileSync(GTL_PATH, "utf8");

  const OLD_CHECK = `        if (resData[resData.length - 1].error_results > 0) {
          throw resData[0].o0.errors;
        }

        if (resData[resData.length - 1].successful_results === 0) {
          throw {error: "getThreadList: there was no successful_results", res: resData};
        }`;

  const NEW_CHECK = `        var lastItem = resData && resData[resData.length - 1];
        if (!lastItem || !resData[0] || !resData[0].o0 || !resData[0].o0.data) {
          throw {error: "getThreadList: unexpected response from Facebook"};
        }
        if (lastItem.error_results > 0) { throw resData[0].o0.errors; }
        if (lastItem.successful_results === 0) {
          throw {error: "getThreadList: no successful_results", res: resData};
        }`;

  if (src.includes(OLD_CHECK)) {
    src = src.replace(OLD_CHECK, NEW_CHECK);
    fs.writeFileSync(GTL_PATH, src, "utf8");
    console.log("  ✔ Patched: getThreadList.js null-safe\n");
  } else {
    console.log("  ℹ getThreadList.js already patched\n");
  }
}

// ─── 4. Patch getThreadHistory.js ─────────────────────────────────────────────
if (fs.existsSync(GTH_PATH)) {
  let src = fs.readFileSync(GTH_PATH, "utf8");

  const OLD_CHECK = `        if (resData[resData.length - 1].error_results !== 0) {
          throw new Error("There was an error_result.");
        }`;

  const NEW_CHECK = `        var lastResItem = resData && resData[resData.length - 1];
        if (!lastResItem) { throw new Error("getThreadHistory: unexpected response"); }
        if (lastResItem.error_results !== 0) { throw new Error("There was an error_result."); }`;

  if (src.includes(OLD_CHECK)) {
    src = src.replace(OLD_CHECK, NEW_CHECK);
    fs.writeFileSync(GTH_PATH, src, "utf8");
    console.log("  ✔ Patched: getThreadHistory.js null-safe\n");
  } else {
    console.log("  ℹ getThreadHistory.js already patched\n");
  }
}

console.log("✔ fca-unofficial patch complete\n");
