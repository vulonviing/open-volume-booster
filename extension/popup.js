const fader = document.getElementById('fader');
const readout = document.getElementById('readout');
const statusDot = document.getElementById('status-dot');
const limiterInput = document.getElementById('limiter');
const warning = document.getElementById('warning');
const toggleBtn = document.getElementById('toggle');
const presets = Array.from(document.querySelectorAll('.preset'));

const SNAP_TARGET = 1; // gain 1.0 == 100%
const SNAP_RADIUS = 0.03;

let active = false;

function pctOf(gain) {
  return Math.round(gain * 100);
}

function zoneOf(gain) {
  const pct = pctOf(gain);
  if (pct > 400) return 'hot';
  if (pct > 100) return 'boost';
  return 'safe';
}

function render(gain, limiterEnabled) {
  const pct = pctOf(gain);
  readout.textContent = '';
  readout.append(String(pct));
  const span = document.createElement('span');
  span.className = 'pct';
  span.textContent = '%';
  readout.append(span);

  readout.classList.remove('zone-boost', 'zone-hot');
  const zone = zoneOf(gain);
  if (zone === 'boost') readout.classList.add('zone-boost');
  if (zone === 'hot') readout.classList.add('zone-hot');

  fader.setAttribute('aria-valuetext', pct + '%');

  presets.forEach((btn) => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.gain) - gain) < 0.01);
  });

  warning.hidden = !(pct > 400 && !limiterEnabled);
}

function currentGain() {
  return parseFloat(fader.value);
}

function applyGain(gain, { persist = true } = {}) {
  fader.value = gain;
  render(gain, limiterInput.checked);
  if (persist) chrome.storage.local.set({ gain });
  if (active) {
    chrome.runtime.sendMessage({ target: 'service-worker', type: 'set-gain', gain });
  }
}

// --- Load saved state ---
chrome.storage.local.get(['gain', 'limiterEnabled'], (data) => {
  const gain = data.gain ?? 1;
  const limiterEnabled = data.limiterEnabled ?? true;
  limiterInput.checked = limiterEnabled;
  fader.value = gain;
  render(gain, limiterEnabled);
});

// --- Fader ---
fader.addEventListener('input', () => {
  let gain = currentGain();
  if (Math.abs(gain - SNAP_TARGET) < SNAP_RADIUS) gain = SNAP_TARGET;
  applyGain(gain);
});

// --- Presets ---
presets.forEach((btn) => {
  btn.addEventListener('click', () => applyGain(parseFloat(btn.dataset.gain)));
});

// --- Limiter ---
limiterInput.addEventListener('change', () => {
  const limiterEnabled = limiterInput.checked;
  render(currentGain(), limiterEnabled);
  chrome.storage.local.set({ limiterEnabled });
  if (active) {
    chrome.runtime.sendMessage({ target: 'service-worker', type: 'set-limiter', limiter: limiterEnabled });
  }
});

// --- On/Off ---
toggleBtn.addEventListener('click', async () => {
  const gain = currentGain();
  const limiter = limiterInput.checked;

  if (!active) {
    const res = await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'start',
      gain,
      limiter
    });
    if (res && res.ok) {
      active = true;
      toggleBtn.textContent = 'Turn Off';
      toggleBtn.classList.add('on');
      statusDot.classList.add('on');
    }
  } else {
    await chrome.runtime.sendMessage({ target: 'service-worker', type: 'stop' });
    active = false;
    toggleBtn.textContent = 'Turn On';
    toggleBtn.classList.remove('on');
    statusDot.classList.remove('on');
  }
});
