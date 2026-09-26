import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box, Palette } from "./api";
import { type Atlas, buildAtlas } from "./atlas";
import { buildMeshes, makeMaterials, type Materials, VoxelWorld } from "./voxels";

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

/** Three.js scene showing a build's blocks up to a step, remeshed whenever either changes. */
const SKY = { zenith: 0x0d1018, horizon: 0x2c3247, ground: 0x0a0b10 };

function skyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      ground: { value: new THREE.Color(SKY.ground) },
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
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

const LIGHTS: [number, number, number, number, number][] = [
  [-6, 10, 8, 2.2, 0xfff4e0],
  [8, 6, -6, 0.5, 0xcfe3ff],
  [10, 7, 10, 0.3, 0xffffff],
];

export class BlockScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  private controls: OrbitControls;
  private meshes: THREE.Group | null = null;
  private atlas: Atlas | null = null;
  private materials: Materials | null = null;
  private lights: THREE.DirectionalLight[] = [];
  private sun!: THREE.DirectionalLight;
  private palette: Palette | null = null;
  private site: Site | null = null;
  private step = Infinity;
  private world: VoxelWorld | null = null;
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private dirty = true;
  /** Set once the user orbits or zooms, so live framing stops fighting them. */
  userMoved = false;
  /** Resolves once textures are loaded and the first world can be meshed. */
  ready: Promise<void>;
  onWorld: ((world: VoxelWorld) => void) | null = null;

  constructor(
    private container: HTMLElement,
    palette: Promise<Palette>,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.add(skyDome());
    this.scene.fog = new THREE.Fog(SKY.horizon, 140, 420);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a7a66, 0.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    this.ready = palette.then(async (p) => {
      this.palette = p;
      this.atlas = await buildAtlas(p);
      this.materials = makeMaterials(this.atlas);
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

  dispose() {
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
    if (this.meshes) {
      this.scene.remove(this.meshes);
      this.meshes.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.meshes = null;
    }
    this.world = null;
    this.dirty = true;
    this.renderer.shadowMap.needsUpdate = true;
    if (!this.site || !this.palette || !this.atlas || !this.materials) return;
    const { width, height, depth, boxes } = this.site;
    this.world = new VoxelWorld(width, height, depth, this.palette);
    this.world.apply(boxes, this.step);
    this.meshes = buildMeshes(this.world, this.atlas, this.materials);
    this.meshes.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.receiveShadow = true;
      o.castShadow = !(o.material as THREE.Material).transparent;
    });
    this.scene.add(this.meshes);
    this.aimLights(width, height, depth);
    this.onWorld?.(this.world);
  }

  private aimLights(width: number, height: number, depth: number) {
    const center = new THREE.Vector3(width / 2, 0, depth / 2);
    const reach = Math.max(width, depth, height);
    for (const [i, light] of this.lights.entries()) {
      const [x, y, z] = LIGHTS[i];
      light.position.set(x, y, z).normalize().multiplyScalar(reach * 2).add(center);
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

  /** Point the camera along `view` so the build (or the empty site) fills the frame. */
  frameView(view: View, width: number, depth: number) {
    let box = this.world?.bounds() ?? null;
    if (!box) box = new THREE.Box3(new THREE.Vector3(width * 0.25, 0, depth * 0.25), new THREE.Vector3(width * 0.75, 12, depth * 0.75));
    const size = box.getSize(new THREE.Vector3());
    const pad = Math.max(2, Math.max(size.x, size.z) * 0.08);
    box.expandByScalar(pad);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitHeight = radius / Math.tan(halfFov);
    const fitWidth = radius / (Math.tan(halfFov) * this.camera.aspect);
    const distance = Math.max(fitHeight, fitWidth) * 0.7;
    this.camera.position.copy(center).addScaledVector(VIEW_DIRECTIONS[view], distance);
    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.dirty = true;
  }

  /** Square renders of the whole model into a 2D canvas, leaving the user's camera and timeline untouched. */
  private async offscreen(size: number, tiles: { view: View; x: number; y: number; label?: string }[], columns = 1) {
    await this.ready;
    const { position, near, far } = this.camera;
    const saved = { position: position.clone(), target: this.controls.target.clone(), near, far, step: this.step };
    const pixelRatio = this.renderer.getPixelRatio();
    const canvas = document.createElement("canvas");
    canvas.width = size * columns;
    canvas.height = size * Math.ceil(tiles.length / columns);
    const ctx = canvas.getContext("2d")!;

    if (this.step !== Infinity) {
      this.step = Infinity;
      this.remesh();
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size * 2, size * 2, false);
    this.camera.aspect = 1;
    const width = this.site?.width ?? 64;
    const depth = this.site?.depth ?? 64;
    for (const tile of tiles) {
      this.frameView(tile.view, width, depth);
      this.renderer.render(this.scene, this.camera);
      ctx.drawImage(this.renderer.domElement, tile.x, tile.y, size, size);
      if (tile.label) {
        ctx.font = "600 15px system-ui, sans-serif";
        ctx.fillStyle = "#e8e8f0";
        ctx.fillText(tile.label, tile.x + 10, tile.y + 22);
        ctx.strokeStyle = "#3a3f52";
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, size - 1, size - 1);
      }
    }

    if (saved.step !== Infinity) {
      this.step = saved.step;
      this.remesh();
    }
    this.renderer.setPixelRatio(pixelRatio);
    this.resize();
    Object.assign(this.camera, { near: saved.near, far: saved.far });
    this.camera.position.copy(saved.position);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  thumbnail(size = 320): Promise<Blob | null> {
    return this.offscreen(size, [{ view: "iso", x: 0, y: 0 }]);
  }

  /** The four labelled views a builder looks at to check its work. */
  sheet(size = 448): Promise<Blob | null> {
    const tiles = SHEET.map((s, i) => ({ view: s.view, label: s.label, x: (i % 2) * size, y: Math.floor(i / 2) * size }));
    return this.offscreen(size, tiles, 2);
  }
}
