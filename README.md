# Open Volume Booster

A local, open-source, single-user volume booster for Chromium-based browsers
(Chrome, Dia, Arc, Edge, Brave). Boosts or lowers any tab's audio from
**0% to 800%**, independently per tab, with an optional limiter to keep
high gain from clipping.

No network access. No page content access. No telemetry. Everything you
need to verify that is in this repo — it's a few hundred lines of plain JS.

## Why this exists

Most volume booster extensions on the Chrome Web Store ask for far more
access than the job needs — full access to every page you visit, sometimes
more. Boosting a tab's audio only requires `chrome.tabCapture` and the Web
Audio API; it never needs to read or run code on the pages you visit. So
this one doesn't ask for that.

This project is for anyone who wants the same functionality without having
to trust a closed, unreviewable extension: it's small enough to read in full,
asks for a handful of narrow permissions instead of blanket page access, and
everything it does is verifiable from the source. Security isn't an
afterthought here — it's the entire reason this exists. See
[`SECURITY.md`](SECURITY.md) for the exact guarantees this project holds
itself to and how to verify them yourself.

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

## Boosting multiple tabs

Each tab gets its own independent boost session — the offscreen document
keeps a separate `AudioContext`/`GainNode`/limiter per tab, so you can boost
tab A to 250% and tab B to 150% at the same time, and adjusting one never
touches the other.

Open the popup on any tab and it shows two things:

- **The current tab's controls** — the same fader/presets/limiter/Turn On
  as always, scoped to whichever tab the popup was opened from.
- **"Boosting elsewhere"** — every *other* tab that's currently boosted,
  listed by its title, favicon, and current level. Click a row to switch to
  that tab, or hit its **Turn Off** to stop it without leaving the tab
  you're on. This list is read-only otherwise — you can't raise another
  tab's volume remotely, only from that tab's own popup, so there's exactly
  one place a high-gain confirmation can ever be skipped by mistake.

This is why the extension asks for the **`tabs`** permission (new in
v1.2.0, on top of `tabCapture`/`offscreen`/`storage`): showing that list
needs each boosted tab's title and favicon, which requires being able to
see basic metadata for your open tabs. To be precise about what that does
and doesn't mean: it lets the extension see the **titles, URLs, and
favicons of all your open tabs** — real information about what sites you
have open. It does **not** grant access to page content, does not let the
extension run code on any page, and does not add any `host_permissions` —
those stay absent. See [`SECURITY.md`](SECURITY.md) for the full picture.

## The fader

The gain fader is a small mixing-console channel strip: the track is printed
green (0–100%) → amber (100–400%) → red (above that), like ink on a hardware
fader, so the danger zone is visible at a glance regardless of where the cap
sits. 100% has a magnetic snap so finding "no boost" is easy. Preset buttons
jump to 50/100/200/400/800% — 400% and 800% are disabled until **Extended
boost** is unlocked (see Safety below). The fader tops out at 300% by
default and 800% once unlocked.

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

This isn't just a disclaimer — a few concrete reasons it matters:

- **Hearing.** 800% gain on already-loud content can easily push past
  100 dB SPL. The WHO's threshold for sustained-exposure hearing damage is
  around 85 dB. Headphones and earbuds are riskier than speakers because
  the sound has nowhere to go but your ear canal.
- **The limiter caps distortion, not loudness.** Its job is to stop digital
  clipping when gain gets high — it does not make a given volume level
  hearing-safe. "No distortion" isn't the same as "safe."
- **Speakers.** With the limiter off, high gain produces digital clipping —
  a near-square waveform carrying far more high-frequency energy than
  normal audio, which can overheat and blow a tweeter. Small speakers
  (laptops especially) have the least headroom.

Because of this, the extension itself gates high gain instead of just
warning about it in a README nobody reads mid-click:

| Situation | What happens |
|---|---|
| Fader below 200% | No prompt |
| Fader raised past a new +50% band | Confirmed before that value is applied — this happens whether boosting is on or off, so you see the warning the moment you commit to a level, not just at Turn On |
| Pressing **Turn On** with the fader at 200%+ | Confirmed *again*, separately, every time — even if that exact level was already approved while dragging. Starting playback is the moment sound actually reaches your ears or speakers, so it gets its own check |
| Fader raised further **while already on** | Same per-band confirmation as above, applied live — sliding from 200% to 800% while boosting asks more than once |
| Above 300% | Locked behind a separate **Extended boost** toggle (off by default, resets every time you reopen the popup), which has its own warning |

Canceling a prompt reverts the fader and never touches the actual volume.
Dropping back below 200% clears the confirmations, so climbing back up
asks again — the gate never "stays open" by accident.

## Limitations

- Closing a boosted tab stops its capture automatically; reopening the
  popup on a new tab requires pressing "Turn On" again for that tab.
- Switching to a different tab, or closing the popup, does **not** stop
  boosting on the tab you were on — it keeps playing at the level you set,
  independently of whatever tab you're currently looking at. Reopening the
  popup (on that tab, or seeing it in "Boosting elsewhere" from another
  one) correctly shows whether it's still on and lets you adjust or stop
  it, no matter how long it's been.
- No cap on how many tabs can be boosted at once — in practice this is
  fine for the handful of tabs someone actually boosts, but resource use
  with many simultaneous sessions hasn't been specifically tested.
- No EQ / bass-treble controls — gain and a limiter only, by design.
- Not published to the Chrome Web Store; it's meant to be loaded unpacked
  for personal use.

## Security

See [`SECURITY.md`](SECURITY.md) for what the extension can and can't
access, where captured audio goes, and the commands to verify all of it
yourself.

## License

MIT — see [`LICENSE`](LICENSE).
