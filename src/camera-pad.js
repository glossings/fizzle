// Driving the camera with a game controller, in the two ways a pad is asked to.
//
// `pad` is the mouse under another shape: two angles and a radius, fed to the
// orbit rig the way a drag feeds it, so the damping and the mouse keep working
// alongside it. `fly` can't go through OrbitControls at all — flying is a
// position that accumulates, and a rig built around a target to circle has
// nowhere to put that — so it takes the camera over and leaves the target
// where the view was pointed, for whatever runs next.
//
// Both are updaters, so both move on sketch time: paused stays parked.

import * as THREE from 'three';
import { gamepadHandle } from './control.js';

// A frame at 4fps shouldn't teleport the camera a whole second's worth — the
// tab was in the background, not the stick held down that long.
const step = (dt) => Math.min(dt, 0.1);

// Pixels of pan per second at full deflection, before `speed`. OrbitControls
// measures a pan in screen pixels, so this is the drag it's being told about.
const PAN_PX = 1000;

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

function orbitPad(engine, g, o) {
  const { camera, controls } = engine;
  const speed = o.speed ?? 0.7;
  const look = o.look ?? 1.6;
  const dpad = ['up', 'down', 'left', 'right'].map((n) => g.btn(n));
  const bumpers = ['lb', 'rb'].map((n) => g.btn(n));
  const ray = new THREE.Vector3();
  // Where recenter puts the target back: the point the call named, not
  // wherever a pan has since walked it. A button that means "the middle of the
  // scene" has to keep meaning that however lost you got.
  const home = new THREE.Vector3(...(o.target ?? [0, 0, 0]));
  const shift = new THREE.Vector3();
  const recenter = o.recenter === false ? null : g.btn(o.recenter ?? 'r3');
  return (t, dt) => {
    const d = step(dt);
    if (!d) return;
    // right stick: the two angles, what a click-drag turns
    const rx = g.rx(t), ry = g.ry(t);
    if (rx) controls.rotateLeft(rx * look * d);
    if (ry) controls.rotateUp(-ry * look * d);
    // Left stick y: the radius, up for closer. Walked by a fraction per second
    // rather than a number of units, so the approach slows as it arrives.
    //
    // Written as a distance rather than handed to dollyIn/dollyOut, which
    // multiply into a radius clamped at minDistance = 0: a radius that reaches
    // the target can never leave it (0 × anything is 0), and everything else
    // goes with it, since a pan is measured in target distance and a rotation
    // about the point you're sitting on shows nothing. Hence the floor here.
    const ly = g.ly(t);
    if (ly) {
      ray.subVectors(camera.position, controls.target);
      const dist = ray.length();
      // nothing to walk along if the camera is already on its target — back
      // out the way it faces, so even a sketch that parked it there recovers
      if (dist < 1e-4) ray.set(0, 0, 1).applyQuaternion(camera.quaternion);
      const want = Math.min(controls.maxDistance,
        Math.max(controls.minDistance || 0.05, Math.max(dist, 1e-4) * Math.exp(-ly * speed * d)));
      camera.position.copy(controls.target).addScaledVector(ray.normalize(), want);
    }
    // Pan: triggers rise and fall, bumpers go left and right, d-pad does both.
    // Summed rather than chosen between, so no pad has to be identified — a
    // controller without shoulders reads 0 there and its d-pad carries the
    // whole job, and one with them gets the triggers' analog travel for free.
    // Held together they'd be double speed, hence the clamp.
    //
    // Not on the left stick, either half of it: a stick pushed "up" is never
    // quite vertical, so pan sharing it with the in-and-out would walk the
    // target off center every time you moved — the orbit going crooked with
    // nothing on screen to say why.
    const [up, down, left, right] = dpad;
    const [lb, rb] = bumpers;
    const rate = PAN_PX * speed * d;
    const px = clamp1(rb(t) - lb(t) + right(t) - left(t)) * rate;
    const py = clamp1(g.rt(t) - g.lt(t) + up(t) - down(t)) * rate;
    if (px || py) controls.pan(-px, py);
    // Undo the pans by moving the camera with the target, which leaves the
    // angles and the distance exactly as they were — a recenter that also
    // swung the view would be a second thing to recover from.
    if (recenter?.(t)) {
      shift.subVectors(home, controls.target);
      controls.target.copy(home);
      camera.position.add(shift);
    }
  };
}

function flyPad(engine, g, o) {
  const { camera, controls } = engine;
  const speed = o.speed ?? 5;
  const look = o.look ?? 0.9;
  const lift = o.lift ?? 3;       // the triggers, slower than the travel by default
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let started = false;
  return (t, dt) => {
    // Picked up from wherever the camera already is, so a re-run continues the
    // flight instead of restarting it, and orbiting first then flying carries
    // the view across.
    if (!started) {
      started = true;
      pos.copy(camera.position);
      e.setFromQuaternion(camera.quaternion);
    }
    const d = step(dt);
    e.y -= g.rx(t) * look * d;
    // straight up is where a yaw stops meaning anything, so stop short of it
    e.x = Math.max(-1.5, Math.min(1.5, e.x + g.ry(t) * look * d));
    e.z = 0;
    camera.quaternion.setFromEuler(e);
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    // forward carries the pitch, so you fly where you look; the triggers stay
    // in world space, since "up" is what you reach for to get out of a mess
    pos.addScaledVector(fwd, g.ly(t) * speed * d);
    pos.addScaledVector(right, g.lx(t) * speed * d);
    pos.y += (g.rt(t) - g.lt(t)) * lift * d;
    camera.position.copy(pos);
    // a target to orbit once the flying stops: a few units down the view
    controls.target.copy(pos).addScaledVector(fwd, 5);
  };
}

// o: { pad, fly, speed, look, lift, recenter, deadzone } as camera() got them.
// The two modes keep their own defaults: flying wants a slower turn than a
// rig you're spinning something on, since the whole view swings with it.
export function cameraPad(engine, o = {}) {
  const g = gamepadHandle(typeof o.pad === 'number' ? o.pad : undefined, { deadzone: o.deadzone ?? 0.12 });
  if (!o.fly) return orbitPad(engine, g, o);
  engine.cameraProgrammed = true;
  engine.controls.enabled = false;
  return flyPad(engine, g, o);
}
