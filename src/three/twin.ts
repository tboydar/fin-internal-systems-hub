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
import type { SitesModel } from '../core/sites';
import type { TwinModel } from '../core/twin';
import type { Health } from '../core/types';
import { buildIsland, type IslandPlaces } from './island';
import type { Paint, PickTarget, Selection, SlipSpec, Stage } from './kit';
import { UP } from './kit';
import { buildHq } from './model';
import { buildZones, type ZonePlace } from './zones';

// 3D 的引擎：光線、陰影、鏡頭、標籤、小紙片與點選。
//
// 同一個引擎可以放三個比例尺的模型，一次只顯示一個：
//   hq    總行：一棟剖開的總行（model.ts）
//   tw    全台：三個機房與 8 處據點（island.ts）
//   world 海外：時區桌（zones.ts）
// 要畫什麼（哪個系統什麼狀態、哪條介面在跑、哪個據點在上班）全部來自 core/twin.ts 與 core/sites.ts，
// 跟 2D 的頁面讀的是同一份。這個檔案不自己算任何業務資料。
//
// 質感是建築事務所拍白模的照片：霧面、低飽和、正交鏡頭、一盞主光加柔和的陰影。
// 主光跟著台北的時間走，重播月結日的 24 小時會看到影子移動、入夜後變暗。
// 沒有發光、沒有粒子、不會自己轉。

const MAX_SLIPS = 96;
/** 滑過或選了某樣東西時，跟它無關的紙片退成這個顏色。 */
const SLIP_DIM = 0xc9ced3;
const SUN_HIGH = new Color(0xfffcf6);
const SUN_LOW = new Color(0xffeedb);
const MOON = new Color(0xbfcfe9);

export type TwinView = 'hq' | 'tw' | 'world';
/** 點了之後會發生的事：選一樣東西，或是換比例尺。 */
export type TwinPick = PickTarget | { kind: 'view'; id: TwinView };

export interface TwinLabel {
  /** 同時是標籤要貼的位置（anchor）的名字，例如 system:crm、site:br-tc。 */
  key: string;
  /**
   * system、site：有引線的標籤，會自己錯開；floor：樓層的標高；tick：時區桌前緣的刻度；
   * 其他就貼在位置上。
   */
  kind: 'system' | 'site' | 'floor' | 'region' | 'link' | 'tick' | 'note';
  text: string;
  title: string;
  health?: Health;
  selected?: boolean;
  affected?: boolean;
  /** 比較不重要、字淡一點（下班的據點、晚上的刻度）。 */
  quiet?: boolean;
  /** 有給就是按鈕，可以點、可以用鍵盤選。 */
  pick?: TwinPick;
}

export interface TwinPlaces {
  island: IslandPlaces;
  zones: ZonePlace[];
}

export interface TwinFrame {
  view: TwinView;
  model: TwinModel;
  sites: SitesModel | null;
  selected: Selection;
  labels: TwinLabel[];
  ariaLabel: string;
}

export interface TwinOptions {
  container: HTMLElement;
  labelLayer: HTMLElement;
  places: TwinPlaces;
  /** 一開始顯示哪個比例尺。 */
  view: TwinView;
  lowFx: boolean;
  /** 使用者要求減少動態：小紙片不移動，光線不漸變，只在狀態改變時重畫。 */
  still: boolean;
  onPick(target: TwinPick): void;
}

export interface TwinHandle {
  update(frame: TwinFrame): void;
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
  tags: string[];
}

function pathOf(points: Vector3[]): Pick<Slip, 'path' | 'lengths' | 'total'> {
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  return {
    path: points,
    lengths,
    total: Math.max(
      lengths.reduce((a, b) => a + b, 0),
      1e-3,
    ),
  };
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
 * 幾點鐘的光線長什麼樣。base 是鏡頭的方位：主光永遠從鏡頭的左前方慢慢移到右前方，中午最高，
 * 所以不管哪個比例尺，影子都落在看得到的那一側。
 * 天亮前與天黑後換成比較暗、偏冷的光，機房自己的燈相對就亮了。
 */
function moodAt(hour: number, base: number, out: Mood): Mood {
  const day = smooth((hour - 5) / 2) * (1 - smooth((hour - 17) / 2));
  const t = clamp01((hour - 6) / 12);
  const height = Math.sin(Math.PI * t);
  aim(base - 70, 46, out.dir)
    .lerp(aim(base - 92 + 100 * t, 22 + 16 * height, scratchDir), day)
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

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
const hits = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const pickKey = (pick: TwinPick) => `${pick.kind}:${pick.id}`;

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
  container.appendChild(renderer.domElement);

  const scene = new Scene();

  // ── 三個比例尺的模型：用到才蓋，蓋好就留著
  const stages = new Map<TwinView, Stage>();
  function stageOf(view: TwinView): Stage {
    let made = stages.get(view);
    if (!made) {
      made =
        view === 'hq' ? buildHq(opts.places.island.branches.map((b) => b.id)) : view === 'tw' ? buildIsland(opts.places.island) : buildZones(opts.places.zones);
      made.group.visible = false;
      scene.add(made.group);
      stages.set(view, made);
    }
    return made;
  }
  let view: TwinView = opts.view;
  let stage = stageOf(view);
  const center = new Vector3();
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Vector3());

  // ── 光線：一盞會投影的主光、一層天光、右前方一盞很弱的補光，加上機房自己的燈
  const sky = new HemisphereLight(0xffffff, 0xdddcda, 1);
  scene.add(sky);
  const sun = new DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2.2;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0xe9eff8, 0.6);
  scene.add(fill);
  const room = new PointLight(0xfff0d8, 2, 9, 1.6);
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

  const mood = newMood();
  const moodFrom = newMood();
  const moodGoal = newMood();
  let moodT = 1;
  let moodHour = -1;
  function applyMood(): void {
    sun.position.copy(center).addScaledVector(mood.dir, 30);
    sun.intensity = mood.sun;
    sun.color.copy(mood.sunColor);
    sky.intensity = mood.sky;
    fill.intensity = mood.fill;
    room.intensity = stage.roomLight ? mood.room : 0;
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
  /** 現在要標出來的東西（system:crm、site:br-tc…）：滑鼠滑過的優先，其次是選取的。 */
  let hovered: string | null = null;
  let chosen: string | null = null;

  function colorSlips(): void {
    const hot = hovered ?? chosen;
    for (let i = 0; i < slips.length; i++) slipMesh.setColorAt(i, tint.setHex(hot && !slips[i].tags.includes(hot) ? SLIP_DIM : slips[i].color));
    if (slipMesh.instanceColor) slipMesh.instanceColor.needsUpdate = true;
  }

  function buildSlips(specs: SlipSpec[]): void {
    slips = [];
    specs.forEach((spec, n) => {
      const path = pathOf(spec.path);
      // 路線太多的時候每條少放幾張，總數不超過上限
      const count = Math.min(spec.count, Math.floor((MAX_SLIPS - slips.length) / Math.max(1, specs.length - n)) || 1);
      for (let k = 0; k < count && slips.length < MAX_SLIPS; k++) {
        slips.push({ ...path, offset: (path.total / count) * k + n * 0.37, speed: spec.speed, color: spec.color, tags: spec.tags });
      }
    });
    slipMesh.count = slips.length;
    colorSlips();
  }

  function placeSlips(seconds: number): void {
    slips.forEach((slip, i) => {
      const segment = pointAt(slip, slip.offset + seconds * slip.speed, point);
      const a = slip.path[segment];
      const b = slip.path[segment + 1];
      dummy.position.copy(point);
      // 紙片的長邊順著它正在走的那一段
      dummy.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      dummy.scale.setScalar(stage.slipScale);
      dummy.updateMatrix();
      slipMesh.setMatrixAt(i, dummy.matrix);
    });
    slipMesh.instanceMatrix.needsUpdate = true;
  }

  // ── 鏡頭：正交、固定的斜上方視角。可以小幅轉動與縮放，但不會自己轉
  const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 200);
  const home = new Vector3();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.minZoom = 0.9;
  controls.maxZoom = 3.2;
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
    for (const corner of stage.outline) {
      probe.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, probe.x);
      maxX = Math.max(maxX, probe.x);
      minY = Math.min(minY, probe.y);
      maxY = Math.max(maxY, probe.y);
    }
    const pad = 10;
    // 上方要留給有引線的標籤；畫面矮的時候少留一點
    const padTop = Math.min(stage.view.padTop, h * 0.14);
    let padLeft = pad;
    // 先照模型本身取景，再看最左邊的樓層標籤有沒有被切到；被切到就把左邊的留白加大，重算一次
    for (let pass = 0; pass < 3; pass++) {
      const scale = Math.min((w - padLeft - pad) / (maxX - minX), (h - pad - padTop) / (maxY - minY));
      const left = minX - padLeft / scale - (w / scale - (maxX - minX) - (padLeft + pad) / scale) / 2;
      const bottom = minY - pad / scale - (h / scale - (maxY - minY) - (pad + padTop) / scale) / 2;
      camera.left = left;
      camera.right = left + w / scale;
      camera.bottom = bottom;
      camera.top = bottom + h / scale;
      camera.updateProjectionMatrix();
      let edge = Infinity;
      for (const [key, anchor] of stage.anchors) if (key.startsWith('floor:')) edge = Math.min(edge, toScreen(anchor, w, h)[0] - floorWide);
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

  /** 換比例尺：換一個模型上桌，鏡頭、光線、陰影的範圍都跟著換。 */
  function show(next: TwinView): void {
    stage.group.visible = false;
    view = next;
    stage = stageOf(next);
    stage.group.visible = true;
    stage.bounds.getCenter(center);
    corners.forEach((corner, n) => {
      corner.set(
        n & 1 ? stage.bounds.max.x : stage.bounds.min.x,
        n & 2 ? stage.bounds.max.y : stage.bounds.min.y,
        n & 4 ? stage.bounds.max.z : stage.bounds.min.z,
      );
    });
    table.position.set(center.x, stage.bounds.min.y - 0.01, center.z);
    sun.target.position.copy(center);
    aim(stage.view.azimuth, stage.view.elevation, home).multiplyScalar(40);
    // 補光固定在鏡頭的右前方
    aim(stage.view.azimuth + 25, 20, fill.position)
      .multiplyScalar(20)
      .add(center);
    [controls.minAzimuthAngle, controls.maxAzimuthAngle] = stage.view.azimuthRange;
    [controls.minPolarAngle, controls.maxPolarAngle] = stage.view.polarRange;
    if (stage.roomLight) room.position.copy(stage.roomLight);
    applyFx();
    hovered = null;
    // 先給一個白天的光，下一次 update 會換成當時的光線
    moodAt(10, stage.view.azimuth, mood);
    moodT = 1;
    moodHour = -1;
    applyMood();
    resetView();
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

  // ── 標籤：疊在畫面上的 HTML，位置由 3D 座標投影而來。可以點的標籤是按鈕，可以用鍵盤選取
  interface LabelEl {
    spec: TwinLabel;
    el: HTMLElement;
    stem: HTMLElement | null;
    w: number;
    h: number;
  }
  let labelEls: LabelEl[] = [];
  /** 樓層標籤裡最寬的有幾個像素寬。 */
  let floorWide = 60;
  const pinned = (kind: TwinLabel['kind']) => kind === 'system' || kind === 'site';

  function setLabels(labels: TwinLabel[]): void {
    const same =
      labels.length === labelEls.length &&
      labels.every((l, i) => labelEls[i].spec.key === l.key && labelEls[i].spec.kind === l.kind && !labelEls[i].spec.pick === !l.pick);
    let resized = !same;
    if (!same) {
      labelLayer.replaceChildren();
      labelEls = labels.map((spec) => {
        const el = document.createElement(spec.pick ? 'button' : 'span');
        if (el instanceof HTMLButtonElement) el.type = 'button';
        let stem: HTMLElement | null = null;
        if (pinned(spec.kind)) {
          // 引線：從標籤垂直接到它指的東西
          stem = document.createElement('i');
          stem.className = 'twin-stem';
          labelLayer.appendChild(stem);
        }
        labelLayer.appendChild(el);
        return { spec: { ...spec, text: '' }, el, stem, w: 0, h: 0 };
      });
    }
    labels.forEach((spec, i) => {
      const item = labelEls[i];
      const { el, stem } = item;
      if (item.spec.text !== spec.text) {
        el.textContent = spec.text;
        resized = true;
      }
      el.className = `twin-label is-${spec.kind}${spec.selected ? ' is-selected' : ''}${spec.affected ? ' is-affected' : ''}${spec.quiet ? ' is-quiet' : ''}${
        hovered && spec.pick && pickKey(spec.pick) === hovered ? ' is-hover' : ''
      }`;
      el.title = spec.title;
      if (spec.pick) {
        el.dataset.pick = pickKey(spec.pick);
        el.setAttribute('aria-label', spec.title);
        if (spec.selected) el.setAttribute('aria-pressed', 'true');
        else el.removeAttribute('aria-pressed');
      }
      // 舊的測試與樣式認這兩個屬性
      if (spec.kind === 'system') el.dataset.system = spec.key.slice(7);
      if (spec.health) el.dataset.health = spec.health;
      else delete el.dataset.health;
      if (stem) {
        if (spec.health) stem.dataset.health = spec.health;
        else delete stem.dataset.health;
      }
      item.spec = spec;
    });
    if (resized) {
      for (const item of labelEls) {
        // 被收起來的標籤量不到大小，先放出來量
        const was = item.el.hidden;
        item.el.hidden = false;
        item.w = item.el.offsetWidth;
        item.h = item.el.offsetHeight;
        item.el.hidden = was;
      }
      floorWide = Math.max(40, ...labelEls.filter((l) => l.spec.kind === 'floor').map((l) => l.w));
      // 換語言之後標籤寬度不一樣，取景要跟著重算
      frame();
    }
  }

  const projected = new Vector3();
  function toScreen(anchor: Vector3, w: number, h: number): [number, number] {
    projected.copy(anchor).project(camera);
    return [((projected.x + 1) / 2) * w, ((1 - projected.y) / 2) * h];
  }

  function placeLabels(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const pins: { item: LabelEl; x: number; y: number }[] = [];
    const ticks: { item: LabelEl; x: number }[] = [];
    const fixed: Rect[] = [];
    for (const item of labelEls) {
      const anchor = stage.anchors.get(item.spec.key);
      item.el.hidden = !anchor;
      if (item.stem) item.stem.hidden = !anchor;
      if (!anchor) continue;
      const [x, y] = toScreen(anchor, w, h);
      if (pinned(item.spec.kind)) {
        pins.push({ item, x, y });
        continue;
      }
      if (item.spec.kind === 'tick') ticks.push({ item, x });
      // 樓層的標籤靠右下角對齊位置，其他的置中
      else if (item.spec.kind === 'floor') fixed.push({ l: x - item.w, r: x, t: y - item.h, b: y });
      else fixed.push({ l: x - item.w / 2, r: x + item.w / 2, t: y - item.h / 2, b: y + item.h / 2 });
      item.el.style.left = `${x}px`;
      item.el.style.top = `${y}px`;
    }
    // 有引線的標籤：從兩邊往中間一個一個放。每個標籤由低到高找位置，同一個高度先試置中，
    // 再試掛在引線的右邊或左邊（像旗子）；不能壓到別的標籤與引線，也不能擋住還沒放的標籤要走的那一直線。
    pins.sort((a, b) => a.x - b.x || a.y - b.y);
    const order: typeof pins = [];
    for (let lo = 0, hi = pins.length - 1; lo <= hi; ) {
      order.push(pins[lo++]);
      if (lo <= hi) order.push(pins[hi--]);
    }
    // 樓層、區域這些直接貼在位置上的標籤先佔好位子，有引線的標籤要避開它們
    const taken: Rect[] = fixed;
    const waiting = new Set(order);
    for (const pin of order) {
      const { item, x, y } = pin;
      waiting.delete(pin);
      let lift = 6;
      let side = 0;
      let found = false;
      for (let level = 0; level < 9 && !found; level++) {
        for (const tryside of [0, 1, -1]) {
          const l = tryside === 0 ? x - item.w / 2 : tryside > 0 ? x - 1 : x + 1 - item.w;
          const top = y - 6 - level * (item.h + 3) - item.h;
          const box = { l: l - 2, r: l + item.w + 2, t: top, b: top + item.h };
          const stemBox = { l: x - 1, r: x + 1, t: box.b, b: y };
          // 不能超出畫面左右兩邊
          if (box.l < 0 || box.r > w) continue;
          if (taken.some((other) => hits(other, box) || hits(other, stemBox))) continue;
          if ([...waiting].some((other) => hits({ l: other.x - 2, r: other.x + 2, t: -1e4, b: other.y }, box))) continue;
          lift = y - box.b;
          side = tryside;
          found = true;
          break;
        }
      }
      const left = side === 0 ? x - item.w / 2 : side > 0 ? x - 1 : x + 1 - item.w;
      taken.push({ l: left - 2, r: left + item.w + 2, t: y - lift - item.h, b: y - lift }, { l: x - 1, r: x + 1, t: y - lift, b: y });
      item.el.classList.toggle('is-flag-r', side > 0);
      item.el.classList.toggle('is-flag-l', side < 0);
      item.el.style.left = `${side === 0 ? x : side > 0 ? x - 1 : x + 1}px`;
      item.el.style.top = `${y - lift}px`;
      if (item.stem) {
        item.stem.style.left = `${x}px`;
        item.stem.style.top = `${y - lift}px`;
        item.stem.style.height = `${lift}px`;
      }
    }
    // 刻度太擠的時候隔幾個才顯示一個
    if (ticks.length > 1) {
      const gap = Math.abs(ticks[1].x - ticks[0].x);
      const widest = Math.max(...ticks.map((t) => t.item.w));
      const every = Math.max(1, Math.ceil((widest + 3) / Math.max(gap, 1)));
      ticks.forEach((tick, i) => {
        tick.item.el.hidden = i % every !== 0;
      });
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

  // ── 點選與滑過
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  function pick(event: PointerEvent): PickTarget | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(stage.pickables, false)[0];
    return (hit?.object.userData.pick as PickTarget | undefined) ?? null;
  }
  /** 滑過（或用鍵盤移到）一樣東西：它的標籤亮起來，跟它無關的紙片退到背景。 */
  function hover(key: string | null): void {
    if (key === hovered) return;
    hovered = key;
    for (const { spec, el } of labelEls) el.classList.toggle('is-hover', !!key && !!spec.pick && pickKey(spec.pick) === key);
    colorSlips();
    if (!raf) draw();
  }
  let downAt: [number, number] | null = null;
  const onDown = (event: PointerEvent) => {
    downAt = [event.clientX, event.clientY];
  };
  const onUp = (event: PointerEvent) => {
    // 拖曳轉動鏡頭不算點選
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const target = pick(event);
    if (target) opts.onPick(target);
  };
  const onMove = (event: PointerEvent) => {
    const target = pick(event);
    renderer.domElement.style.cursor = target ? 'pointer' : 'grab';
    hover(target ? pickKey(target) : null);
  };
  const onLeave = () => hover(null);
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);

  const labelOf = (event: Event) => labelEls.find((l) => l.el === (event.target as HTMLElement).closest('[data-pick]'));
  const onLabelClick = (event: Event) => {
    const spec = labelOf(event)?.spec;
    if (spec?.pick) opts.onPick(spec.pick);
  };
  const onLabelOver = (event: Event) => {
    const spec = labelOf(event)?.spec;
    if (spec?.pick) hover(pickKey(spec.pick));
  };
  const onLabelOut = () => hover(null);
  /** 方向鍵在同一種標籤之間移動：機櫃由左到右、樓層由下到上。 */
  const onLabelKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    const from = labelOf(event);
    if (!step || !from) return;
    const peers = labelEls.filter((l) => l.spec.kind === from.spec.kind && l.spec.pick && !l.el.hidden);
    const next = peers[peers.indexOf(from) + step];
    if (!next) return;
    event.preventDefault();
    next.el.focus();
  };
  labelLayer.addEventListener('click', onLabelClick);
  labelLayer.addEventListener('pointerover', onLabelOver);
  labelLayer.addEventListener('pointerout', onLabelOut);
  labelLayer.addEventListener('focusin', onLabelOver);
  labelLayer.addEventListener('focusout', onLabelOut);
  labelLayer.addEventListener('keydown', onLabelKey);

  let current: TwinFrame | null = null;
  function update(next: TwinFrame): void {
    if (next.view !== view) show(next.view);
    current = next;
    renderer.domElement.setAttribute('aria-label', next.ariaLabel);
    const paint: Paint = { model: next.model, sites: next.sites, selected: next.selected, lowFx };
    stage.paint(paint);
    const { system, floor, site, region } = next.selected;
    chosen = system ? `system:${system}` : floor ? `floor:${floor}` : site ? `site:${site}` : region ? `region:${region}` : null;
    buildSlips(stage.slips(paint));
    setLabels(next.labels);
    // 光線跟著時間走：第一次與換比例尺時直接套用，之後用半秒多一點漸變過去
    const hour = stage.fixedLight ? 11 : next.model.hour;
    if (hour !== moodHour) {
      const jump = moodHour < 0 || opts.still || lowFx;
      moodHour = hour;
      moodAt(hour, stage.view.azimuth, moodGoal);
      if (jump) {
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
    room.castShadow = !lowFx && stage.roomLight !== null;
    renderer.shadowMap.needsUpdate = true;
  }

  show(view);
  resize();

  return {
    update,
    setLowFx(low) {
      lowFx = low || software;
      applyFx();
      resize();
      if (current) update(current);
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
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      labelLayer.removeEventListener('click', onLabelClick);
      labelLayer.removeEventListener('pointerover', onLabelOver);
      labelLayer.removeEventListener('pointerout', onLabelOut);
      labelLayer.removeEventListener('focusin', onLabelOver);
      labelLayer.removeEventListener('focusout', onLabelOut);
      labelLayer.removeEventListener('keydown', onLabelKey);
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
