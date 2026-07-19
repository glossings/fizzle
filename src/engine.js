import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderTops } from './tops.js';
import { AudioEngine } from './audio.js';

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

    this.bpm = 120;                 // tempo for beat(), set in the sidebar

    this.audio = null;              // AudioEngine, created lazily by audio()
    this.audioDeviceId = undefined; // undefined = system default input
    this.audioEnabled = true;       // false = 'off' in the sidebar
    this.videos = new Map();        // camera captures by name, shared across re-runs

    this.cameraProgrammed = false;  // a camera(fn...) call disables orbit controls
    this.topNodes = [];             // TOP graph nodes from the current sketch
    this.topOutput = null;          // TOP chain marked with .out(), if any
    this.topBuffers = new Map();    // name -> node published with .out(name)
    this.geoLayers = new Map();     // name -> three.js layer bit, geometry .out(name)
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
      this.audio?.update();
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

  // Lazy audio capture: created/started on first use (audio() in a
  // sketch, or enabling passthrough in the sidebar). No-op while disabled.
  ensureAudio() {
    const ae = (this.audio ??= new AudioEngine());
    if (this.audioEnabled && !ae.running && !ae.starting) ae.start(this.audioDeviceId);
    return ae;
  }

  // Audio input device, from the sidebar: a deviceId string, undefined for
  // the system default, or null to disable audio entirely. The capture
  // (re)starts immediately if audio is already live; otherwise the next
  // audio() call starts it.
  setAudioDevice(deviceId) {
    this.audioEnabled = deviceId !== null;
    this.audioDeviceId = deviceId ?? undefined;
    if (!this.audioEnabled) this.audio?.stop();
    else if (this.audio) this.audio.start(this.audioDeviceId);
  }

  // Passthrough output device: null = off, 'default', or a deviceId.
  // Selecting one starts capture if it isn't running yet.
  setAudioOutput(deviceId) {
    if (deviceId == null) this.audio?.setOutput(null);
    else this.ensureAudio().setOutput(deviceId);
  }

  // Camera capture for the video() TOP. name matches a camera label
  // (case-insensitive substring); no name = default camera. Streams are
  // created once and survive re-runs, so livecoding doesn't re-prompt.
  ensureVideo(name) {
    const key = name ?? '';
    let v = this.videos.get(key);
    if (v) return v;
    v = { texture: null };
    this.videos.set(key, v);
    (async () => {
      try {
        let deviceId;
        if (name) {
          const find = (devs) => devs.find(
            (d) => d.kind === 'videoinput' && d.label.toLowerCase().includes(name.toLowerCase())
          );
          let dev = find(await navigator.mediaDevices.enumerateDevices());
          if (!dev) {
            // labels are blank before camera permission — grab the default
            // camera once to unlock them, then retry the match
            const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
            tmp.getTracks().forEach((t) => t.stop());
            dev = find(await navigator.mediaDevices.enumerateDevices());
          }
          if (dev) deviceId = dev.deviceId;
          else console.warn(`td-livecode: video: no camera matching "${name}" — using default`);
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        const el = document.createElement('video');
        el.srcObject = stream;
        el.muted = true;
        el.playsInline = true;
        await el.play();
        v.texture = new THREE.VideoTexture(el);
      } catch (e) {
        console.warn(`td-livecode: video: ${e.message ?? e}`);
      }
    })();
    return v;
  }

  // Named geometry layers: geometry .out('name') moves the object onto its
  // own three.js layer (invisible to the display camera), and input('name')
  // renders just that layer as a TOP. Layer 0 is the naked-.out() scene.
  geoLayer(name) {
    let bit = this.geoLayers.get(name);
    if (bit == null) {
      bit = this.geoLayers.size + 1;
      if (bit > 31) throw new Error('out: more than 31 named geometry layers');
      this.geoLayers.set(name, bit);
    }
    return bit;
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
    this.topBuffers.clear();
    this.geoLayers.clear();

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
