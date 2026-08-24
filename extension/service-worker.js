// Open Volume Booster — background service worker.
// No network calls anywhere in this file (or the extension). Everything is
// local: chrome.tabCapture -> offscreen document -> Web Audio GainNode.
//
// This file intentionally keeps no in-memory "is boosting active" state of
// its own. MV3 service workers are suspended and restarted by Chrome at
// any time (e.g. ~30s of inactivity), which would silently wipe any such
// state even while the offscreen document is still actually playing
// boosted audio. The offscreen document is the only context that reliably
// knows the live state (see its 'status' handler), so the popup asks it
// directly instead of trusting anything cached here.
//
// Multiple tabs can be boosted at once -- every message below carries the
// tabId it applies to, and offscreen.js keeps one independent audio
// session per tab.

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Boost captured tab audio via Web Audio GainNode'
  });
}

async function startBoost(tabId, gain, limiter) {
  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId
  });

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    tabId,
    streamId,
    gain,
    limiter
  });
}

function setGain(tabId, gain) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'set-gain', tabId, gain });
}

function setLimiter(tabId, limiter) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'set-limiter', tabId, limiter });
}

function stopBoost(tabId) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', tabId });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'service-worker') return;

  (async () => {
    if (msg.type === 'start') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return sendResponse({ ok: false, error: 'no active tab' });
      await startBoost(tab.id, msg.gain, msg.limiter);
      sendResponse({ ok: true, tabId: tab.id });
    } else if (msg.type === 'set-gain') {
      setGain(msg.tabId, msg.gain);
      sendResponse({ ok: true });
    } else if (msg.type === 'set-limiter') {
      setLimiter(msg.tabId, msg.limiter);
      sendResponse({ ok: true });
    } else if (msg.type === 'stop') {
      stopBoost(msg.tabId);
      sendResponse({ ok: true });
    }
  })();

  return true; // keep the message channel open for the async response
});
