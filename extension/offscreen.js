// Runs in the offscreen document. Owns the AudioContext/GainNode/limiter.
// Never makes a network request; only ever talks to the service worker
// via chrome.runtime messages.
//
// Signal path:
//   source -> gainNode -> [compressor (limiter, optional)] -> destination
// The compressor is spliced in/out by reconnecting gainNode, so toggling
// the limiter never requires tearing down the capture stream.

let audioCtx = null;
let gainNode = null;
let compressor = null;
let mediaStream = null;
let limiterEnabled = true;

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

function connectChain() {
  gainNode.disconnect();
  if (limiterEnabled) {
    gainNode.connect(compressor).connect(audioCtx.destination);
  } else {
    gainNode.connect(audioCtx.destination);
  }
}

async function start(streamId, gain, limiter) {
  await stop(); // clean any previous session first

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  // If the captured tab closes (or Chrome revokes the capture for any
  // other reason), the track ends on its own -- clean up immediately
  // instead of leaving a dangling AudioContext. This is also the only
  // reliable way to notice the tab closed: it doesn't depend on the
  // service worker, which can be suspended and restarted by Chrome at
  // any time, losing any in-memory bookkeeping it might have kept.
  const [track] = mediaStream.getAudioTracks();
  if (track) {
    track.addEventListener('ended', () => { stop(); });
  }

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  gainNode = audioCtx.createGain();
  gainNode.gain.value = gain;
  compressor = createCompressor(audioCtx);
  limiterEnabled = limiter;

  source.connect(gainNode);
  connectChain();
}

function setGain(gain) {
  if (!gainNode) return;
  gainNode.gain.setTargetAtTime(gain, audioCtx.currentTime, RAMP_SECONDS);
}

function setLimiter(enabled) {
  limiterEnabled = enabled;
  if (audioCtx && gainNode) connectChain();
}

async function stop() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }
  gainNode = null;
  compressor = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg.streamId, msg.gain, msg.limiter);
  else if (msg.type === 'set-gain') setGain(msg.gain);
  else if (msg.type === 'set-limiter') setLimiter(msg.limiter);
  else if (msg.type === 'stop') stop();
  else if (msg.type === 'status') {
    // This document is the only place that actually knows whether
    // boosting is live -- the service worker's own memory can be wiped
    // and restarted by Chrome at any time, so the popup asks here
    // directly instead of trusting anything cached in the background.
    sendResponse({
      active: !!mediaStream,
      gain: gainNode ? gainNode.gain.value : null,
      limiterEnabled
    });
  }
});
