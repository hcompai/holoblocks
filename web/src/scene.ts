import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box, Palette, RenderRequest } from "./model";
import { type Atlas, buildAtlas } from "./atlas";
import type { MeshFailure, MeshReply, MeshRequest, MesherSetup } from "./mesher";
import type { Theme } from "./theme";
import { type Kind, packBoxes } from "./voxels";

export type View = "iso" | "isoBack" | "front" | "top";

const VIEW_DIRECTIONS: Record<View, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.8, 1.25).normalize(),
  isoBack: new THREE.Vector3(-1, 0.8, -1.25).normalize(),
  front: new THREE.Vector3(0, 0.3, 1).normalize(),
  top: new THREE.Vector3(0, 1, 0.001).normalize(),
};

const SHEET: { view: View; label: string }[] = [
  { view: "iso", label: "3/4 front-right" },
  { view: "isoBack", label: "3/4 back-left" },
  { view: "front", label: "Front" },
  { view: "top", label: "Top (back is up)" },
];

export interface Site {
  width: number;
  height: number;
  depth: number;
  boxes: Box[];
}

/** Share of the frame's height and width the build may fill. */
const FRAME_FILL = 0.9;
const SKY_RADIUS = 3000;
/** Vertical field of view of a camera placed at a visitor's eye, wider than the framing views'. */
const EYE_FOV = 60;
const FOCUS_BACKGROUND = "#141414";

function corners(box: THREE.Box3): number[] {
  const points: number[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(x, y, z);
  return points;
}

/** Planes that keep only what lies inside `box`, faces on its walls included. */
function clippingPlanes(box: THREE.Box3): THREE.Plane[] {
  const e = 0.01;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x + e),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x + e),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y + e),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y + e),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z + e),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z + e),
  ];
}

const SKIES: Record<Theme, { zenith: number; horizon: number; ground: number }> = {
  light: { zenith: 0x95a1b8, horizon: 0xe7e9ef, ground: 0xc6ccda },
  dark: { zenith: 0x161616, horizon: 0x2a2a2a, ground: 0x121212 },
};

function skyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 up = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.6));
        vec3 down = mix(horizon, ground, pow(clamp(-h, 0.0, 1.0), 0.35));
        gl_FragColor = vec4(h >= 0.0 ? up : down, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

type Materials = Record<Kind, THREE.Material>;

function makeMaterials(atlas: Atlas): Materials {
  const map = atlas.texture;
  return {
    opaque: new THREE.MeshLambertMaterial({ map, vertexColors: true }),
    cutout: new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    transparent: new THREE.MeshLambertMaterial({
      map,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  };
}

/** A meshed site: one mesh per material kind, the points that bound its views, the blocks' bounds, and block counts by name. */
interface Model {
  group: THREE.Group;
  outline: Float32Array;
  bounds: THREE.Box3 | null;
  counts: Map<string, number>;
}

function toModel({ meshes, outline, counts, bounds }: MeshReply, materials: Materials): Model {
  const group = new THREE.Group();
  for (const { kind, positions, normals, uvs, colors, indices } of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const mesh = new THREE.Mesh(geometry, materials[kind]);
    mesh.renderOrder = kind === "transparent" ? 2 : kind === "cutout" ? 1 : 0;
    mesh.receiveShadow = true;
    mesh.castShadow = kind !== "transparent";
    group.add(mesh);
  }
  return { group, outline, bounds: bounds && new THREE.Box3().setFromArray(bounds), counts };
}

const disposeModel = (model: Model) => model.group.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());

const logged = (error: unknown) => {
  console.error(error);
  return null;
};

const LIGHTS: [number, number, number, number, number][] = [
  [-6, 10, 8, 2.2, 0xfff4e0],
  [8, 6, -6, 0.5, 0xcfe3ff],
  [10, 7, 10, 0.3, 0xffffff],
];

/** Three.js scene showing a build's blocks up to a step, remeshed whenever either changes. */
export class BlockScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private dome = skyDome();
  private fog = new THREE.Fog(0, 140, 420);
  private theme: Theme = "dark";
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  private controls: OrbitControls;
  private model: Model | null = null;
  private materials: Materials | null = null;
  private lights: THREE.DirectionalLight[] = [];
  private sun!: THREE.DirectionalLight;
  private site: Site | null = null;
  private step = Infinity;
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private dirty = true;
  private worker: Worker | null = null;
  private setup: MesherSetup | null = null;
  /** Set when a crashed worker was replaced, until the new one replies; a second crash leaves meshing down. */
  private respawned = false;
  private jobs = new Map<number, { resolve: (reply: MeshReply) => void; reject: (error: Error) => void }>();
  private lastJob = 0;
  /** Bumped by every remesh, so a mesh that lands after a newer one was asked for is dropped. */
  private version = 0;
  private meshing = false;
  private meshed = Promise.resolve();
  private settle: (() => void) | null = null;
  private loaded: Promise<void>;
  /** Whether the site last asked for could not be meshed. */
  private failed = false;
  /** Set once the user orbits or zooms, so live framing stops fighting them. */
  userMoved = false;
  onCounts: ((counts: Map<string, number>) => void) | null = null;
  onFailure: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    palette: Promise<Palette>,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.dome);
    this.scene.fog = this.fog;
    this.paintSky(this.theme);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a7a66, 0.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    for (const [x, y, z, intensity, color] of LIGHTS) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(x, y, z);
      this.scene.add(light);
      this.lights.push(light);
    }
    this.sun = this.lights[0];
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => (this.userMoved = true));
    this.controls.autoRotateSpeed = 1.2;

    this.spawn();
    this.loaded = palette.then(async (p) => {
      const atlas = await buildAtlas(p);
      this.setup = { palette: p, uvs: atlas.uvs };
      this.worker?.postMessage(this.setup);
      this.materials = makeMaterials(atlas);
      this.remesh();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frameView("iso", 64, 64);
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      if (!this.controls.update() && !this.dirty) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** Resolves once the scene shows the site and step last asked for. */
  get ready(): Promise<void> {
    return this.loaded.then(() => this.meshed);
  }

  dispose() {
    this.worker?.terminate();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Show this site's boxes up to `step`. */
  show(site: Site | null, step = Infinity) {
    this.site = site;
    this.step = step;
    this.remesh();
  }

  private remesh() {
    this.version++;
    if (!this.settle) this.meshed = new Promise((resolve) => (this.settle = resolve));
    if (!this.site || !this.meshing) void this.request();
  }

  /** Meshes the latest site and step, one mesh in flight at a time, and shows it unless a newer one was asked for meanwhile. */
  private async request(): Promise<void> {
    const { site, step, version, materials } = this;
    if (!materials) return;
    let model: Model | null = null;
    if (site) {
      this.meshing = true;
      model = await this.mesh(site, step, materials).catch(logged);
      this.meshing = false;
      if (version !== this.version) {
        if (model) disposeModel(model);
        return this.request();
      }
      if (model) this.aimLights(site.width, site.height, site.depth);
    }
    const old = this.model;
    this.put(model);
    if (old) disposeModel(old);
    this.failed = !!site && !model;
    if (model) this.onCounts?.(model.counts);
    if (this.failed) this.onFailure?.();
    this.settle?.();
    this.settle = null;
  }

  private mesh(site: Site, step: number, materials: Materials): Promise<Model> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The mesher is down"));
    const id = ++this.lastJob;
    const { blocks, boxes } = packBoxes(site.boxes, step);
    const request: MeshRequest = { id, width: site.width, height: site.height, depth: site.depth, blocks, boxes };
    worker.postMessage(request, [boxes.buffer]);
    return new Promise<MeshReply>((resolve, reject) => this.jobs.set(id, { resolve, reject })).then((reply) =>
      toModel(reply, materials),
    );
  }

  private spawn() {
    const worker = new Worker(new URL("./mesher.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<MeshReply | MeshFailure>) => {
      const job = this.jobs.get(data.id);
      this.jobs.delete(data.id);
      this.respawned = false;
      if ("error" in data) job?.reject(new Error(data.error));
      else job?.resolve(data);
    };
    worker.onerror = (e) => this.crash(e.message);
    worker.onmessageerror = () => this.crash("unreadable reply");
    if (this.setup) worker.postMessage(this.setup);
    this.worker = worker;
  }

  /** Fails the meshes in flight and replaces the worker, once until the new one replies. */
  private crash(reason: string) {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) job.reject(new Error(`The mesher crashed: ${reason}`));
    this.jobs.clear();
    if (this.respawned) return;
    this.respawned = true;
    this.spawn();
  }

  private put(model: Model | null) {
    if (this.model) this.scene.remove(this.model.group);
    if (model) this.scene.add(model.group);
    this.model = model;
    this.dirty = true;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private aimLights(width: number, height: number, depth: number) {
    const center = new THREE.Vector3(width / 2, 0, depth / 2);
    const reach = Math.max(width, depth, height);
    const span = Math.max(width, depth);
    this.fog.near = span * 2.2;
    this.fog.far = span * 6.5;
    for (const [i, light] of this.lights.entries()) {
      const [x, y, z] = LIGHTS[i];
      light.position
        .set(x, y, z)
        .normalize()
        .multiplyScalar(reach * 2)
        .add(center);
      light.target.position.copy(center);
    }
    const cam = this.sun.shadow.camera;
    const half = Math.hypot(width, depth) / 2 + 2;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = reach * 0.5;
    cam.far = reach * 3.5;
    cam.updateProjectionMatrix();
  }

  setSpin(spin: boolean) {
    this.controls.autoRotate = spin;
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.paintSky(theme);
  }

  private paintSky(theme: Theme) {
    const sky = SKIES[theme];
    const { uniforms } = this.dome.material;
    uniforms.zenith.value.set(sky.zenith);
    uniforms.horizon.value.set(sky.horizon);
    uniforms.ground.value.set(sky.ground);
    this.fog.color.set(sky.horizon);
    this.dirty = true;
  }

  /** Point the camera along `view` so `focus`, else the build (or the empty site), fills the frame. */
  frameView(view: View | THREE.Vector3, width: number, depth: number, focus?: THREE.Box3) {
    const box =
      focus ??
      this.model?.bounds ??
      new THREE.Box3(
        new THREE.Vector3(width * 0.25, 0, depth * 0.25),
        new THREE.Vector3(width * 0.75, 12, depth * 0.75),
      );
    const center = box.getCenter(new THREE.Vector3());
    const direction = view instanceof THREE.Vector3 ? view : VIEW_DIRECTIONS[view];
    const basis = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), this.camera.up);
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * FRAME_FILL;
    const tanH = tanV * this.camera.aspect;
    const outline = focus ? corners(focus) : this.outline(box);
    const p = new THREE.Vector3();
    const each = (visit: (p: THREE.Vector3) => void) => {
      for (let i = 0; i < outline.length; i += 3) visit(p.fromArray(outline, i).sub(center));
    };
    const fit = () => {
      let distance = 0;
      each((p) => {
        const ahead = p.dot(direction);
        distance = Math.max(distance, ahead + Math.abs(p.dot(up)) / tanV, ahead + Math.abs(p.dot(right)) / tanH);
      });
      return distance;
    };
    let distance = fit();
    const seen = new THREE.Box2();
    each((p) => {
      const away = distance - p.dot(direction);
      seen.expandByPoint(new THREE.Vector2(p.dot(right) / (away * tanH), p.dot(up) / (away * tanV)));
    });
    const middle = seen.getCenter(new THREE.Vector2());
    center.addScaledVector(right, middle.x * distance * tanH).addScaledVector(up, middle.y * distance * tanV);
    distance = fit();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.dirty = true;
  }

  /** Put a wide camera at `eye`, turned toward the middle of `focus`, else of the build (or the empty site), and tilted `pitch` degrees down. */
  private placeEye(eye: THREE.Vector3, pitch: number, width: number, depth: number, focus?: THREE.Box3) {
    const box = focus ?? this.model?.bounds;
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(width / 2, 6, depth / 2);
    const heading = Math.atan2(center.x - eye.x, center.z - eye.z);
    const down = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitch, -89.9, 89.9));
    const ahead = new THREE.Vector3(
      Math.sin(heading) * Math.cos(down),
      -Math.sin(down),
      Math.cos(heading) * Math.cos(down),
    );
    this.camera.fov = EYE_FOV;
    this.camera.position.copy(eye);
    this.camera.near = 0.1;
    this.camera.far = SKY_RADIUS * 2;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(eye).add(ahead);
    this.controls.update();
    this.dirty = true;
  }

  /** Points the frame must hold: the model's outline, or the corners of `box` before anything is meshed. */
  private outline(box: THREE.Box3): ArrayLike<number> {
    return this.model?.outline.length ? this.model.outline : corners(box);
  }

  /** Square renders of the model, or only the blocks inside `focus`, into a 2D canvas over `sky`, or transparent; the user's view is left untouched. */
  private async offscreen(
    size: number,
    tiles: (({ view: View | THREE.Vector3 } | { eye: THREE.Vector3; pitch: number }) & {
      x: number;
      y: number;
      label?: string;
    })[],
    sky: Theme | null,
    columns = 1,
    focus?: THREE.Box3,
    zoom = 1,
  ) {
    await this.ready;
    if (this.failed) return null;
    const { site, step, materials } = this;
    let full: Model | null = null;
    if (site && materials && site.boxes.some((b) => b.step > step)) {
      full = await this.mesh(site, Infinity, materials).catch(logged);
      if (!full) return null;
    }
    const shown = this.model;
    if (full) this.put(full);
    const { position, near, far, fov } = this.camera;
    const saved = { position: position.clone(), target: this.controls.target.clone(), near, far, fov };
    const pixelRatio = this.renderer.getPixelRatio();
    const canvas = document.createElement("canvas");
    canvas.width = size * columns;
    canvas.height = size * Math.ceil(tiles.length / columns);
    const ctx = canvas.getContext("2d")!;

    if (sky) this.paintSky(sky);
    this.dome.visible = !!sky && !focus;
    this.scene.fog = sky && !focus ? this.fog : null;
    this.renderer.clippingPlanes = focus ? clippingPlanes(focus) : [];
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size * 2, size * 2, false);
    this.camera.aspect = 1;
    this.camera.zoom = zoom;
    const width = site?.width ?? 64;
    const depth = site?.depth ?? 64;
    for (const tile of tiles) {
      if ("eye" in tile) this.placeEye(tile.eye, tile.pitch, width, depth, focus);
      else this.frameView(tile.view, width, depth, focus);
      this.renderer.render(this.scene, this.camera);
      if (focus) {
        ctx.fillStyle = FOCUS_BACKGROUND;
        ctx.fillRect(tile.x, tile.y, size, size);
      }
      ctx.drawImage(this.renderer.domElement, tile.x, tile.y, size, size);
      if (tile.label) {
        ctx.font = "600 15px system-ui, sans-serif";
        ctx.fillStyle = "#e8e8f0";
        ctx.fillText(tile.label, tile.x + 10, tile.y + 22);
        ctx.strokeStyle = "#3a3f52";
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, size - 1, size - 1);
      }
    }

    if (full) {
      this.put(shown);
      disposeModel(full);
    }
    this.dome.visible = true;
    this.scene.fog = this.fog;
    this.renderer.clippingPlanes = [];
    this.paintSky(this.theme);
    this.renderer.setPixelRatio(pixelRatio);
    this.resize();
    Object.assign(this.camera, { near: saved.near, far: saved.far, fov: saved.fov, zoom: 1 });
    this.camera.position.copy(saved.position);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  /** What the viewer shows now, at `scale` times its pixel size. */
  image(scale = 2): Promise<Blob | null> {
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(ratio * scale);
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
    this.renderer.setPixelRatio(ratio);
    this.resize();
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  thumbnail(size = 320): Promise<Blob | null> {
    return this.offscreen(size, [{ view: "iso", x: 0, y: 0 }], null);
  }

  /** What a builder asked to see: one large view from its camera, the four labelled views, or one large view from its angle and pitch, of the model or only of the blocks in its box. */
  look({ box, angle, pitch, zoom, eye }: RenderRequest, size = 448): Promise<Blob | null> {
    const focus = box
      ? new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3] + 1, box[4] + 1, box[5] + 1))
      : undefined;
    if (eye) {
      const tilt = pitch ? `, ${Math.abs(pitch)}° ${pitch > 0 ? "down" : "up"}` : "";
      const label = `from x ${eye[0]}, y ${eye[1]}, z ${eye[2]}${tilt}${zoom === 1 ? "" : `, ${zoom}× zoom`}`;
      const tile = { eye: new THREE.Vector3(eye[0], eye[1], eye[2]), pitch, label, x: 0, y: 0 };
      return this.offscreen(size * 2, [tile], "dark", 1, focus, zoom);
    }
    if (angle === null) {
      const tiles = SHEET.map((s, i) => ({
        view: s.view,
        label: s.label,
        x: (i % 2) * size,
        y: Math.floor(i / 2) * size,
      }));
      return this.offscreen(size, tiles, "dark", 2, focus, zoom);
    }
    const around = THREE.MathUtils.degToRad(angle);
    const up = THREE.MathUtils.degToRad(Math.min(pitch, 89.9));
    const view = new THREE.Vector3(Math.sin(around) * Math.cos(up), Math.sin(up), Math.cos(around) * Math.cos(up));
    const label = `${angle}° around, ${pitch}° up${zoom === 1 ? "" : `, ${zoom}× zoom`}`;
    return this.offscreen(size * 2, [{ view, label, x: 0, y: 0 }], "dark", 1, focus, zoom);
  }
}
