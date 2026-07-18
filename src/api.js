import * as THREE from 'three';
import { applyNoise } from './noise.js';
import { TopOp } from './tops.js';

// Chainable operator API, synth-flavored:
//
//   sphere({ radius: 1 })
//     .pos(0, t => Math.sin(t), 0)
//     .scale(1, 2, 1)
//     .rotate(0, t => t * 0.3, 0)
//     .noise({ amp: 0.4, freq: 2, octaves: 4, speed: 0.5 })
//     .instance(50, (i, n, t) => ({ pos: [i - n / 2, 0, 0] }))
//     .material({ color: '#4fd1c5', roughness: 0.3 })
//     .out()
//
// Every numeric parameter also accepts a function of time, evaluated per
// frame, so animation falls out of the same syntax.

const resolve = (v, t) => (typeof v === 'function' ? v(t) : v);
const resolve3 = (v, t) => v.map((c) => resolve(c, t));

function buildGeometry(type, o = {}) {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(o.radius ?? 1, o.res ?? 64, Math.ceil((o.res ?? 64) / 2));
    case 'box': {
      const r = o.res ?? 24;
      return new THREE.BoxGeometry(o.width ?? 1, o.height ?? 1, o.depth ?? 1, r, r, r);
    }
    case 'plane':
      return new THREE.PlaneGeometry(o.width ?? 10, o.height ?? 10, o.res ?? 128, o.res ?? 128);
    case 'torus':
      return new THREE.TorusGeometry(o.radius ?? 1, o.tube ?? 0.35, o.res ?? 48, (o.res ?? 48) * 2);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(o.radius ?? 1, o.tube ?? 0.3, (o.res ?? 64) * 2, o.res ?? 64, o.p ?? 2, o.q ?? 3);
    case 'cylinder':
      return new THREE.CylinderGeometry(o.radiusTop ?? 0.5, o.radiusBottom ?? 0.5, o.height ?? 1.5, o.res ?? 48, o.res ?? 48);
    case 'icosa':
      return new THREE.IcosahedronGeometry(o.radius ?? 1, o.detail ?? 8);
    default:
      throw new Error(`unknown geometry: ${type}`);
  }
}

class GeoOp {
  constructor(engine, type, opts) {
    this.engine = engine;
    this.type = type;
    this.opts = opts ?? {};
    this._pos = [0, 0, 0];
    this._rot = [0, 0, 0];
    this._scale = [1, 1, 1];
    this._noise = null;
    this._instance = null;
    this._material = {};
  }

  pos(x = 0, y = 0, z = 0) { this._pos = [x, y, z]; return this; }
  rotate(x = 0, y = 0, z = 0) { this._rot = [x, y, z]; return this; }
  scale(x = 1, y, z) { this._scale = [x, y ?? x, z ?? x]; return this; }

  // amp: displacement amount · freq: spatial frequency · octaves: fbm
  // harmonics (1–8) · lacunarity/gain: per-octave freq/amp multipliers ·
  // speed: how fast the field evolves over time
  noise(o = {}) {
    this._noise = {
      amp: o.amp ?? 0.3,
      freq: o.freq ?? 1.5,
      octaves: o.octaves ?? 3,
      lacunarity: o.lacunarity ?? 2,
      gain: o.gain ?? 0.5,
      speed: o.speed ?? 0.3,
    };
    return this;
  }

  // instance(count, fn) — fn(i, count, t) returns { pos, rot, scale } for
  // each copy and is re-evaluated every frame, so instances can animate.
  instance(count, fn) {
    this._instance = { count, fn: fn ?? ((i) => ({ pos: [i * 2, 0, 0] })) };
    return this;
  }

  material(o = {}) { Object.assign(this._material, o); return this; }
  color(c) { this._material.color = c; return this; }

  out() {
    const geometry = buildGeometry(this.type, this.opts);
    const m = this._material;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color ?? '#8899ff'),
      roughness: m.roughness ?? 0.5,
      metalness: m.metalness ?? 0.1,
      flatShading: m.flatShading ?? false,
      wireframe: m.wireframe ?? false,
      side: this.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (m.emissive) {
      material.emissive = new THREE.Color(m.emissive);
      material.emissiveIntensity = m.emissiveIntensity ?? 1;
    }

    let noiseUniforms = null;
    if (this._noise) {
      noiseUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uFreq: { value: 0 },
        uOctaves: { value: 0 },
        uLacunarity: { value: 0 },
        uGain: { value: 0 },
        uSpeed: { value: 0 },
      };
      applyNoise(material, noiseUniforms);
    }

    let mesh;
    const inst = this._instance;
    if (inst) {
      mesh = new THREE.InstancedMesh(geometry, material, inst.count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }

    const dummy = new THREE.Object3D();
    const updater = (t) => {
      mesh.position.set(...resolve3(this._pos, t));
      mesh.rotation.set(...resolve3(this._rot, t));
      mesh.scale.set(...resolve3(this._scale, t));

      if (noiseUniforms) {
        const n = this._noise;
        noiseUniforms.uTime.value = t;
        noiseUniforms.uAmp.value = resolve(n.amp, t);
        noiseUniforms.uFreq.value = resolve(n.freq, t);
        noiseUniforms.uOctaves.value = Math.min(8, Math.max(1, resolve(n.octaves, t)));
        noiseUniforms.uLacunarity.value = resolve(n.lacunarity, t);
        noiseUniforms.uGain.value = resolve(n.gain, t);
        noiseUniforms.uSpeed.value = resolve(n.speed, t);
      }

      if (inst) {
        for (let i = 0; i < inst.count; i++) {
          const d = inst.fn(i, inst.count, t) ?? {};
          dummy.position.set(...(d.pos ?? [0, 0, 0]));
          const r = d.rot ?? [0, 0, 0];
          dummy.rotation.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0);
          const s = d.scale ?? 1;
          if (Array.isArray(s)) dummy.scale.set(...s); else dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    };

    updater(0);
    this.engine.add(mesh, updater);
    return this;
  }
}

class LightOp {
  constructor(engine, light) {
    this.engine = engine;
    this.light = light;
    this._pos = [3, 4, 2];
  }
  pos(x, y, z) { this._pos = [x, y, z]; return this; }
  out() {
    const updater = (t) => this.light.position.set(...resolve3(this._pos, t));
    updater(0);
    this.engine.add(this.light, updater);
    return this;
  }
}

export function makeApi(engine) {
  const geo = (type) => (opts) => new GeoOp(engine, type, opts);

  const api = {
    sphere: geo('sphere'),
    box: geo('box'),
    plane: geo('plane'),
    torus: geo('torus'),
    torusKnot: geo('torusKnot'),
    cylinder: geo('cylinder'),
    icosa: geo('icosa'),

    ambient(intensity = 0.3, color = 0xffffff) {
      engine.add(new THREE.AmbientLight(color, intensity));
    },
    directional(o = {}) {
      return new LightOp(engine, new THREE.DirectionalLight(o.color ?? 0xffffff, o.intensity ?? 1.5));
    },
    point(o = {}) {
      return new LightOp(engine, new THREE.PointLight(o.color ?? 0xffffff, o.intensity ?? 20, o.distance ?? 0, o.decay ?? 2));
    },
    hemi(o = {}) {
      return new LightOp(engine, new THREE.HemisphereLight(o.sky ?? 0x8899ff, o.ground ?? 0x332211, o.intensity ?? 0.6));
    },

    // static args: place the camera, orbit controls stay live.
    // any function arg: the sketch drives the camera and orbiting is disabled
    // until the next re-run without a programmed camera.
    camera(x = 0, y = 2, z = 8, target = [0, 0, 0]) {
      const dynamic = [x, y, z, ...target].some((v) => typeof v === 'function');
      if (!dynamic) {
        engine.camera.position.set(x, y, z);
        engine.controls.target.set(...target);
        return;
      }
      engine.cameraProgrammed = true;
      engine.controls.enabled = false;
      engine.updaters.push((t) => {
        engine.camera.position.set(resolve(x, t), resolve(y, t), resolve(z, t));
        const tg = resolve3(target, t);
        engine.controls.target.set(...tg);
        engine.camera.lookAt(...tg);
      });
    },
    bg(color) { engine.scene.background = new THREE.Color(color); },
    fog(color = 0x0a0a0f, near = 5, far = 30) {
      engine.scene.fog = new THREE.Fog(color, near, far);
    },

    // TOPs — texture operators (see tops.js). Chains render only with .out()
    scene: () => new TopOp(engine, 'scene'),
    feedback: () => new TopOp(engine, 'feedback'),
    ramp: (o) => new TopOp(engine, 'ramp', o ?? {}),
    circle: (o) => new TopOp(engine, 'circle', o ?? {}),
    noise: (o) => new TopOp(engine, 'noiseGen', o ?? {}),

    // escape hatches
    THREE,
    onFrame(fn) { engine.updaters.push(fn); },
  };

  return api;
}
