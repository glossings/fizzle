# OSC

Deferred. MIDI and gamepad input shipped first because they need nothing
installed; OSC can't work that way, and this is the scoping note for when it
comes up.

## The constraint

A browser cannot receive UDP. There is no API for it and there is not going to
be one. OSC in practice is UDP: Max, SuperCollider, Ableton via
Max for Live, TouchOSC and Lemur all send it that way.

So OSC needs a process outside the browser relaying UDP to something a page
can hold open, which in practice means a WebSocket. That is the whole of the
difficulty; the sketch-side API is easy once the bridge exists.

Sending OSC out of the browser has the same problem and is not covered here.
If it ever matters, the same bridge relays in both directions.

## Shape of the bridge

Smallest thing that works: a package run with `npx`, no install, printing what
it bound to.

```
$ npx fizzle-osc
listening for OSC on udp 57121
serving ws://localhost:57122
```

It binds a UDP socket, decodes each packet enough to get address and
arguments, and forwards them as JSON over the WebSocket. Decoding OSC is not
much work (null-padded strings, a type tag string, big-endian arguments) and
`osc-min` already does it if a dependency is acceptable. Bundles must be
handled: a `#bundle` packet holds several messages and a timetag, and
TouchOSC sends them.

Ports should be flags, since 57120 and 57121 are SuperCollider's and will
collide on a machine running it.

### localhost from an https page

Fizzle is served over https, and a page normally can't open an insecure
`ws://`. Localhost is the exception: it counts as a potentially trustworthy
origin, so `ws://localhost:57122` is allowed from https in Chrome and Firefox.

Two things to verify before promising it works:

- **Safari.** Stricter about mixed content and has historically not applied
  the localhost carve-out to WebSockets. Test it before the docs claim it.
- **Chrome's Private Network Access.** Requests from a public origin to a
  local one are being tightened. Localhost-to-localhost is the intended
  survivor of that change, but it is the part most likely to have moved by the
  time this is built, so check the current state rather than trusting this
  note.

If either blocks it, the fallback is running fizzle from `localhost` (the dev
server already does) and accepting that the hosted build can't do OSC.

## Sketch API

Same shape as the rest: a call returning a signal, a learn path for the
address, and no configuration in the sketch beyond the address itself.

```js
osc('/1/fader3')        // last value at that address, 0..1 as sent
osc('/xy', 1)           // second argument of a multi-argument message
osc()                   // learn: binds to the next address that arrives
```

`osc()` learn reuses exactly the machinery MIDI learn uses: an empty call sets
`engine.pendingLearn`, main.js arms a listener, the first message to arrive is
written into the call by `fillCall`, and the sketch re-runs bound to it. See
[control.js](../src/control.js) and `handleLearn` in
[main.js](../src/main.js).

Open questions, none of them blocking:

- **Range.** OSC carries floats with no agreed range. TouchOSC sends 0..1, a
  Max patch sends whatever it likes. Passing the value through untouched and
  letting `.range({ from })` handle the rest is the honest default, and it
  breaks the "signals are 0..1" convention the rest of the API keeps. Worth
  deciding deliberately rather than by accident.
- **Address patterns.** OSC has wildcards (`/track/*/level`). Matching them is
  easy; whether a sketch wants one signal per address or a pattern collapsing
  several is a design question.
- **Strings and blobs.** Non-numeric arguments have nowhere to go in a signal.
  Probably ignore them.

## Effort

The bridge is a day, most of it packaging and testing against real senders
rather than the decode. The sketch side is a few hours: it is `midi()` with a
string key and a WebSocket in place of the MIDI event.

The risk is not the code, it is that OSC is the one input that can fail in
someone else's hands (wrong port, firewall prompt, bridge not running, a DAW
already holding the port), and it fails silently. Whatever gets built needs a
visible "connected / not connected" state and a warning that names the port,
or it will be unusable on a stage.
