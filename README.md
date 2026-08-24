# Open Volume Booster

A local, open-source, single-user volume booster for Chromium-based browsers
(Chrome, Dia, Arc, Edge, Brave). Boosts or lowers the active tab's audio from
**0% to 800%**, with an optional limiter to keep high gain from clipping.

No network access. No telemetry. No page access. Everything you need to
verify that is in this repo — it's a few hundred lines of plain JS.

## Why this exists

Most volume booster extensions on the Chrome Web Store ask for far more
access than the job needs — full access to every page you visit, sometimes
more. Boosting a tab's audio only requires `chrome.tabCapture` and the Web
Audio API; it never needs to read or run code on the pages you visit. So
this one doesn't ask for that.

This project is for anyone who wants the same functionality without having
to trust a closed, unreviewable extension: it's small enough to read in full,
asks for exactly three permissions, and everything it does is verifiable
from the source. Security isn't an afterthought here — it's the entire
reason this exists. See [`SECURITY.md`](SECURITY.md) for the exact
guarantees this project holds itself to and how to verify them yourself.

## Install (unpacked, local use)

1. Open `chrome://extensions` (or `dia://extensions` on Dia).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Click the extension's icon in the toolbar, adjust the fader, hit **Turn On**.

Full details, including how to update after pulling changes, are in
[`extension/README.md`](extension/README.md).

## How it works

```
popup.js  →  service-worker.js  →  offscreen.js
 (UI)          (tabCapture,          (AudioContext +
                offscreen doc)        GainNode + limiter)
```

1. The popup sends a `start` message with the desired gain and limiter state.
2. The service worker opens (or reuses) an offscreen document and gets a
   `MediaStream` ID for the active tab via `chrome.tabCapture.getMediaStreamId`.
3. The offscreen document captures that stream, routes it through a
   `GainNode` (0.0–8.0), optionally through a `DynamicsCompressorNode` acting
   as a limiter, and out to the speakers.
4. Moving the fader live-updates the gain with a short ramp
   (`setTargetAtTime`) so there's no audible click.

Gain and limiter state persist in `chrome.storage.local` between popup
opens; nothing leaves the device.

## The fader

The gain fader is a small mixing-console channel strip: the track is printed
green (0–100%) → amber (100–400%) → red (400–800%), like ink on a hardware
fader, so the danger zone is visible at a glance regardless of where the cap
sits. 100% has a magnetic snap so finding "no boost" is easy. Preset buttons
jump to 50/100/200/400/800%.

## Limiter

Above ~150–200% gain, most audio will clip without correction. The built-in
limiter is a `DynamicsCompressorNode` (threshold −6 dB, ratio 20:1, fast
attack) that keeps peaks in check. It's on by default; turn it off if you'd
rather have raw, uncompressed gain and are prepared for distortion.

## Safety

**Turn your system/output volume down before boosting for the first time.**
800% gain on top of already-loud content can genuinely hurt your ears or
your speakers. Start low, raise gradually, and use the limiter unless you
have a specific reason not to.

## Limitations

- Boosts one tab at a time (starting a new tab's boost implicitly replaces
  the previous one, matching how `chrome.tabCapture` works).
- Closing the boosted tab stops capture automatically; reopening the popup
  requires pressing "Turn On" again.
- No EQ / bass-treble controls — gain and a limiter only, by design.
- Not published to the Chrome Web Store; it's meant to be loaded unpacked
  for personal use.

## Security

See [`SECURITY.md`](SECURITY.md) for what the extension can and can't
access, where captured audio goes, and the commands to verify all of it
yourself.

## License

MIT — see [`LICENSE`](LICENSE).
