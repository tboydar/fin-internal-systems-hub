import {
  BoxGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RACKS, type TwinModel } from '../core/twin';
import type { SystemId } from '../core/types';
import { B1, buildModel, PALETTE, slipRoute, TONE } from './model';

// 3D 微縮總行：一棟剖開的總行。樓層是單位，地下機房的機櫃是系統，旁邊的小房子是營業據點；
// 沿著機房輸送帶移動的小紙片是傳票與簽呈，速度代表流量、顏色代表狀態。
//
// 這個檔案負責「怎麼看」：光線、陰影、鏡頭、標籤、小紙片與點選。模型本身在 model.ts。
// 要畫什麼（哪個系統什麼狀態、哪條介面在跑、哪層樓受影響）全部來自 core/twin.ts 的 twinModel()，
// 跟 2D 的頁面讀的是同一份。
//
// 質感是建築事務所拍白模的照片：霧面、低飽和、正交鏡頭、一盞主光加柔和的陰影。
// 主光跟著時間走，重播月結日的 24 小時會看到影子移動、入夜後只剩機房亮著。
// 沒有發光、沒有粒子、不會自己轉。

const MAX_SLIPS = 96;
const SLIP_OK = 0x5d7186;
const SUN_HIGH = new Color(0xfffcf6);
const SUN_LOW = new Color(0xffeedb);
const MOON = new Color(0xbfcfe9);
const UP = new Vector3(0, 1, 0);

export interface TwinLabel {
  id: string;
  kind: 'system' | 'floor' | 'branches';
  text: string;
  title: string;
}

export interface TwinOptions {
  container: HTMLElement;
  labelLayer: HTMLElement;
  labels: TwinLabel[];
  ariaLabel: string;
  /** 營業據點有幾處，就蓋幾間小房子。 */
  branches: number;
  lowFx: boolean;
  /** 使用者要求減少動態：小紙片不移動，光線不漸變，只在狀態改變時重畫。 */
  still: boolean;
  onSelect(id: SystemId): void;
}

export interface TwinHandle {
  update(model: TwinModel, selected: SystemId | null): void;
  setLabels(labels: TwinLabel[]): void;
  setLowFx(low: boolean): void;
  resetView(): void;
  dispose(): void;
}

interface Slip {
  path: Vector3[];
  /** 每一段的長度與總長，移動時用來換算位置。 */
  lengths: number[];
  total: number;
  offset: number;
  speed: number;
  color: number;
}

function pathOf(points: Vector3[]): Pick<Slip, 'path' | 'lengths' | 'total'> {
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  return { path: points, lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

/** 算出紙片在路徑上的位置，回傳它正走在第幾段（用來決定朝向）。 */
function pointAt(slip: Slip, distance: number, out: Vector3): number {
  let left = ((distance % slip.total) + slip.total) % slip.total;
  for (let i = 0; i < slip.lengths.length; i++) {
    if (left <= slip.lengths[i]) {
      out.lerpVectors(slip.path[i], slip.path[i + 1], slip.lengths[i] ? left / slip.lengths[i] : 0);
      return i;
    }
    left -= slip.lengths[i];
  }
  out.copy(slip.path[slip.path.length - 1]);
  return slip.lengths.length - 1;
}

/** 某個時間的光線。 */
interface Mood {
  /** 從場景指向主光的方向。 */
  dir: Vector3;
  sun: number;
  sunColor: Color;
  sky: number;
  fill: number;
  room: number;
  /** 桌面底色的強度。 */
  table: number;
}

const newMood = (): Mood => ({ dir: new Vector3(), sun: 0, sunColor: new Color(), sky: 0, fill: 0, room: 0, table: 0 });
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const aim = (azimuth: number, elevation: number, out: Vector3) => {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
};

const scratchDir = new Vector3();
const scratchColor = new Color();
/**
 * 幾點鐘的光線長什麼樣。白天主光從左前方慢慢移到右前方，中午最高；
 * 天亮前與天黑後換成比較暗、偏冷的光，機房自己的燈相對就亮了。
 */
function moodAt(hour: number, out: Mood): Mood {
  const day = smooth((hour - 5) / 2) * (1 - smooth((hour - 17) / 2));
  const t = clamp01((hour - 6) / 12);
  const height = Math.sin(Math.PI * t);
  aim(-40, 46, out.dir)
    .lerp(aim(-62 + 100 * t, 22 + 16 * height, scratchDir), day)
    .normalize();
  out.sun = lerp(0.6, 2.0, day);
  out.sunColor.copy(MOON).lerp(scratchColor.copy(SUN_LOW).lerp(SUN_HIGH, height), day);
  out.sky = lerp(1.0, 1.9, day);
  out.fill = lerp(0.3, 0.6, day);
  out.room = lerp(3.4, 2.0, day);
  out.table = lerp(0.42, 1, day);
  return out;
}

function mix(a: Mood, b: Mood, t: number, out: Mood): void {
  out.dir.copy(a.dir).lerp(b.dir, t).normalize();
  out.sun = lerp(a.sun, b.sun, t);
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.sky = lerp(a.sky, b.sky, t);
  out.fill = lerp(a.fill, b.fill, t);
  out.room = lerp(a.room, b.room, t);
  out.table = lerp(a.table, b.table, t);
}

/** 沒有顯示卡、靠 CPU 算圖的環境（遠端桌面、CI）。這種環境直接當成勾了「降低特效」。 */
function isSoftwareGl(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|software|basic render/i.test(name);
}

/**
 * 建立 3D 場景。瀏覽器沒有 WebGL 時，WebGLRenderer 的建構式會丟例外；
 * 呼叫的人接住之後改顯示同一份資料的清單。
 */
export function createTwin(opts: TwinOptions): TwinHandle {
  const { container, labelLayer } = opts;
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  const software = isSoftwareGl(renderer);
  let lowFx = opts.lowFx || software;
  renderer.shadowMap.type = PCFShadowMap;
  // 場景幾乎不動，陰影只在光線或狀態改變時重算
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', opts.ariaLabel);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const built = buildModel(opts.branches);
  scene.add(built.group);
  const center = built.bounds.getCenter(new Vector3());
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      new Vector3(
        n & 1 ? built.bounds.max.x : built.bounds.min.x,
        n & 2 ? built.bounds.max.y : built.bounds.min.y,
        n & 4 ? built.bounds.max.z : built.bounds.min.z,
      ),
  );

  // ── 光線：一盞會投影的主光、一層天光、右前方一盞很弱的補光，加上機房自己的燈
  const sky = new HemisphereLight(0xffffff, 0xdddcda, 1);
  scene.add(sky);
  const sun = new DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2.2;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.target.position.copy(center);
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0xe9eff8, 0.6);
  fill.position.set(10, 6, 14);
  scene.add(fill);
  const room = new PointLight(0xfff0d8, 2, 9, 1.6);
  room.position.set(0, B1 - 0.4, 1.25);
  room.castShadow = true;
  room.shadow.mapSize.set(512, 512);
  room.shadow.radius = 2;
  room.shadow.bias = -0.002;
  room.shadow.normalBias = 0.03;
  room.shadow.camera.near = 0.1;
  room.shadow.camera.far = 9;
  scene.add(room);

  // 模型放在一張桌面上。桌面大到蓋滿整個畫面，所以畫面的底色就是受光的桌面，入夜會跟著暗下來
  // 桌面自己帶一點底色（emissive），影子才不會黑成一大片搶走模型的戲
  const tableTop = new MeshStandardMaterial({ color: 0xa6a8aa, emissive: 0xa3a5a6, roughness: 1, metalness: 0 });
  const table = new Mesh(new PlaneGeometry(400, 400), tableTop);
  table.rotation.x = -Math.PI / 2;
  table.position.set(center.x, built.bounds.min.y - 0.01, center.z);
  table.receiveShadow = true;
  scene.add(table);

  const lightView = new Matrix4();
  const probe = new Vector3();
  /** 把陰影的範圍收到剛好包住模型，同樣大小的陰影貼圖才夠細。 */
  function fitShadow(): void {
    lightView.lookAt(sun.position, center, UP).invert();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let near = Infinity;
    for (const corner of corners) {
      probe.copy(corner).sub(sun.position).applyMatrix4(lightView);
      minX = Math.min(minX, probe.x);
      maxX = Math.max(maxX, probe.x);
      minY = Math.min(minY, probe.y);
      maxY = Math.max(maxY, probe.y);
      near = Math.min(near, -probe.z);
    }
    const cam = sun.shadow.camera;
    cam.left = minX - 0.5;
    cam.right = maxX + 0.5;
    cam.bottom = minY - 0.5;
    cam.top = maxY + 0.5;
    cam.near = Math.max(0.5, near - 1);
    // 影子會落在模型後面的桌面上，所以遠的那一頭要留長一點
    cam.far = near + 60;
    cam.updateProjectionMatrix();
  }

  const mood = moodAt(10, newMood());
  const moodFrom = newMood();
  const moodGoal = moodAt(10, newMood());
  let moodT = 1;
  let moodHour = -1;
  function applyMood(): void {
    sun.position.copy(center).addScaledVector(mood.dir, 30);
    sun.intensity = mood.sun;
    sun.color.copy(mood.sunColor);
    sky.intensity = mood.sky;
    fill.intensity = mood.fill;
    room.intensity = mood.room;
    tableTop.emissiveIntensity = mood.table;
    fitShadow();
    renderer.shadowMap.needsUpdate = true;
  }

  // ── 小紙片：一個 InstancedMesh 畫全部。用不受光的材質，白天晚上顏色都一樣好認
  const slipMesh = new InstancedMesh(new BoxGeometry(0.25, 0.02, 0.16), new MeshBasicMaterial({ color: 0xffffff }), MAX_SLIPS);
  slipMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  slipMesh.count = 0;
  slipMesh.frustumCulled = false;
  scene.add(slipMesh);
  let slips: Slip[] = [];
  const dummy = new Object3D();
  const point = new Vector3();
  const tint = new Color();

  function buildSlips(model: TwinModel): void {
    slips = [];
    const active = model.flows.filter((f) => f.active);
    active.forEach((flow, n) => {
      const path = pathOf(slipRoute(flow.from, flow.to, flow.viaEsb, n));
      // 流量越大，紙片越多、走得越快；中斷的介面紙片停在原地
      const count = Math.min(lowFx ? 1 : flow.level, Math.floor((MAX_SLIPS - slips.length) / Math.max(1, active.length - n)) || 1);
      for (let k = 0; k < count && slips.length < MAX_SLIPS; k++) {
        slips.push({
          ...path,
          offset: (path.total / count) * k + n * 0.37,
          speed: flow.health === 'crit' ? 0 : 0.5 + flow.level * 0.35,
          color: flow.health === 'ok' ? SLIP_OK : TONE[flow.health],
        });
      }
    });
    slipMesh.count = slips.length;
    for (let i = 0; i < slips.length; i++) slipMesh.setColorAt(i, tint.setHex(slips[i].color));
    if (slipMesh.instanceColor) slipMesh.instanceColor.needsUpdate = true;
  }

  function placeSlips(seconds: number): void {
    slips.forEach((slip, i) => {
      const segment = pointAt(slip, slip.offset + seconds * slip.speed, point);
      dummy.position.copy(point);
      // 沿著輸送帶走的時候橫著，進出機櫃的時候轉成直的
      dummy.rotation.y = Math.abs(slip.path[segment + 1].z - slip.path[segment].z) > 0.001 ? Math.PI / 2 : 0;
      dummy.updateMatrix();
      slipMesh.setMatrixAt(i, dummy.matrix);
    });
    slipMesh.instanceMatrix.needsUpdate = true;
  }

  // ── 鏡頭：正交、固定的斜上方視角。可以小幅轉動與縮放，但不會自己轉
  const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 200);
  const home = aim(30, 21, new Vector3()).multiplyScalar(40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.minZoom = 0.9;
  controls.maxZoom = 3.2;
  controls.minPolarAngle = 0.9;
  controls.maxPolarAngle = 1.4;
  controls.minAzimuthAngle = -0.12;
  controls.maxAzimuthAngle = 0.95;
  // 觸控裝置上，直的滑動留給頁面捲動，橫的滑動才轉鏡頭
  if (matchMedia('(pointer: coarse)').matches) renderer.domElement.style.touchAction = 'pan-y';

  /** 讓整個模型剛好放進畫面。左邊要留給樓層標籤，標籤多寬就留多寬（英文的標籤比中文長）。 */
  function frame(): void {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const corner of built.outline) {
      probe.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, probe.x);
      maxX = Math.max(maxX, probe.x);
      minY = Math.min(minY, probe.y);
      maxY = Math.max(maxY, probe.y);
    }
    const pad = 10;
    let padLeft = pad;
    // 先照模型本身取景，再看最左邊的樓層標籤有沒有被切到；被切到就把左邊的留白加大，重算一次
    for (let pass = 0; pass < 3; pass++) {
      const scale = Math.min((w - padLeft - pad) / (maxX - minX), (h - pad * 2) / (maxY - minY));
      const left = minX - padLeft / scale - (w / scale - (maxX - minX) - (padLeft + pad) / scale) / 2;
      const bottom = minY - pad / scale - (h / scale - (maxY - minY) - (pad * 2) / scale) / 2;
      camera.left = left;
      camera.right = left + w / scale;
      camera.bottom = bottom;
      camera.top = bottom + h / scale;
      camera.updateProjectionMatrix();
      let edge = Infinity;
      for (const [key, anchor] of built.anchors) if (key.startsWith('floor:')) edge = Math.min(edge, toScreen(anchor, w, h)[0] - floorWide);
      if (edge >= 6 || padLeft > w * 0.45) break;
      padLeft += 6 - edge;
    }
  }

  function resetView(): void {
    controls.target.copy(center);
    camera.position.copy(center).add(home);
    camera.zoom = 1;
    camera.lookAt(center);
    controls.update();
    frame();
    draw();
  }

  // ── 後製：只有一道環境遮蔽，讓牆角、桌腳、機櫃之間有該有的暗部。降低特效時整段跳過
  let composer: EffectComposer | null = null;
  function ensureComposer(): EffectComposer {
    if (composer) return composer;
    composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 16, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1.3, rings: 2, samples: 12 });
    ao.blendIntensity = 0.9;
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    return composer;
  }
  /** 跑了一小段發現一幀要畫太久的話，自己把環境遮蔽關掉，不用等使用者去勾「降低特效」。 */
  let strained = false;
  let sampled = 0;
  let sampledTime = 0;
  const fancy = () => !lowFx && !strained;

  // ── 標籤：疊在畫面上的 HTML，位置由 3D 座標投影而來。機櫃的標籤是按鈕，可以用鍵盤選取
  let labelEls = new Map<string, HTMLElement>();
  let stems = new Map<string, HTMLElement>();
  /** 機櫃標籤裡最寬的有幾個像素寬，以及標籤的高度。 */
  let widest = 44;
  let tall = 16;
  /** 樓層標籤裡最寬的有幾個像素寬。 */
  let floorWide = 60;

  function setLabels(labels: TwinLabel[]): void {
    labelLayer.replaceChildren();
    labelEls = new Map();
    stems = new Map();
    for (const label of labels) {
      const el = document.createElement(label.kind === 'system' ? 'button' : 'span');
      el.className = `twin-label is-${label.kind}`;
      el.textContent = label.text;
      el.title = label.title;
      if (el instanceof HTMLButtonElement) {
        el.type = 'button';
        el.dataset.system = label.id;
        el.setAttribute('aria-label', label.title);
        // 引線：從標籤垂直接到機櫃
        const stem = document.createElement('i');
        stem.className = 'twin-stem';
        labelLayer.appendChild(stem);
        stems.set(label.id, stem);
      }
      labelLayer.appendChild(el);
      labelEls.set(`${label.kind}:${label.id}`, el);
    }
    const rackLabels = [...labelEls].filter(([key]) => key.startsWith('system:')).map(([, el]) => el);
    widest = Math.max(24, ...rackLabels.map((el) => el.offsetWidth));
    tall = Math.max(12, ...rackLabels.map((el) => el.offsetHeight));
    floorWide = Math.max(40, ...[...labelEls].filter(([key]) => key.startsWith('floor:')).map(([, el]) => el.offsetWidth));
    // 換語言之後標籤寬度不一樣，取景要跟著重算
    frame();
    placeLabels();
  }

  const projected = new Vector3();
  function toScreen(anchor: Vector3, w: number, h: number): [number, number] {
    projected.copy(anchor).project(camera);
    return [((projected.x + 1) / 2) * w, ((1 - projected.y) / 2) * h];
  }

  function placeLabels(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // 機櫃靠得近：看相鄰兩個機櫃在畫面上隔多遠，決定標籤要錯開成幾排
    const first = built.anchors.get(`system:${RACKS[0]}`);
    const second = built.anchors.get(`system:${RACKS[1]}`);
    const gap = first && second ? Math.abs(toScreen(second, w, h)[0] - toScreen(first, w, h)[0]) : 30;
    const rows = Math.min(4, Math.max(2, Math.ceil((widest + 2) / Math.max(gap, 1))));
    // 排與排的間距：標籤自己的高度，加上「越右邊的機櫃在畫面上越低」的那一點落差
    const pitch = tall + 3 + gap * 0.22;
    for (const [key, el] of labelEls) {
      const anchor = built.anchors.get(key);
      if (!anchor) continue;
      const [x, y] = toScreen(anchor, w, h);
      const [kind, id] = key.split(':');
      if (kind !== 'system') {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        continue;
      }
      const lift = 6 + (RACKS.indexOf(id as SystemId) % rows) * pitch;
      el.style.left = `${x}px`;
      el.style.top = `${y - lift}px`;
      const stem = stems.get(id);
      if (stem) {
        stem.style.left = `${x}px`;
        stem.style.top = `${y - lift}px`;
        stem.style.height = `${lift}px`;
      }
    }
  }

  function resize(): void {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const ratio = lowFx ? 1 : Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    if (fancy()) {
      const fx = ensureComposer();
      fx.setPixelRatio(ratio);
      fx.setSize(w, h);
    }
    frame();
    draw();
  }

  let seconds = 0;
  function draw(): void {
    placeSlips(seconds);
    if (fancy()) ensureComposer().render();
    else renderer.render(scene, camera);
    placeLabels();
  }

  // ── 動畫迴圈：只有在看得到、分頁在前景時才跑；紙片不動、光線也沒在變的時候就停
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let disposed = false;
  let frameNo = 0;
  const moving = () => moodT < 1 || (!opts.still && slips.some((s) => s.speed > 0));
  const shouldRun = () => !disposed && onScreen && !document.hidden && moving();
  function tick(now: number): void {
    raf = 0;
    if (!shouldRun()) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!opts.still) seconds += dt;
    const fading = moodT < 1;
    // 前十幀不算（在編譯著色器），接著量 45 幀：平均超過 30 毫秒就當作這台機器吃力。
    // 光線漸變的那幾幀每幀都重算陰影，本來就比較慢，不列入
    if (fancy() && !fading && ++sampled > 10) {
      sampledTime += dt;
      if (sampled === 55) {
        if (sampledTime / 45 > 0.03) {
          strained = true;
          resize();
        }
        sampled = 0;
        sampledTime = 0;
      }
    }
    if (fading) {
      moodT = Math.min(1, moodT + dt / 0.6);
      mix(moodFrom, moodGoal, smooth(moodT), mood);
      applyMood();
    }
    // 降低特效：每兩幀畫一次
    if (fading || !lowFx || frameNo++ % 2 === 0) draw();
    raf = requestAnimationFrame(tick);
  }
  function sync(): void {
    if (shouldRun() && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  document.addEventListener('visibilitychange', sync);
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    sync();
  });
  io.observe(container);
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  controls.addEventListener('change', draw);

  // ── 點選機櫃
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const pickables = [...built.racks.values()];
  function pick(event: PointerEvent): SystemId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return (hit?.object.userData.systemId as SystemId | undefined) ?? null;
  }
  let downAt: [number, number] | null = null;
  let hovered: SystemId | null = null;
  const onDown = (event: PointerEvent) => {
    downAt = [event.clientX, event.clientY];
  };
  const onUp = (event: PointerEvent) => {
    // 拖曳轉動鏡頭不算點選
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const id = pick(event);
    if (id) opts.onSelect(id);
  };
  const onMove = (event: PointerEvent) => {
    const id = pick(event);
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    if (id === hovered) return;
    if (hovered) labelEls.get(`system:${hovered}`)?.classList.remove('is-hover');
    if (id) labelEls.get(`system:${id}`)?.classList.add('is-hover');
    hovered = id;
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);
  const onLabel = (event: Event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-system]')?.dataset.system;
    if (id) opts.onSelect(id as SystemId);
  };
  labelLayer.addEventListener('click', onLabel);

  function update(model: TwinModel, selected: SystemId | null): void {
    for (const sys of model.systems) {
      const set = built.marks.get(sys.id);
      if (set) for (const health of ['ok', 'warn', 'crit'] as const) set[health].visible = health === sys.health;
      const down = model.down.includes(sys.id);
      built.racks.get(sys.id)?.material.color.setHex(sys.id === selected ? PALETTE.primary : down ? TONE.crit : PALETTE.rack);
      const ring = built.rings.get(sys.id);
      if (ring) ring.visible = sys.id === selected;
      const label = labelEls.get(`system:${sys.id}`);
      label?.classList.toggle('is-selected', sys.id === selected);
      label?.setAttribute('data-health', down ? 'crit' : sys.health);
      stems.get(sys.id)?.setAttribute('data-health', down ? 'crit' : sys.health);
    }
    // 受影響的樓層：樓板換成偏紅的霧面色，切面換成中斷的顏色。不是發光，只是換了材質的顏色
    for (const floor of model.floors) {
      const parts = built.floors.get(floor.domain);
      parts?.slab.color.setHex(floor.affected ? PALETTE.affected : PALETTE.white);
      parts?.cut.color.setHex(floor.affected ? TONE.crit : PALETTE.cut);
      const label = labelEls.get(`floor:${floor.domain}`);
      label?.classList.toggle('is-affected', floor.affected);
      label?.setAttribute('data-health', floor.health);
    }
    built.houses.color.setHex(model.affected?.domains.includes('sales') ? PALETTE.affected : PALETTE.white);
    buildSlips(model);
    // 光線跟著時間走：第一次直接套用，之後用半秒多一點漸變過去
    if (model.hour !== moodHour) {
      const firstTime = moodHour < 0;
      moodHour = model.hour;
      moodAt(model.hour, moodGoal);
      if (firstTime || opts.still || lowFx) {
        mix(moodGoal, moodGoal, 1, mood);
        moodT = 1;
      } else {
        mix(mood, mood, 1, moodFrom);
        moodT = 0;
      }
    }
    applyMood();
    draw();
    sync();
  }

  function applyFx(): void {
    renderer.shadowMap.enabled = !lowFx;
    sun.castShadow = !lowFx;
    room.castShadow = !lowFx;
    renderer.shadowMap.needsUpdate = true;
  }

  applyFx();
  applyMood();
  setLabels(opts.labels);
  resetView();
  resize();

  return {
    update,
    setLabels,
    setLowFx(low) {
      lowFx = low || software;
      applyFx();
      resize();
      sync();
    },
    resetView,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', sync);
      io.disconnect();
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      labelLayer.removeEventListener('click', onLabel);
      scene.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material?.dispose();
      });
      composer?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
    },
  };
}
