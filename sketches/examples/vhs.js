// VHS — recording, playback and the television, in that order.
// A bare videofile() opens a picker on the first ctrl+enter and writes your
// choice into the call. Delete the name to pick another.
// Commented-out lines are extras: uncomment one to try it.

const tape = videofile()

// Burned in by the camcorder, so it degrades with everything else. The VCR's
// own readout is added at the end and stays clean.
const recorded = tape.comp(
  text('JUL 28 1994\n 9:41 PM', { size: 0.035, pos: [0.96, 0.15], align: 'right' }),
  'screen'
)

// --- recording: color-under ---

// VHS gives luma ~320 samples across the frame and chroma ~40, and that 8:1
// split is most of the look. A cell count paired with an absurd vertical one
// makes .pixellate() a horizontal-only bandwidth limit.
const LUMA_CELLS = 320
const CHROMA_CELLS = 44   // 16 for a fourth-generation dub

const snow = noise({ freq: 320, octaves: 1, speed: 55 })
  .blur([5, 0])      // tape noise is 1-D, read along the line
  .contrast(3)

const chromaNoise = noise({ channels: 3, freq: 16, speed: 7 })
  .transform({ scale: [2.2, 1] })

const chroma = recorded
  .blur([6, 2])
  .pixellate(CHROMA_CELLS, 4000)
  .blur([5, 1])
  .translate(0.005, 0)     // chroma is decoded late, so color lags right
  .comp(chromaNoise, 'add', 0.3)

const luma = recorded
  .saturation(0)
  .blur(1)
  .pixellate(LUMA_CELLS, 4000)
  .comp(s => s.edge({ strength: 0.7, spread: 3 }), 'add', 0.3)   // deck sharpening
  .comp(snow, 'add', 0.07)

// 'luminosity' keeps the base's color and takes the layer's brightness —
// smeared chroma over sharp luma, which is what color-under does
const composite = chroma.comp(luma, 'luminosity')
  // .comp(ramp({ type: 'angular' }), 'color', 0.5)   // color lock, lost

// --- playback ---

// One jitter value per scanline: the x scale collapses noise to a single
// column, and pinning G to 0.5 keeps displace() sideways.
const lineJitter = noise({ channels: 2, freq: 140, speed: 30 })
  .transform({ scale: [600, 1] })
  .mul([1, 0, 0])
  .add([0, 0.5, 0])

const headSwitch = ramp({ angle: -Math.PI / 2 }).threshold(0.976, { soft: 0.005 })
const flagging = ramp({ angle: Math.PI / 2 }).threshold(0.978, { soft: 0.04 })

// A scrolling ramp, thresholded: a band that drifts up the frame
const tracking = ramp({ angle: Math.PI / 2, period: 1, phase: T.mul(-0.07) })
  .threshold(0.94, { soft: 0.05 })
  // .threshold(0.86, { soft: 0.12 })   // instead: a fat, unmissable tracking band

const dropouts = noise({ freq: 240, octaves: 1, speed: 9 })
  .transform({ scale: [14, 1] })
  .threshold(0.93, { soft: 0.02 })
  .blur([3, 0])

const played = composite
  .displace(lineJitter, { amount: 0.006 })
  .translate(t => Math.sin(t * 0.7) * 0.002 + Math.sin(t * 5.3) * 0.0008, 0)   // wow and flutter
  .mask(flagging, s => s.translate(T.mul(0.33).sin().range(0.004, 0.02), 0))
  .mask(tracking, s => s
    .displace(lineJitter, { amount: 0.05 })
    .comp(snow, 'add', 0.5)
    .saturation(0.35))
  .mask(headSwitch, s => s
    .translate(rand({ freq: 22 }).mul(0.07).add(-0.035), 0, { wrap: 'repeat' })
    .comp(snow, 'add', 0.7)
    .saturation(0.25))
  .comp(dropouts, 'screen', 0.45)

// --- the television ---

// A triangle wave up the frame: 240 soft stripes
const scanlines = ramp({ a: '#8a8a8a', b: '#ffffff', angle: Math.PI / 2, freq: 240, shape: 'tri' })

const readout = t => {
  const s = Math.floor(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `▶  SP    ${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}

played
  .comp(input('vhs'), 'lighten', 0.28)
  .out('vhs')                            // the feedback loop closes before the tube
  .comp(text(readout, { size: 0.045, pos: [0.06, 0.9], align: 'left' }), 'screen')
  .blur([1.5, 0])
  .pixellate(4000, 240)
  .comp(scanlines, 'mult')
  .levels({ contrast: 0.94, saturation: 1.12 })
  .add([0.035, 0.03, 0.05])              // VHS black is milky, and a little blue
  .chroma(0.0025, { radial: true })
  .warp({ barrel: 0.09, zoom: 1.03 })
  .bloom({ threshold: 0.72, strength: 0.55, radius: 1.3 })
  .out()
