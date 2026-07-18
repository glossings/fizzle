import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.patch = [];      // objects added by the current sketch
    this.updaters = [];   // fns called every frame with (t, dt)

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

  tick() {
    const t = this.clock.getElapsedTime();
    const dt = t - (this._lastT ?? t);
    this._lastT = t;
    for (const fn of this.updaters) {
      try { fn(t, dt); } catch (e) { /* keep rendering even if one updater throws */ }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
  }

  // Evaluate sketch code with the livecoding API in scope. Returns an error
  // (or null) instead of throwing so the editor can show it inline.
  run(code, api) {
    this.clearPatch();
    const names = Object.keys(api);
    const values = names.map((n) => api[n]);
    try {
      new Function(...names, `"use strict";\n${code}`)(...values);
      return null;
    } catch (err) {
      this.clearPatch();
      return err;
    }
  }
}
