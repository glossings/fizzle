import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderTextures } from './textures.js';
import { AudioEngine } from './audio.js';
import { mediaGet, mediaList } from './media.js';
import { loadModelGeometry } from './models.js';
import { classifySet, IMAGE_RE, HDRI_RE } from './pbr.js';
import { warn, resetWarnings } from './warn.js';

// The engine owns the renderer/scene/camera and a "patch" — everything the
// current sketch created. Re-running a sketch disposes the old patch and
// builds a new one.

export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Always on: three only compiles the shadow path into a material once some
    // light is actually casting, so a sketch with no shadow: light pays nothing
    // for this. Type is three's PCF default — five Vogel-disk taps whose spread
    // is the light's shadow radius, which is what makes `soft` a real dial.
    this.renderer.shadowMap.enabled = true;

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
    this.resolution = null; // [w, h] from resolution(); null = fill the window
    this._resKey = '';      // what resize() last applied, so a re-run is a no-op
    this.patch = [];      // objects added by the current sketch
    this.updaters = [];   // fns called every frame with (t, dt)
    this.patchGen = 0;    // bumped per run, so a slow load can tell it's stale

    this.bpm = 120;                 // tempo for beat(), set in the sidebar

    this.audio = null;              // AudioEngine, created lazily by audio()
    this.audios = new Map();        // named audio captures, shared across re-runs
    this.audioDeviceId = undefined; // undefined = system default input
    this.audioEnabled = true;       // false = 'off' in the sidebar
    this.videos = new Map();        // camera captures by name, shared across re-runs
    this.media = new Map();         // imported media files (kind:name), shared across re-runs
    this.models = new Map();        // parsed .obj/.fbx geometry, shared across re-runs
    this.pointSets = new Map();     // shape -> sampled surface points, geo.sample()
    this.textures = new Map();      // decoded material maps by filename, shared across re-runs
    this.pbrSets = new Map();       // prefix -> { slot: filename }, shared across re-runs
    this.hdris = new Map();         // loaded HDRIs + their prefiltered env, shared across re-runs
    this.pendingPick = null;        // an empty videofile()/... asked for a file picker

    this.cameraProgrammed = false;     // a camera(fn...) call disables orbit controls
    this.cameraTouched = false;        // this run called camera() at all
    // where orbiting last left the camera. A sketch that drives the camera
    // moves it out of here; the next sketch that doesn't gets it back rather
    // than opening wherever that one parked.
    this.orbitPose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.textureNodes = [];            // texture graph nodes from the current sketch
    this.textureOutput = null;         // texture chain marked with .out(), if any
    this.textureBuffers = new Map();   // name -> node published with .out(name)
    this.textureMaps = [];             // texture chains bound to a material map slot
    this.geoLayers = new Map();        // name -> three.js layer bit, geometry .out(name)
    this._textureState = {};           // persistent RTs/quad (feedback survives re-runs)

    window.addEventListener('resize', () => this.resize());
    this.resize();

    // a throw escaping the loop callback would end the loop for good (three
    // only schedules the next frame after the callback returns)
    this.renderer.setAnimationLoop(() => {
      try { this.tick(); } catch (e) { warn(e.message ?? String(e)); }
    });
  }

  resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const canvas = this.renderer.domElement;
    if (this.resolution) {
      // Render at exactly the size asked for and letterbox the *element* into
      // the window — the bars are page background, not pixels, so the drawing
      // buffer the projector mirrors is pure image at the target shape.
      const [w, h] = this.resolution;
      this.renderer.setPixelRatio(this.quality);
      this.renderer.setSize(w, h, false); // false: the style is ours below
      const fit = Math.min(vw / w, vh / h);
      canvas.style.width = `${Math.round(w * fit)}px`;
      canvas.style.height = `${Math.round(h * fit)}px`;
      canvas.style.margin = 'auto'; // with inset: 0, that centers it
      this.camera.aspect = w / h;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.quality);
      this.renderer.setSize(vw, vh);
      canvas.style.margin = '';
      this.camera.aspect = vw / vh;
    }
    this.camera.updateProjectionMatrix();
  }

  // A sketch's resolution() — or the absence of one, after clearPatch reset it
  // — only lands once the whole run has had its say, so a re-run at the same
  // size never touches the renderer and never churns the texture buffers.
  syncResolution() {
    const key = this.resolution?.join('x') ?? '';
    if (key === this._resKey) return;
    this._resKey = key;
    this.resize();
    window.dispatchEvent(new CustomEvent('fizzle-resolution', { detail: this.resolution }));
  }

  setQuality(scale) {
    this.quality = scale;
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
      for (const ae of this.audios.values()) ae.update();
      for (const m of this.media.values()) m.ae?.update();
      for (const fn of this.updaters) {
        // keep rendering even if one updater throws, but say so
        try { fn(this.time, dt); } catch (e) { warn(e.message ?? String(e)); }
      }
    }
    // camera stays interactive while paused (unless the sketch drives it)
    if (!this.cameraProgrammed) this.controls.update();
    // textures feeding a material map need the graph running even with no .out()
    if (this.textureOutput || this.textureMaps.length) {
      try {
        renderTextures(this);
      } catch (e) {
        // a broken texture graph shouldn't freeze the output — fall back to the
        // plain 3D render so the scene keeps playing under the warning
        warn(e.message ?? String(e));
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  togglePause() {
    this.paused = !this.paused;
    // media files freeze with the sketch (camera streams keep running)
    for (const m of this.media.values()) {
      if (this.paused) m.el?.pause?.();
      else if (m.el?.play) m.el.play().catch(() => {});
    }
    return this.paused;
  }

  add(object3d, updater) {
    this.scene.add(object3d);
    this.patch.push(object3d);
    if (updater) this.updaters.push(updater);
  }

  // Lazy audio capture: created/started on first use (audio() in a
  // sketch, or enabling passthrough in the sidebar). No-op while disabled.
  // A name picks an input device by label (case-insensitive substring),
  // independent of the sidebar's default-device selection; named captures
  // survive re-runs like video streams do.
  ensureAudio(name) {
    if (name == null) {
      const ae = (this.audio ??= new AudioEngine());
      if (this.audioEnabled && !ae.running && !ae.starting) ae.start(this.audioDeviceId);
      return ae;
    }
    const key = String(name).toLowerCase();
    let ae = this.audios.get(key);
    if (!ae) {
      ae = new AudioEngine();
      this.audios.set(key, ae);
    }
    if (this.audioEnabled && !ae.running && !ae.starting) {
      ae.starting = true; // hold the flag while the label resolves to a device
      this.resolveAudioInput(key).then((id) => {
        ae.starting = false;
        ae.start(id);
      });
    }
    return ae;
  }

  // label -> deviceId (undefined = system default), with the same permission
  // dance as video: labels are blank until mic permission is granted once
  async resolveAudioInput(name) {
    const mics = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    try {
      let devs = await mics();
      const find = () => devs.find((d) => d.label.toLowerCase().includes(name));
      let dev = find();
      if (!dev && !devs.some((d) => d.label)) {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        devs = await mics();
        dev = find();
      }
      if (dev) return dev.deviceId;
      const labels = devs.map((d) => `"${d.label}"`).join(', ') || 'none found';
      warn(`audio: no input matching "${name}" — using default. Inputs: ${labels}`);
    } catch (e) {
      warn(`audio: ${e.message ?? e}`);
    }
    return undefined;
  }

  // Audio input device, from the sidebar: a deviceId string, undefined for
  // the system default, or null to disable audio entirely. The capture
  // (re)starts immediately if audio is already live; otherwise the next
  // audio() call starts it.
  setAudioDevice(deviceId) {
    this.audioEnabled = deviceId !== null;
    this.audioDeviceId = deviceId ?? undefined;
    if (!this.audioEnabled) {
      this.audio?.stop();
      for (const ae of this.audios.values()) ae.stop();
    } else if (this.audio) {
      this.audio.start(this.audioDeviceId);
    }
  }

  // Passthrough output device: null = off, 'default', or a deviceId.
  // Selecting one starts capture if it isn't running yet.
  setAudioOutput(deviceId) {
    if (deviceId == null) this.audio?.setOutput(null);
    else this.ensureAudio().setOutput(deviceId);
  }

  // Camera capture for the video() texture. name matches a camera label
  // (case-insensitive substring); no name = default camera. Streams are
  // created once and survive re-runs, so livecoding doesn't re-prompt.
  ensureVideo(name) {
    const key = name ?? '';
    let v = this.videos.get(key);
    if (v) return v;
    v = { texture: null };
    this.videos.set(key, v);
    const cams = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const labels = (devs) => devs.map((d) => `"${d.label}"`).join(', ') || 'none found';
    (async () => {
      try {
        let deviceId;
        let devs = await cams();
        if (name) {
          const find = () => devs.find((d) => d.label.toLowerCase().includes(name.toLowerCase()));
          let dev = find();
          if (!dev) {
            // labels are blank before camera permission — grab the default
            // camera once to unlock them, then retry the match
            const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
            tmp.getTracks().forEach((t) => t.stop());
            devs = await cams();
            dev = find();
          }
          if (dev) deviceId = dev.deviceId;
          else warn(`video: no camera matching "${name}" — using default. Sources: ${labels(devs)}`);
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        // labels unlock once a stream is live; refresh so the listing is useful
        if (!devs.some((d) => d.label)) devs = await cams();
        console.info(`fizzle: video: using "${stream.getVideoTracks()[0]?.label}". Sources: ${labels(devs)}`);
        const el = document.createElement('video');
        el.srcObject = stream;
        el.muted = true;
        el.playsInline = true;
        await el.play();
        v.texture = new THREE.VideoTexture(el);
      } catch (e) {
        warn(`video: ${e.message ?? e}`);
      }
    })();
    return v;
  }

  // Imported media file (dropped into the window or picked via an empty
  // videofile()/imagefile()/audiofile()) by name — exact filename, else
  // case-insensitive substring. Entries persist across re-runs like camera
  // streams, so a playing video survives ctrl+enter; restartMedia() rewinds.
  ensureMedia(kind, name) {
    const key = `${kind}:${String(name).toLowerCase()}`;
    let m = this.media.get(key);
    if (m) return m;
    m = { kind, name: String(name), el: null, texture: null, ae: null };
    // the analyser exists before the blob loads so audiofile() signals can
    // bind to it synchronously; it reports 0 until startMedia wires it up
    if (kind === 'audio') m.ae = new AudioEngine();
    this.media.set(key, m);
    (async () => {
      try {
        const rec = await mediaGet(name);
        if (!rec) {
          m.missing = true; // retried on the next run (clearPatch drops it)
          const names = (await mediaList()).map((n) => `"${n}"`).join(', ');
          warn(
            `${kind}file: nothing imported matching "${name}" — drop a file into the window to import it. Imported: ${names || 'none'}`
          );
          return;
        }
        const url = URL.createObjectURL(rec.blob);
        if (kind === 'image') {
          const img = new Image();
          img.src = url;
          await img.decode();
          m.el = img;
          m.texture = new THREE.Texture(img);
          m.texture.needsUpdate = true;
        } else {
          const el = document.createElement(kind === 'video' ? 'video' : 'audio');
          el.src = url;
          el.loop = true;
          if (kind === 'video') {
            el.muted = true;
            el.playsInline = true;
            m.texture = new THREE.VideoTexture(el);
          } else {
            m.ae.startMedia(el);
          }
          m.el = el;
          // autoplay can be blocked before the page's first user gesture
          // (sketch auto-run on load) — retry on the next one
          if (!this.paused) {
            await el.play().catch(() => {
              const retry = () => { if (!this.paused && this.media.has(key)) el.play().catch(() => {}); };
              window.addEventListener('pointerdown', retry, { once: true });
              window.addEventListener('keydown', retry, { once: true });
            });
          }
        }
      } catch (e) {
        warn(`${kind}file "${name}": ${e.message ?? e}`);
      }
    })();
    return m;
  }

  // Imported .obj/.fbx geometry by name, matched like the media files. Parsing
  // an FBX is slow enough that it must not happen on every ctrl+enter, so the
  // merged geometry is cached here and survives re-runs; callers get a clone
  // (clearPatch disposes whatever the mesh holds). The cache key carries the
  // normalization options because those are baked into the vertices.
  // Returns { geometry, pending } — geometry is null until the parse lands,
  // pending resolves with the geometry (or null if it failed).
  ensureModel(name, o = {}) {
    const center = o.center !== false;
    // fit omitted = 2 (the default framing); fit: 0/false/null = file's own units
    const fit = o.fit === undefined ? 2 : Number(o.fit) || 0;
    const key = `${String(name).toLowerCase()}|${center}|${fit}`;
    let m = this.models.get(key);
    if (m) return m;
    m = { name: String(name), geometry: null, pending: null };
    this.models.set(key, m);
    m.pending = (async () => {
      try {
        const rec = await mediaGet(name, (n) => /\.(obj|fbx)$/i.test(n));
        if (!rec) {
          m.missing = true; // retried on the next run (clearPatch drops it)
          const names = (await mediaList()).filter((n) => /\.(obj|fbx)$/i.test(n));
          const listed = names.map((n) => `"${n}"`).join(', ');
          warn(
            `model: nothing imported matching "${name}" — drop an .obj/.fbx into the window to import it. Imported models: ${listed || 'none'}`
          );
          return null;
        }
        m.geometry = await loadModelGeometry(rec.blob, rec.name, { center, fit });
        return m.geometry;
      } catch (e) {
        m.missing = true; // a re-run retries — the file may have been re-dropped
        warn(`model "${name}": ${e.message ?? e}`);
        return null;
      }
    })();
    return m;
  }

  // An imported image as a material texture, by name (exact, else substring).
  // Decoded once and cached across re-runs — but callers get a *clone*, because
  // tiling and offset belong to the material using it, not to the file. three
  // keys GPU uploads by Texture.source, which clones share, so ten materials
  // tiling one image still cost one upload.
  //
  // Color space is the exception and so it keys the cache: a color map decodes
  // as sRGB while roughness/normal/height stay linear, and that difference is
  // baked into the upload's internal format — clones of one source can't
  // disagree about it. Using the same file for both is rare enough to be worth
  // a second decode when it happens.
  // Returns { texture, pending }; texture is null until the decode lands.
  ensureTexture(name, srgb = false) {
    const key = `${String(name).toLowerCase()}|${srgb}`;
    let t = this.textures.get(key);
    if (t) return t;
    t = { name: String(name), texture: null, pending: null };
    this.textures.set(key, t);
    t.pending = (async () => {
      try {
        const rec = await mediaGet(name, (n) => IMAGE_RE.test(n));
        if (!rec) {
          t.missing = true; // retried on the next run (clearPatch drops it)
          throw new Error(
            `nothing imported matching "${name}" — drop an image (or a material folder) into the window`
          );
        }
        const img = new Image();
        img.src = URL.createObjectURL(rec.blob);
        await img.decode();
        const tex = new THREE.Texture(img);
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
        t.texture = tex;
        return tex;
      } catch (e) {
        t.missing = true;
        warn(`material map "${name}": ${e.message ?? e}`);
        return null;
      }
    })();
    return t;
  }

  // The maps of one PBR material: every imported file whose name starts with
  // `prefix`, sorted into material slots by filename (see pbr.js). This is
  // what .material({ pbr: 'rock_2k' }) resolves — 'rock_2k' being either a
  // dropped folder or a Poly Haven download, both of which key their files
  // 'rock_2k/diff.jpg' style. Resolves to {} (with a warning) if nothing
  // matches, so a typo names itself instead of silently rendering untextured.
  ensurePbrSet(prefix) {
    const key = String(prefix).toLowerCase();
    let s = this.pbrSets.get(key);
    if (s) return s;
    s = { prefix: String(prefix), maps: null, pending: null };
    this.pbrSets.set(key, s);
    s.pending = (async () => {
      const all = await mediaList();
      // prefix-first (a folder or download), then substring, matching how
      // every other name lookup here behaves
      let names = all.filter((n) => n.toLowerCase().startsWith(key));
      if (!names.length) names = all.filter((n) => n.toLowerCase().includes(key));
      s.maps = classifySet(names);
      if (!Object.keys(s.maps).length) {
        s.missing = true;
        const sets = [...new Set(all.filter((n) => IMAGE_RE.test(n) && n.includes('/')).map((n) => n.slice(0, n.lastIndexOf('/'))))];
        warn(
          `material: no maps matching pbr: "${prefix}" — run an empty .material() to browse Poly Haven, or drop a folder of maps in. Imported sets: ${sets.map((n) => `"${n}"`).join(', ') || 'none'}`
        );
      }
      return s.maps;
    })();
    return s;
  }

  // An imported .hdr/.exr as image-based lighting. The equirect texture lights
  // the scene through a prefiltered (PMREM) cubemap and doubles as the visible
  // background; both are cached with the file, since prefiltering is far too
  // slow to redo on every ctrl+enter.
  // Returns { texture, env, pending } — null until the load lands.
  ensureHdri(name) {
    const key = String(name).toLowerCase();
    let h = this.hdris.get(key);
    if (h) return h;
    h = { name: String(name), texture: null, env: null, pending: null };
    this.hdris.set(key, h);
    h.pending = (async () => {
      try {
        const rec = await mediaGet(name, (n) => HDRI_RE.test(n));
        if (!rec) {
          h.missing = true;
          const names = (await mediaList()).filter((n) => HDRI_RE.test(n));
          throw new Error(
            `nothing imported matching "${name}" — run an empty hdri() to browse Poly Haven, or drop an .hdr/.exr in. Imported: ${names.map((n) => `"${n}"`).join(', ') || 'none'}`
          );
        }
        // both parsers are big and most sketches never load an HDRI, so they
        // arrive on first use rather than at page load (like the FBX one)
        const loader = /\.exr$/i.test(rec.name)
          ? new (await import('three/addons/loaders/EXRLoader.js')).EXRLoader()
          : new (await import('three/addons/loaders/HDRLoader.js')).HDRLoader();
        const url = URL.createObjectURL(rec.blob);
        const tex = await loader.loadAsync(url);
        URL.revokeObjectURL(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = (this._pmrem ??= new THREE.PMREMGenerator(this.renderer));
        pmrem.compileEquirectangularShader();
        h.texture = tex;
        h.env = pmrem.fromEquirectangular(tex).texture;
        return h;
      } catch (e) {
        h.missing = true;
        warn(`hdri "${name}": ${e.message ?? e}`);
        return null;
      }
    })();
    return h;
  }

  // Rewind imported media: restartMedia() = everything, restartMedia('drums')
  // by name (substring). Bound to ctrl+r; also callable from a sketch, where
  // it runs on every execute.
  restartMedia(name) {
    const n = name == null ? null : String(name).toLowerCase();
    for (const m of this.media.values()) {
      if (n != null && !m.name.toLowerCase().includes(n)) continue;
      if (m.el && 'currentTime' in m.el) {
        m.el.currentTime = 0;
        if (!this.paused) m.el.play().catch(() => {});
      }
    }
  }

  // An empty videofile()/imagefile()/imageseq()/audiofile() call: remember
  // that a picker is wanted; main.js opens it right after the run (it needs
  // the user-gesture context of the ctrl+enter) and fills the call in.
  requestMediaPick(fn, kind, multiple = false) {
    this.pendingPick ??= { fn, kind, multiple };
  }

  // Same deal for an empty hdri() / .material(), except what opens is the Poly
  // Haven browser rather than a file picker — there's no local file to point
  // at yet, which is the whole reason the call is empty.
  requestBrowse(fn, type) {
    this.pendingPick ??= { fn, browse: type };
  }

  // Named geometry layers: geometry .out('name') moves the object onto its
  // own three.js layer (invisible to the display camera), and input('name')
  // renders just that layer as a texture. Layer 0 is the naked-.out() scene.
  geoLayer(name) {
    let bit = this.geoLayers.get(name);
    if (bit == null) {
      bit = this.geoLayers.size + 1;
      if (bit > 31) {
        // three has 32 layer bits and layer 0 is the display scene; past that
        // a name has nowhere of its own to go, so it renders with everything
        warn(`out('${name}'): more than 31 named layers — this one renders into the main scene`);
        return 0;
      }
      this.geoLayers.set(name, bit);
    }
    return bit;
  }

  clearPatch() {
    for (const obj of this.patch) {
      this.scene.remove(obj);
      obj.traverse?.((child) => {
        child.geometry?.dispose?.();
        // a .noise() chain that casts shadows carries its own depth materials,
        // which nothing else would reach
        child.customDepthMaterial?.dispose();
        child.customDistanceMaterial?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    this.patch = [];
    this.updaters = [];
    this.patchGen++;
    resetWarnings();
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x0a0a0f);
    // the HDRI itself stays cached; only the scene's use of it is patch state,
    // so a sketch that drops its hdri() call goes back to plain lighting
    this.scene.environment = null;
    this.scene.environmentIntensity = 1;
    this.scene.environmentRotation.set(0, 0, 0);
    this.scene.backgroundRotation.set(0, 0, 0);
    this.scene.backgroundBlurriness = 0;
    this.scene.backgroundIntensity = 1;

    for (const node of this.textureNodes) node.dispose();
    this.textureNodes = [];
    this.textureOutput = null;
    this.textureBuffers.clear();
    this.textureMaps = [];
    this.geoLayers.clear();

    this.cameraProgrammed = false;
    this.cameraTouched = false;
    this.controls.enabled = true;
    // dropping the resolution() call goes back to filling the window
    this.resolution = null;
    // a picker request belongs to the run that made it: the code has moved on,
    // and a request left over from a run whose empty call has since been filled
    // in would pop the picker straight back open
    this.pendingPick = null;

    // media that wasn't found gets another lookup next run — a file dropped
    // in since then resolves it
    for (const [key, m] of this.media) {
      if (m.missing) this.media.delete(key);
    }
    for (const [key, m] of this.models) {
      if (m.missing) this.models.delete(key);
    }
    for (const [key, t] of this.textures) {
      if (t.missing) this.textures.delete(key);
    }
    for (const [key, s] of this.pbrSets) {
      if (s.missing) this.pbrSets.delete(key);
    }
    for (const [key, h] of this.hdris) {
      if (h.missing) this.hdris.delete(key);
    }
  }

  // Evaluate sketch code with the livecoding API in scope. Returns an error
  // (or null) instead of throwing so the editor can show it inline. A run that
  // throws restores the last good sketch: mid-edit errors show in the status
  // bar while the visuals keep playing (err.restored says that happened).
  run(code, api) {
    // Only worth saving when the camera is the user's to move: after a run
    // that programmed it, the pose on screen is the sketch's, and the one
    // worth coming back to is still the one saved before it took over.
    if (!this.cameraTouched) {
      this.orbitPose.pos.copy(this.camera.position);
      this.orbitPose.target.copy(this.controls.target);
    }
    this.clearPatch();
    const names = Object.keys(api);
    const values = names.map((n) => api[n]);
    const exec = (src) => {
      new Function(...names, `"use strict";\n${src}`)(...values);
      if (!this.cameraTouched) {
        this.camera.position.copy(this.orbitPose.pos);
        this.controls.target.copy(this.orbitPose.target);
        this.camera.lookAt(this.orbitPose.target);
      }
      this.syncResolution(); // before the settle below, so the aspect is right
      // settle the new patch at current sketch time (matters when paused)
      for (const fn of this.updaters) {
        try { fn(this.time, 0); } catch (e) { /* the next frame's tick warns */ }
      }
    };
    try {
      exec(code);
      this._lastGood = code;
      return null;
    } catch (err) {
      this.clearPatch();
      if (this._lastGood != null && this._lastGood !== code) {
        try {
          exec(this._lastGood);
          err.restored = true;
          // an empty videofile()/.material() in the restored code asked for a
          // picker on its own run and would get one now — over an editor
          // holding the broken code its pick would be written into
          this.pendingPick = null;
        } catch {
          // the old sketch depended on state that's gone — nothing to show
          this._lastGood = null;
          this.clearPatch();
          this.syncResolution();
        }
      } else {
        this.syncResolution();
      }
      return err;
    }
  }
}
