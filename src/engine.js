import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderTops } from './tops.js';

// The engine owns the renderer/scene/camera and a "patch" — everything the
// current sketch created. Re-running a sketch disposes the old patch and
// builds a new one, Hydra-style.

export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0f);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
    this.camera.position.set(0, 2, 8);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.clock = new THREE.Clock();
    this.time = 0;        // sketch time; frozen while paused so resume doesn't jump
    this.paused = false;
    this.frames = 0;      // total frames rendered, for the fps readout
    this.quality = 1;
    this.patch = [];      // objects added by the current sketch
    this.updaters = [];   // fns called every frame with (t, dt)

    this.cameraProgrammed = false;  // a camera(fn...) call disables orbit controls
    this.topNodes = [];             // TOP graph nodes from the current sketch
    this.topOutput = null;          // TOP chain marked with .out(), if any
    this.topFbEnds = new Map();     // name -> node tagged .fbend(name)
    this._topState = {};            // persistent RTs/quad (feedback survives re-runs)

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setQuality(scale) {
    this.quality = scale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    this.resize();
  }

  tick() {
    this.frames++;
    const now = this.clock.getElapsedTime();
    const dt = now - (this._lastT ?? now);
    this._lastT = now;
    if (!this.paused) {
      this.time += dt;
      for (const fn of this.updaters) {
        try { fn(this.time, dt); } catch (e) { /* keep rendering even if one updater throws */ }
      }
    }
    // camera stays interactive while paused (unless the sketch drives it)
    if (!this.cameraProgrammed) this.controls.update();
    if (this.topOutput) {
      renderTops(this);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  add(object3d, updater) {
    this.scene.add(object3d);
    this.patch.push(object3d);
    if (updater) this.updaters.push(updater);
  }

  clearPatch() {
    for (const obj of this.patch) {
      this.scene.remove(obj);
      obj.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    this.patch = [];
    this.updaters = [];
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x0a0a0f);

    for (const node of this.topNodes) node.dispose();
    this.topNodes = [];
    this.topOutput = null;
    this.topFbEnds.clear();

    this.cameraProgrammed = false;
    this.controls.enabled = true;
  }

  // Evaluate sketch code with the livecoding API in scope. Returns an error
  // (or null) instead of throwing so the editor can show it inline.
  run(code, api) {
    this.clearPatch();
    const names = Object.keys(api);
    const values = names.map((n) => api[n]);
    try {
      new Function(...names, `"use strict";\n${code}`)(...values);
      // settle the new patch at current sketch time (matters when paused)
      for (const fn of this.updaters) {
        try { fn(this.time, 0); } catch (e) { /* surfaced on next frame if persistent */ }
      }
      return null;
    } catch (err) {
      this.clearPatch();
      return err;
    }
  }
}
