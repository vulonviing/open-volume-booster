// Open Volume Booster — background service worker.
// No network calls anywhere in this file (or the extension). Everything is
// local: chrome.tabCapture -> offscreen document -> Web Audio GainNode.

let boostedTabId = null;

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

  boostedTabId = tabId;

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId,
    gain,
    limiter
  });
}

function setGain(gain) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'set-gain', gain });
}

function setLimiter(limiter) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'set-limiter', limiter });
}

function stopBoost() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
  boostedTabId = null;
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
      setGain(msg.gain);
      sendResponse({ ok: true });
    } else if (msg.type === 'set-limiter') {
      setLimiter(msg.limiter);
      sendResponse({ ok: true });
    } else if (msg.type === 'stop') {
      stopBoost();
      sendResponse({ ok: true });
    } else if (msg.type === 'status') {
      sendResponse({ ok: true, boostedTabId });
    }
  })();

  return true; // keep the message channel open for the async response
});

// If the boosted tab is closed, clean up state (the capture stream dies with it).
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === boostedTabId) boostedTabId = null;
});
