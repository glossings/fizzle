// VHS — recording, playback and the television, in that order.
//
// Starts empty: the naked videofile() opens a picker on the first ctrl+enter
// and writes your choice into the call. Delete the name to pick another.

const tape = videofile()

// burned in by the camcorder, so it degrades with everything else (the VCR's
// own readout is added at the end, after the tape, and stays clean)
const recorded = tape.comp(
  text('JUL 28 1994\n 9:41 PM', { size: 0.035, pos: [0.96, 0.15], align: 'right' }),
  'screen'
)

// --- recording: colour-under ---

// VHS gives luma ~320 samples across the frame and chroma ~40. That 8:1 split
// is the whole VHS look. .pixellate(x, y) quantizes position, so a cell count
// paired with an absurd vertical one is a horizontal-only bandwidth limit —
// 4000 cells tall is finer than the screen, i.e. a no-op.
const LUMA_CELLS = 320
const CHROMA_CELLS = 44

const snow = noise({ freq: 320, octaves: 1, speed: 55 })
  .blur([5, 0])      // tape noise is 1-D, read along the line
  .contrast(3)

const chromaNoise = noise({ channels: 3, freq: 16, speed: 7 })
  .transform({ scale: [2.2, 1] })

const chroma = recorded
  .blur([6, 2])
  .pixellate(CHROMA_CELLS, 4000)
  .blur([5, 1])
  .translate(0.005, 0)     // chroma is decoded late, so colour lags right
  .comp(chromaNoise, 'add', 0.3)

const luma = recorded
  .saturation(0)
  .blur(1)
  .pixellate(LUMA_CELLS, 4000)
  .comp(s => s.edge({ strength: 0.7, spread: 3 }), 'add', 0.3)   // deck sharpening
  .comp(snow, 'add', 0.07)

// 'luminosity' keeps the base's colour and takes the layer's brightness: flat
// areas survive untouched, edges get one image's colour on the other's luma
const composite = chroma.comp(luma, 'luminosity')

// --- playback ---

// one jitter value per scanline: collapsing x leaves a single column stretched
// across the frame, and pinning G to the neutral 0.5 keeps displace() sideways
const lineJitter = noise({ channels: 2, freq: 140, speed: 30 })
  .transform({ scale: [600, 1] })
  .mul([1, 0, 0])
  .add([0, 0.5, 0])

const headSwitch = ramp({ angle: -Math.PI / 2 }).threshold(0.976, { soft: 0.005 })
const flagging = ramp({ angle: Math.PI / 2 }).threshold(0.978, { soft: 0.04 })

// a wrapping phase is a sawtooth that scrolls; thresholding it is a drifting band
const tracking = ramp({ angle: Math.PI / 2, period: 1, phase: t => -t * 0.07 })
  .threshold(0.94, { soft: 0.05 })

const dropouts = noise({ freq: 240, octaves: 1, speed: 9 })
  .transform({ scale: [14, 1] })
  .threshold(0.93, { soft: 0.02 })
  .blur([3, 0])

const played = composite
  .displace(lineJitter, { amount: 0.006 })
  .translate(t => Math.sin(t * 0.7) * 0.002 + Math.sin(t * 5.3) * 0.0008, 0)   // wow and flutter
  .mask(flagging, s => s.translate(t => 0.012 + 0.008 * Math.sin(t * 2.1), 0))
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

// a triangle wave up the frame = 240 soft stripes
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

// more to try:
// CHROMA_CELLS = 16                                  // a fourth-generation dub
// tracking: .threshold(0.86, { soft: 0.12 })         // a fat, unmissable tracking band
// composite.comp(ramp({ type: 'angular' }), 'color', 0.5)   // colour lock, lost
