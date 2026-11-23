import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FLOORS, RACKS, type TwinModel } from '../core/twin';
import type { Domain, Health, SystemId } from '../core/types';

// 3D 微縮總行：一棟剖開的總行。樓層是單位，地下機房的機櫃是系統，旁邊一排小房子是營業據點；
// 沿著機房管線移動的小紙片是傳票與簽呈，速度代表流量、顏色代表狀態。
//
// 這個檔案只負責「畫」。要畫什麼（哪個系統什麼狀態、哪條介面在跑、哪層樓受影響）全部來自
// core/twin.ts 的 twinModel()，跟 2D 的頁面讀的是同一份。
//
// 質感是建築事務所的白模：霧面、低飽和、正交鏡頭。沒有發光、沒有粒子、不會自己轉。

const WHITE = 0xf3f2ee;
const FURNITURE = 0xdde0e1;
const GROUND = 0xe5e7e6;
const SOIL = 0xd3d6d4;
const RACK = 0xc5cbcf;
const EDGE = 0x9aa3a9;
const PRIMARY = 0x1d3a56;
const AFFECTED = 0xe7c5c0;
const TONE: Record<Health, number> = { ok: 0x25714b, warn: 0xb26f0c, crit: 0xa3271f };
const SLIP_OK = 0x8792a0;

const W = 9; // 建築的寬（x）
const D = 4; // 建築的深（z）
const B1 = 1.6; // 地下一樓的高度，也是地面的高度
const FLOOR_H = 1.25;
const RACK_GAP = 0.9;
const MAX_SLIPS = 96;

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
  lowFx: boolean;
  /** 使用者要求減少動態：小紙片不移動，只在狀態改變時重畫。 */
  still: boolean;
  onSelect(id: SystemId): void;
}

export interface TwinHandle {
  update(model: TwinModel, selected: SystemId | null): void;
  setLabels(labels: TwinLabel[]): void;
  setLowFx(low: boolean): void;
  dispose(): void;
}

const rackX = (id: SystemId) => (RACKS.indexOf(id) - (RACKS.length - 1) / 2) * RACK_GAP;
const floorY = (level: number) => B1 + level * FLOOR_H;

const matte = (color: number) => new MeshStandardMaterial({ color, roughness: 1, metalness: 0 });

/** 一個有細邊線的方塊：白模靠邊線把體積交代清楚。 */
function block(
  group: Group,
  size: [number, number, number],
  at: [number, number, number],
  color: number,
  opts: { shadow?: boolean; edges?: boolean } = {},
): Mesh<BoxGeometry, MeshStandardMaterial> {
  const geometry = new BoxGeometry(...size);
  const mesh = new Mesh(geometry, matte(color));
  mesh.position.set(...at);
  mesh.castShadow = opts.shadow ?? true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (opts.edges ?? true) {
    const lines = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: EDGE }));
    lines.position.copy(mesh.position);
    group.add(lines);
  }
  return mesh;
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

function pointAt(slip: Slip, distance: number, out: Vector3): void {
  let left = ((distance % slip.total) + slip.total) % slip.total;
  for (let i = 0; i < slip.lengths.length; i++) {
    if (left <= slip.lengths[i]) {
      out.lerpVectors(slip.path[i], slip.path[i + 1], slip.lengths[i] ? left / slip.lengths[i] : 0);
      return;
    }
    left -= slip.lengths[i];
  }
  out.copy(slip.path[slip.path.length - 1]);
}

/**
 * 建立 3D 場景。瀏覽器沒有 WebGL 時，WebGLRenderer 的建構式會丟例外；
 * 呼叫的人接住之後改顯示同一份資料的清單。
 */
export function createTwin(opts: TwinOptions): TwinHandle {
  const { container, labelLayer } = opts;
  let lowFx = opts.lowFx;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.shadowMap.enabled = !lowFx;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', opts.ariaLabel);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.55));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(-9, 16, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const world = new Group();
  scene.add(world);

  // ── 地面：建築兩側的地面與底下的土層，機房才看得出是在地下
  block(world, [21, 0.12, D + 3], [2.5, -0.06, 0], GROUND, { shadow: false });
  for (const [x, width] of [
    [-(W / 2 + 1.75), 3.3],
    [W / 2 + 4.3, 8.4],
  ]) {
    block(world, [width, B1 - 0.12, D + 3], [x, (B1 - 0.12) / 2, 0], SOIL, { shadow: false, edges: false });
    block(world, [width, 0.12, D + 3], [x, B1 - 0.06, 0], GROUND, { shadow: false });
  }

  // ── 建築：每一層是樓板、背牆與兩側的牆；正面不做牆，所以看得到裡面（剖面）
  const slabs = new Map<Domain, Mesh<BoxGeometry, MeshStandardMaterial>>();
  const levels = FLOORS.length + 1; // 地下一樓加五層
  for (let i = 0; i < levels; i++) {
    const y = i === 0 ? 0 : floorY(i - 1);
    const h = i === 0 ? B1 : FLOOR_H;
    const slab = block(world, [W, 0.1, D], [0, y + 0.05, 0], WHITE);
    block(world, [W, h - 0.1, 0.1], [0, y + 0.1 + (h - 0.1) / 2, -D / 2 + 0.05], WHITE);
    block(world, [0.1, h - 0.1, D], [-W / 2 + 0.05, y + 0.1 + (h - 0.1) / 2, 0], WHITE);
    block(world, [0.1, h - 0.1, D], [W / 2 - 0.05, y + 0.1 + (h - 0.1) / 2, 0], WHITE);
    if (i > 0) {
      slabs.set(FLOORS[i - 1].domain, slab);
      // 桌子：兩排，每排四張
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) block(world, [1.2, 0.34, 0.5], [-3.1 + col * 2.05, y + 0.27, -0.9 + row * 1.35], FURNITURE, { edges: false });
      }
    }
  }
  block(world, [W + 0.3, 0.12, D + 0.3], [0, floorY(FLOORS.length) + 0.06, 0], WHITE);

  // ── 機房：九個機櫃。機櫃上方的小標記用形狀表示狀態（圓是正常、三角是注意、方塊是中斷）
  const racks = new Map<SystemId, Mesh<BoxGeometry, MeshStandardMaterial>>();
  const marks = new Map<SystemId, Record<Health, Mesh>>();
  const risers = new Map<SystemId, Mesh<BoxGeometry, MeshStandardMaterial>>();
  const markShapes: Record<Health, () => Mesh> = {
    ok: () => new Mesh(new SphereGeometry(0.1, 16, 12), matte(TONE.ok)),
    warn: () => new Mesh(new ConeGeometry(0.13, 0.22, 3), matte(TONE.warn)),
    crit: () => new Mesh(new BoxGeometry(0.19, 0.19, 0.19), matte(TONE.crit)),
  };
  for (const id of RACKS) {
    const x = rackX(id);
    const rack = block(world, [0.5, 1.0, 0.55], [x, 0.6, -0.9], RACK);
    rack.userData.systemId = id;
    racks.set(id, rack);
    const set = {} as Record<Health, Mesh>;
    for (const health of ['ok', 'warn', 'crit'] as const) {
      const mark = markShapes[health]();
      mark.position.set(x, 1.3, -0.9);
      mark.visible = false;
      world.add(mark);
      set[health] = mark;
    }
    marks.set(id, set);
    // 機櫃到樓上的立管，貼著背牆
    risers.set(
      id,
      block(world, [0.05, floorY(FLOORS.length) - 1.2, 0.05], [x, 1.2 + (floorY(FLOORS.length) - 1.2) / 2, -D / 2 + 0.16], FURNITURE, {
        shadow: false,
        edges: false,
      }),
    );
  }
  // 機房地上的管線槽：小紙片沿著它在機櫃之間移動
  block(world, [RACK_GAP * RACKS.length + 0.4, 0.04, 0.9], [0, 0.12, 0.35], FURNITURE, { shadow: false });

  // ── 營業據點：右邊地面上的一排小房子
  const houses: Mesh<BoxGeometry, MeshStandardMaterial>[] = [];
  for (let i = 0; i < 8; i++) {
    const x = W / 2 + 1.2 + i * 0.95;
    houses.push(block(world, [0.6, 0.5, 0.6], [x, B1 + 0.25, 0.4], WHITE));
    const roof = new Mesh(new ConeGeometry(0.5, 0.32, 4), matte(FURNITURE));
    roof.position.set(x, B1 + 0.66, 0.4);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    world.add(roof);
  }

  // ── 小紙片：一個 InstancedMesh 畫全部
  const slipMesh = new InstancedMesh(new BoxGeometry(0.2, 0.02, 0.13), new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }), MAX_SLIPS);
  slipMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  slipMesh.count = 0;
  world.add(slipMesh);
  let slips: Slip[] = [];
  const dummy = new Object3D();
  const point = new Vector3();
  const tint = new Color();

  function buildSlips(model: TwinModel): void {
    slips = [];
    const active = model.flows.filter((f) => f.active);
    active.forEach((flow, n) => {
      const lane = 0.12 + (n % 6) * 0.1;
      const from = rackX(flow.from);
      const to = rackX(flow.to);
      const y = 0.17;
      const points = [new Vector3(from, y, -0.55), new Vector3(from, y, lane)];
      if (flow.viaEsb) points.push(new Vector3(rackX('esb'), y, lane), new Vector3(rackX('esb'), y, -0.5), new Vector3(rackX('esb'), y, lane));
      points.push(new Vector3(to, y, lane), new Vector3(to, y, -0.55));
      const path = pathOf(points);
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
      pointAt(slip, slip.offset + seconds * slip.speed, point);
      dummy.position.copy(point);
      dummy.updateMatrix();
      slipMesh.setMatrixAt(i, dummy.matrix);
    });
    slipMesh.instanceMatrix.needsUpdate = true;
  }

  // ── 鏡頭：正交、固定的斜上方視角。可以小幅轉動與縮放，但不會自己轉
  const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  const target = new Vector3(2.6, 3.6, 0);
  camera.position.set(target.x + 9, target.y + 7.5, target.z + 16);
  camera.lookAt(target);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minPolarAngle = 0.95;
  controls.maxPolarAngle = 1.45;
  controls.minAzimuthAngle = -0.15;
  controls.maxAzimuthAngle = 0.95;
  controls.update();

  // ── 標籤：疊在畫面上的 HTML 按鈕，位置由 3D 座標投影而來。機櫃的標籤可以用鍵盤選取
  const anchors = new Map<string, Vector3>();
  // 機櫃靠得近，標籤一高一低錯開才不會疊在一起
  for (const id of RACKS) anchors.set(`system:${id}`, new Vector3(rackX(id), RACKS.indexOf(id) % 2 ? 1.5 : 1.02, -0.6));
  for (let i = 0; i < FLOORS.length; i++) anchors.set(`floor:${FLOORS[i].domain}`, new Vector3(-W / 2 - 0.15, floorY(i) + 0.62, D / 2));
  anchors.set('branches:all', new Vector3(W / 2 + 4.5, B1 + 1.25, 0.4));
  let labelEls = new Map<string, HTMLElement>();

  function setLabels(labels: TwinLabel[]): void {
    labelLayer.replaceChildren();
    labelEls = new Map();
    for (const label of labels) {
      const el = document.createElement(label.kind === 'system' ? 'button' : 'span');
      el.className = `twin-label is-${label.kind}`;
      el.textContent = label.text;
      el.title = label.title;
      if (el instanceof HTMLButtonElement) {
        el.type = 'button';
        el.dataset.system = label.id;
        el.setAttribute('aria-label', label.title);
      }
      labelLayer.appendChild(el);
      labelEls.set(`${label.kind}:${label.id}`, el);
    }
    placeLabels();
  }

  const projected = new Vector3();
  function placeLabels(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const [key, el] of labelEls) {
      const anchor = anchors.get(key);
      if (!anchor) continue;
      projected.copy(anchor).project(camera);
      el.style.left = `${((projected.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - projected.y) / 2) * h}px`;
    }
  }

  function resize(): void {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const aspect = w / h;
    // 以寬度為準把整個場景放進畫面；畫面很窄的時候改以高度為準
    const halfW = Math.max(10.4, 5.7 * aspect);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfW / aspect;
    camera.bottom = -halfW / aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(lowFx ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    draw();
  }

  let seconds = 0;
  function draw(): void {
    placeSlips(seconds);
    renderer.render(scene, camera);
    placeLabels();
  }

  // ── 動畫迴圈：只有在看得到、分頁在前景、而且使用者沒有要求減少動態時才跑
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let disposed = false;
  let frameNo = 0;
  const shouldRun = () => !disposed && !opts.still && onScreen && !document.hidden && slips.some((s) => s.speed > 0);
  function frame(now: number): void {
    raf = 0;
    if (!shouldRun()) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    seconds += dt;
    // 降低特效：每兩幀畫一次
    if (!lowFx || frameNo++ % 2 === 0) draw();
    raf = requestAnimationFrame(frame);
  }
  function sync(): void {
    if (shouldRun() && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
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
  const pickables = [...racks.values()];
  function pick(event: PointerEvent): SystemId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return (hit?.object.userData.systemId as SystemId | undefined) ?? null;
  }
  let downAt: [number, number] | null = null;
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
    renderer.domElement.style.cursor = pick(event) ? 'pointer' : 'grab';
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
      const set = marks.get(sys.id);
      if (set) for (const health of ['ok', 'warn', 'crit'] as const) set[health].visible = health === sys.health;
      const rack = racks.get(sys.id);
      if (rack) rack.material.color.setHex(sys.id === selected ? PRIMARY : model.down.includes(sys.id) ? TONE.crit : RACK);
      const riser = risers.get(sys.id);
      if (riser) riser.material.color.setHex(model.down.includes(sys.id) ? TONE.crit : sys.health === 'ok' ? FURNITURE : TONE[sys.health]);
      labelEls.get(`system:${sys.id}`)?.classList.toggle('is-selected', sys.id === selected);
      labelEls.get(`system:${sys.id}`)?.setAttribute('data-health', sys.health);
    }
    // 受影響的樓層：樓板換成偏紅的霧面色。不是發光，只是換了材質的顏色
    for (const floor of model.floors) {
      slabs.get(floor.domain)?.material.color.setHex(floor.affected ? AFFECTED : WHITE);
      labelEls.get(`floor:${floor.domain}`)?.classList.toggle('is-affected', floor.affected);
    }
    for (const house of houses) house.material.color.setHex(model.affected?.domains.includes('sales') ? AFFECTED : WHITE);
    buildSlips(model);
    renderer.shadowMap.needsUpdate = true;
    draw();
    sync();
  }

  setLabels(opts.labels);
  resize();

  return {
    update,
    setLabels,
    setLowFx(low) {
      lowFx = low;
      renderer.shadowMap.enabled = !low;
      sun.castShadow = !low;
      resize();
      sync();
    },
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
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
    },
  };
}
