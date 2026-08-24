# Security

Security is the reason this project exists, not an afterthought bolted on
at the end. Most volume booster extensions ask for far more access than
boosting audio actually requires. Here's exactly what this one does and
doesn't do, and how to check it yourself in a few minutes.

## What it can access

- **The active tab's audio**, only while you've pressed "Turn On", via
  `chrome.tabCapture`.
- **Two local storage values** (`gain`, `limiterEnabled`) in
  `chrome.storage.local`. Nothing else is stored.

## What it cannot access

- **Page content.** `manifest.json` has no `host_permissions` and no
  `content_scripts` — the extension cannot read, modify, or inject anything
  into any page you visit.
- **The network.** No file makes a `fetch`, `XMLHttpRequest`, `WebSocket`, or
  `sendBeacon` call, and none references a remote URL. Nothing is ever sent
  anywhere.
- **Other extensions or web pages talking to it.** There's no
  `externally_connectable` entry in the manifest, so only the extension's
  own popup and offscreen document can message its service worker — a
  malicious web page cannot poke it from the outside.

## Where the captured audio goes

The `MediaStream` from `chrome.tabCapture` is connected to exactly one
chain in `extension/offscreen.js`:

```
source → gainNode → [compressor, optional] → audioCtx.destination
```

That's it — straight back out to your speakers. Nothing in this codebase
uses `MediaRecorder`, `AudioWorklet`, `ScriptProcessorNode`, or
`createMediaStreamDestination` — the APIs you'd need to record, analyze, or
export audio. The extension cannot listen in on you; it can only make what's
already playing louder or quieter.

## Verify it yourself

You don't have to take any of this on faith — the whole extension is a few
hundred lines of plain JavaScript. Two commands that should both come back
empty:

```bash
# No network calls, no eval, no cookie/history/identity access
grep -rEn "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|importScripts|atob\(|btoa\(|document\.cookie|chrome\.cookies|chrome\.history|chrome\.identity|chrome\.webRequest" extension/

# No recording/export APIs anywhere near the captured stream
grep -rn "MediaRecorder\|AudioWorklet\|createMediaStreamDestination\|ScriptProcessor" extension/
```

And a manifest check:

```bash
python3 -c "
import json
m = json.load(open('extension/manifest.json'))
print('permissions:', m['permissions'])
print('host_permissions present:', 'host_permissions' in m)
print('content_scripts present:', 'content_scripts' in m)
print('externally_connectable present:', 'externally_connectable' in m)
"
```

Expected: `permissions` is exactly `['tabCapture', 'offscreen', 'storage']`,
and the other three are all `False`.

## Reporting an issue

If you find something that contradicts any of the above, please open a
[GitHub issue](https://github.com/vulonviing/open-volume-booster/issues) —
that would be a genuine bug in a project whose entire point is not doing
that.
