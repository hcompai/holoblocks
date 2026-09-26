import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box, Palette, RenderRequest } from "./api";
import { type Atlas, buildAtlas } from "./atlas";
import type { Theme } from "./theme";
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

/** Share of the frame's height and width the build may fill. */
const FRAME_FILL = 0.9;
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
  light: { zenith: 0xc9d0dd, horizon: 0xf4f5f8, ground: 0xe4e7ee },
  dark: { zenith: 0x0a0a0a, horizon: 0x262626, ground: 0x070707 },
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

/** Three.js scene showing a build's blocks up to a step, remeshed whenever either changes. */
export class BlockScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private dome = skyDome();
  private fog = new THREE.Fog(0, 140, 420);
  private theme: Theme = "dark";
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.dome);
    this.scene.fog = this.fog;
    this.paintSky(this.theme);
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
    const span = Math.max(width, depth);
    this.fog.near = span * 2.2;
    this.fog.far = span * 6.5;
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
      this.world?.bounds() ??
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
    const outline = focus ? [corners(focus)] : this.outline(box);
    const p = new THREE.Vector3();
    const each = (visit: (p: THREE.Vector3) => void) => {
      for (const positions of outline)
        for (let i = 0; i < positions.length; i += 3) visit(p.fromArray(positions, i).sub(center));
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

  /** Vertex positions the frame must hold: the meshed blocks, or the corners of `box` before anything is meshed. */
  private outline(box: THREE.Box3): ArrayLike<number>[] {
    const arrays: ArrayLike<number>[] = [];
    this.meshes?.traverse((o) => o instanceof THREE.Mesh && arrays.push(o.geometry.attributes.position.array));
    return arrays.length ? arrays : [corners(box)];
  }

  /** Square renders of the model, or only the blocks inside `focus`, into a 2D canvas over `sky`, or transparent; the user's view is left untouched. */
  private async offscreen(
    size: number,
    tiles: { view: View | THREE.Vector3; x: number; y: number; label?: string }[],
    sky: Theme | null,
    columns = 1,
    focus?: THREE.Box3,
    zoom = 1,
  ) {
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
    if (sky) this.paintSky(sky);
    this.dome.visible = !!sky && !focus;
    this.scene.fog = sky && !focus ? this.fog : null;
    this.renderer.clippingPlanes = focus ? clippingPlanes(focus) : [];
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size * 2, size * 2, false);
    this.camera.aspect = 1;
    this.camera.zoom = zoom;
    const width = this.site?.width ?? 64;
    const depth = this.site?.depth ?? 64;
    for (const tile of tiles) {
      this.frameView(tile.view, width, depth, focus);
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

    if (saved.step !== Infinity) {
      this.step = saved.step;
      this.remesh();
    }
    this.dome.visible = true;
    this.scene.fog = this.fog;
    this.renderer.clippingPlanes = [];
    this.paintSky(this.theme);
    this.renderer.setPixelRatio(pixelRatio);
    this.resize();
    Object.assign(this.camera, { near: saved.near, far: saved.far, zoom: 1 });
    this.camera.position.copy(saved.position);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  thumbnail(size = 320): Promise<Blob | null> {
    return this.offscreen(size, [{ view: "iso", x: 0, y: 0 }], null);
  }

  /** What a builder asked to see: the four labelled views, or one large view from its angle and pitch, of the model or only of the blocks in its box. */
  look({ box, angle, pitch, zoom }: RenderRequest, size = 448): Promise<Blob | null> {
    const focus = box
      ? new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3] + 1, box[4] + 1, box[5] + 1))
      : undefined;
    if (angle === null) {
      const tiles = SHEET.map((s, i) => ({ view: s.view, label: s.label, x: (i % 2) * size, y: Math.floor(i / 2) * size }));
      return this.offscreen(size, tiles, "dark", 2, focus, zoom);
    }
    const around = THREE.MathUtils.degToRad(angle);
    const up = THREE.MathUtils.degToRad(Math.min(pitch, 89.9));
    const view = new THREE.Vector3(Math.sin(around) * Math.cos(up), Math.sin(up), Math.cos(around) * Math.cos(up));
    const label = `${angle}° around, ${pitch}° up${zoom === 1 ? "" : `, ${zoom}× zoom`}`;
    return this.offscreen(size * 2, [{ view, label, x: 0, y: 0 }], "dark", 1, focus, zoom);
  }
}
