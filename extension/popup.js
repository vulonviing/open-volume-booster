const fader = document.getElementById('fader');
const readout = document.getElementById('readout');
const ticksEl = document.getElementById('ticks');
const statusDot = document.getElementById('status-dot');
const limiterInput = document.getElementById('limiter');
const extendedInput = document.getElementById('extended');
const warning = document.getElementById('warning');
const toggleBtn = document.getElementById('toggle');
const presets = Array.from(document.querySelectorAll('.preset'));

const confirmEl = document.getElementById('confirm');
const confirmTitle = document.getElementById('confirm-title');
const confirmBody = document.getElementById('confirm-body');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');

const SNAP_TARGET = 1; // gain 1.0 == 100%

// --- Safety gate constants ---
// Below WARN_FLOOR_PCT no confirmation is needed at all. From there up,
// every WARN_STEP_PCT band (200, 250, 300, ...) requires its own
// confirmation before the audio is actually changed. SAFE_MAX is the
// fader ceiling until "Extended boost" is explicitly unlocked for this
// popup session; FULL_MAX is the ceiling once it is.
const WARN_FLOOR_PCT = 200;
const WARN_STEP_PCT = 50;
const SAFE_MAX = 3; // 300%
const FULL_MAX = 8; // 800%

let active = false;
let extendedEnabled = false; // session-only; never persisted, always starts off
let ackedBand = 0; // highest gain band the user has explicitly confirmed
let lastAppliedGain = 1; // last gain actually sent to the audio chain

function pctOf(gain) {
  return Math.round(gain * 100);
}

function bandOfPct(pct) {
  return pct < WARN_FLOOR_PCT ? 0 : Math.floor(pct / WARN_STEP_PCT) * WARN_STEP_PCT;
}

function zoneOf(gain) {
  const pct = pctOf(gain);
  if (pct > 400) return 'hot';
  if (pct > 100) return 'boost';
  return 'safe';
}

function currentMax() {
  return extendedEnabled ? FULL_MAX : SAFE_MAX;
}

// --- Rendering ---

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

function updatePresetAvailability() {
  const max = currentMax();
  presets.forEach((btn) => {
    btn.disabled = parseFloat(btn.dataset.gain) > max + 0.001;
  });
}

function setTrackGradient(max) {
  const safeStop = Math.min((1 / max) * 100, 100);
  const boostStop = Math.min((4 / max) * 100, 100);
  fader.style.setProperty('--safe-stop', safeStop + '%');
  fader.style.setProperty('--boost-stop', boostStop + '%');
}

function setTicks(max) {
  const labels = max === SAFE_MAX ? [0, 100, 200, 300] : [0, 100, 200, 400, 800];
  ticksEl.textContent = '';
  labels.forEach((pct) => {
    const span = document.createElement('span');
    span.className = 'tick';
    span.textContent = String(pct);
    span.style.left = ((pct / 100 / max) * 100) + '%';
    ticksEl.append(span);
  });
}

function setFaderMax(max) {
  fader.max = String(max);
  setTrackGradient(max);
  setTicks(max);
  updatePresetAvailability();
}

function currentGain() {
  return parseFloat(fader.value);
}

// --- Safety confirmation modal ---

function buildBoostCopy(pct, okLabel) {
  const multiplier = pct % 100 === 0 ? (pct / 100) : (pct / 100).toFixed(1);
  return {
    title: 'This volume level can cause damage',
    body: `${pct}% is ${multiplier}× normal volume. This can permanently damage your hearing through headphones and can blow your speakers. The limiter only stops digital clipping — it does not make this level of loudness safe.`,
    okLabel
  };
}

function askConfirm({ title, body, okLabel }) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmBody.textContent = body;
    confirmOk.textContent = okLabel;
    confirmEl.hidden = false;

    const focusable = [confirmCancel, confirmOk];
    const previouslyFocused = document.activeElement;

    function cleanup(result) {
      confirmEl.hidden = true;
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmEl.removeEventListener('keydown', onKeydown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const idx = focusable.indexOf(document.activeElement);
        const next = e.shiftKey
          ? focusable[(idx - 1 + focusable.length) % focusable.length]
          : focusable[(idx + 1) % focusable.length];
        next.focus();
      }
    }

    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmEl.addEventListener('keydown', onKeydown);
    confirmCancel.focus();
  });
}

async function confirmBandIfNeeded(pct, okLabel) {
  if (bandOfPct(pct) <= ackedBand) return true;
  const approved = await askConfirm(buildBoostCopy(pct, okLabel));
  if (approved) ackedBand = bandOfPct(pct);
  return approved;
}

// --- Committing gain to the audio chain ---

function commitGain(gain) {
  const pct = pctOf(gain);
  if (pct < WARN_FLOOR_PCT) ackedBand = 0;
  lastAppliedGain = gain;
  fader.value = gain;
  render(gain, limiterInput.checked);
  chrome.storage.local.set({ gain });
  if (active) {
    chrome.runtime.sendMessage({ target: 'service-worker', type: 'set-gain', gain });
  }
}

function previewGain(gain) {
  render(gain, limiterInput.checked);
}

async function requestGain(gain, okLabel) {
  const pct = pctOf(gain);
  if (bandOfPct(pct) <= ackedBand) {
    commitGain(gain);
    return;
  }
  previewGain(gain);
  const approved = await confirmBandIfNeeded(pct, okLabel);
  if (approved) {
    commitGain(gain);
  } else {
    fader.value = lastAppliedGain;
    render(lastAppliedGain, limiterInput.checked);
  }
}

// --- Load saved state ---
chrome.storage.local.get(['gain', 'limiterEnabled'], (data) => {
  const limiterEnabled = data.limiterEnabled ?? true;
  limiterInput.checked = limiterEnabled;

  setFaderMax(SAFE_MAX); // extended always starts off

  const storedGain = data.gain ?? 1;
  const gain = Math.min(storedGain, SAFE_MAX);
  lastAppliedGain = gain;
  fader.value = gain;
  render(gain, limiterEnabled);
});

// --- Fader ---
// While the extension is off, nothing is actually playing yet, so moving
// the fader is free — no audio is at risk. The one gate that matters is
// "am I about to start boosting at a high level", which lives on Turn On
// below. While it's ON, though, every step change is live, so crossing
// into a new band still needs its own confirmation before it's applied.
fader.addEventListener('input', () => {
  let gain = currentGain();
  if (Math.abs(gain - SNAP_TARGET) < 0.03) gain = SNAP_TARGET;

  if (!active) {
    commitGain(gain);
    return;
  }

  const pct = pctOf(gain);
  if (bandOfPct(pct) <= ackedBand) {
    commitGain(gain);
  } else {
    previewGain(gain);
  }
});

fader.addEventListener('change', async () => {
  if (!active) return; // already applied via 'input'; nothing live to protect
  const gain = currentGain();
  await requestGain(gain, 'Boost anyway');
});

// --- Presets ---
presets.forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const gain = parseFloat(btn.dataset.gain);
    if (!active) {
      commitGain(gain);
      return;
    }
    await requestGain(gain, 'Boost anyway');
  });
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

// --- Extended boost lock ---
extendedInput.addEventListener('change', async () => {
  if (extendedInput.checked) {
    const approved = await askConfirm({
      title: 'Extended boost unlocks up to 800%',
      body: 'Above 300% is very likely to damage headphones or speakers, or hurt your hearing, even with the limiter on. Only enable this if you specifically need it.',
      okLabel: 'Enable extended boost'
    });
    if (!approved) {
      extendedInput.checked = false;
      return;
    }
    extendedEnabled = true;
    setFaderMax(FULL_MAX);
  } else {
    extendedEnabled = false;
    setFaderMax(SAFE_MAX);
    if (currentGain() > SAFE_MAX) {
      commitGain(SAFE_MAX); // reducing gain never needs confirmation
    }
  }
});

// --- On/Off ---
toggleBtn.addEventListener('click', async () => {
  if (!active) {
    const gain = currentGain();
    const pct = pctOf(gain);
    const approved = await confirmBandIfNeeded(pct, 'Turn on anyway');
    if (!approved) return;

    const limiter = limiterInput.checked;
    const res = await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'start',
      gain,
      limiter
    });
    if (res && res.ok) {
      active = true;
      lastAppliedGain = gain;
      toggleBtn.textContent = 'Turn Off';
      toggleBtn.classList.add('on');
      statusDot.classList.add('on');
    }
  } else {
    await chrome.runtime.sendMessage({ target: 'service-worker', type: 'stop' });
    active = false;
    ackedBand = 0;
    toggleBtn.textContent = 'Turn On';
    toggleBtn.classList.remove('on');
    statusDot.classList.remove('on');
  }
});
