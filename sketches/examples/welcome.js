/* --- desktop ---
  fizzle

    ctrl+enter  run                ctrl+h   hide code
    ctrl+.      pause              ctrl+m   hide code here
    ctrl+r      restart media      ctrl+p   sidebar
                                   F1       projector window

  F1 opens the visuals in a second window on their own — that's the one to
  drag to a projector, leaving the code on your laptop.

  every numeric param also takes a function of time:  t => ...
  click any color swatch (or type #) for a color picker
*/
/* --- touch ---
  fizzle

    ▶  play / pause        ↻  run        ⟨/⟩  hide the code

  with the code up the screen is the editor: one finger scrolls it, two
  fingers zoom in on it. hide the code and the screen is the camera
  instead — drag to orbit, pinch to zoom.

  every numeric param also takes a function of time:  t => ...
  tap any color swatch (or type #) for a color picker
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
