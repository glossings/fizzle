/* --- desktop ---
  fizzle

  ctrl+enter to run · ctrl+p for settings and hotkeys
  F1 opens the visuals in their own window, for a projector
*/
/* --- touch ---
  fizzle

    ▶  play / pause        ↻  run        ⟨/⟩  hide the code

  with the code up, one finger scrolls it and two fingers zoom in on it.
  hide the code and the screen is the camera: drag to orbit, pinch to zoom.
*/

bg('#0b0d13')

directional({ color: '#fff6e8', intensity: 1.3 }).out()
point({ color: '#5160d2', intensity: 25 }).position(-5, -1, 4).out()

sphere({ radius: 1.6 })
  .noise({ amp: t => 0.4 * Math.sin(t * 0.5) ** 2 })
  .material({ color: '#4fd1c5', roughness: 0.3, metalness: 0.35 })
  .out()

const fizz = text("fizzle.", { size: 50 })
scene()
  .displace(fizz, { mid: 0, amount: 0.05 })
  .comp(fizz.edge(), "add", 0.3)
  .chroma()
  .out()
