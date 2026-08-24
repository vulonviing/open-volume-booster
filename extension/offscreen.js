// Runs in the offscreen document. Owns one AudioContext/GainNode/limiter
// per boosted tab, so multiple tabs can be boosted independently at the
// same time. Never makes a network request; only ever talks to the
// service worker via chrome.runtime messages.
//
// Signal path per tab:
//   source -> gainNode -> [compressor (limiter, optional)] -> destination
// The compressor is spliced in/out by reconnecting gainNode, so toggling
// the limiter never requires tearing down that tab's capture stream.

const sessions = new Map(); // tabId -> { audioCtx, gainNode, compressor, mediaStream, limiterEnabled }

const RAMP_SECONDS = 0.02; // avoids audible "click" on gain changes

function createCompressor(ctx) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = -6;
  node.knee.value = 3;
  node.ratio.value = 20;
  node.attack.value = 0.003;
  node.release.value = 0.25;
  return node;
}

function connectChain(session) {
  session.gainNode.disconnect();
  if (session.limiterEnabled) {
    session.gainNode.connect(session.compressor).connect(session.audioCtx.destination);
  } else {
    session.gainNode.connect(session.audioCtx.destination);
  }
}

async function start(tabId, streamId, gain, limiter) {
  await stop(tabId); // clean any previous session for this tab first

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = gain;
  const compressor = createCompressor(audioCtx);

  const session = { audioCtx, gainNode, compressor, mediaStream, limiterEnabled: limiter };
  sessions.set(tabId, session);

  source.connect(gainNode);
  connectChain(session);

  // If this tab closes (or Chrome revokes the capture for any other
  // reason), the track ends on its own -- clean up just this tab's
  // session immediately instead of leaving a dangling AudioContext.
  // This is also the only reliable way to notice the tab closed: it
  // doesn't depend on the service worker, which can be suspended and
  // restarted by Chrome at any time, losing any in-memory bookkeeping.
  const [track] = mediaStream.getAudioTracks();
  if (track) {
    track.addEventListener('ended', () => { stop(tabId); });
  }
}

function setGain(tabId, gain) {
  const session = sessions.get(tabId);
  if (!session) return;
  session.gainNode.gain.setTargetAtTime(gain, session.audioCtx.currentTime, RAMP_SECONDS);
}

function setLimiter(tabId, enabled) {
  const session = sessions.get(tabId);
  if (!session) return;
  session.limiterEnabled = enabled;
  connectChain(session);
}

async function stop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  session.mediaStream.getTracks().forEach((t) => t.stop());
  await session.audioCtx.close();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'start') {
    start(msg.tabId, msg.streamId, msg.gain, msg.limiter);
  } else if (msg.type === 'set-gain') {
    setGain(msg.tabId, msg.gain);
  } else if (msg.type === 'set-limiter') {
    setLimiter(msg.tabId, msg.limiter);
  } else if (msg.type === 'stop') {
    stop(msg.tabId);
  } else if (msg.type === 'status') {
    // This document is the only place that actually knows whether
    // boosting is live -- the service worker's own memory can be wiped
    // and restarted by Chrome at any time, so the popup asks here
    // directly instead of trusting anything cached in the background.
    const session = sessions.get(msg.tabId);
    sendResponse(session
      ? { active: true, gain: session.gainNode.gain.value, limiterEnabled: session.limiterEnabled }
      : { active: false });
  } else if (msg.type === 'status-all') {
    sendResponse(Array.from(sessions, ([tabId, s]) => ({
      tabId,
      gain: s.gainNode.gain.value,
      limiterEnabled: s.limiterEnabled
    })));
  }
});
