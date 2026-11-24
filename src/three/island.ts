import {
  Box3,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  type MeshStandardMaterial,
  Object3D,
  Shape,
  Vector3,
} from 'three';
import type { DcId, RegionId } from '../core/types';
import { aimAt, Batch, flat, hitBox, Marks, matte, PALETTE, type Paint, SLIP_OK, type SlipSpec, type Stage, spread, TONE } from './kit';

// 比例尺二「全台」：一座疊板做的台灣，放在一塊海的底板上。
// 三個機房（總行、異地備援、廠商代管）與 8 處營業據點照所在城市擺位置，
// 沿著西部走廊的一條帶子是骨幹線路，小紙片沿著它在據點與機房之間移動。
//
// 這是示意模型，不是地圖：海岸線只取了三十個點，靠太近的據點會被推開一點才不會疊在一起。
// 鏡頭從西邊看過來，所以北在左、南在右，西部平原（據點都在這一側）朝著觀看的人。

type LonLat = [lon: number, lat: number];

const K = 4; // 緯度一度是幾個單位
const LON0 = 120.95;
const LAT0 = 23.6;
const COS = Math.cos((LAT0 * Math.PI) / 180);
const toX = (lon: number) => (lon - LON0) * COS * K;
const toZ = (lat: number) => -(lat - LAT0) * K;

const SEA = 0.14; // 海面（底板的頂面）
const LAND = SEA + 0.14; // 平地
const LAYER = 0.075; // 每一層疊板的厚度

/** 本島的海岸線，從北端順時針。概略值。 */
const COAST: LonLat[] = [
  [121.54, 25.3],
  [121.75, 25.15],
  [122.0, 25.01],
  [121.83, 24.85],
  [121.87, 24.6],
  [121.75, 24.3],
  [121.63, 23.98],
  [121.52, 23.6],
  [121.38, 23.1],
  [121.17, 22.75],
  [121.0, 22.6],
  [120.9, 22.35],
  [120.85, 21.9],
  [120.73, 21.92],
  [120.7, 22.08],
  [120.58, 22.37],
  [120.45, 22.47],
  [120.27, 22.62],
  [120.15, 23.0],
  [120.05, 23.13],
  [120.13, 23.38],
  [120.18, 23.78],
  [120.4, 24.07],
  [120.5, 24.28],
  [120.67, 24.5],
  [120.9, 24.83],
  [121.05, 25.05],
  [121.28, 25.13],
  [121.42, 25.18],
];
/** 中央山脈的走向。疊板往這條線收，疊出山的樣子。 */
const SPINE: LonLat[] = [
  [121.5, 24.62],
  [121.27, 24.2],
  [121.05, 23.5],
  [120.87, 22.8],
  [120.8, 22.35],
];
/** 北、中、南三區的分界（緯度）。苗栗以北是北區，嘉義以南是南區。 */
const BANDS: { id: Exclude<RegionId, 'overseas'>; from: number; to: number }[] = [
  { id: 'north', from: 24.55, to: 90 },
  { id: 'central', from: 23.6, to: 24.55 },
  { id: 'south', from: -90, to: 23.6 },
];
const BAND_GAP = 0.012;
/** 區域標籤放在東邊外海。 */
const REGION_AT: Record<Exclude<RegionId, 'overseas'>, LonLat> = { north: [122.12, 24.75], central: [121.95, 24.05], south: [121.7, 22.95] };

/** 把多邊形切掉一半：keep 回傳正數的那一側留下來。 */
function clip(poly: LonLat[], keep: (p: LonLat) => number): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = keep(a);
    const db = keep(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** 把一個點往中央山脈的方向移動：amount 是比例（0 不動、1 移到山脈上）。 */
function toward(p: LonLat, amount: number): LonLat {
  let best: LonLat = SPINE[0];
  let bestD = Infinity;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const [ax, ay] = SPINE[i];
    const [bx, by] = SPINE[i + 1];
    const t = Math.min(1, Math.max(0, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    const q: LonLat = [ax + (bx - ax) * t, ay + (by - ay) * t];
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return [p[0] + (best[0] - p[0]) * amount, p[1] + (best[1] - p[1]) * amount];
}

/** 海岸線上每個點往山脈的方向收進去一個比例，得到上一層疊板的輪廓。 */
const pulled = (amount: number): LonLat[] => COAST.map((p) => toward(p, amount));

/** 一片疊板：把輪廓往上長出厚度。 */
function plate(group: Group, outline: LonLat[], bottom: number, height: number, material: MeshStandardMaterial): Mesh {
  const shape = new Shape();
  outline.forEach(([lon, lat], i) => {
    // 形狀畫在 XY 平面上，長出厚度之後整片躺平：形狀的 y 變成場景的 -z
    if (i) shape.lineTo(toX(lon), -toZ(lat));
    else shape.moveTo(toX(lon), -toZ(lat));
  });
  const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = bottom;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export interface IslandPlaces {
  branches: { id: string; lon: number; lat: number; staff: number; regionId: Exclude<RegionId, 'overseas'> }[];
  dcs: { id: DcId; lon: number; lat: number }[];
}

/** 骨幹線路經過的點，由北到南。其他的點（總公司營業部、備援中心、廠商機房）用支線接上去。 */
const BACKBONE = ['dc-hq', 'br-bq', 'br-ty', 'br-hc', 'br-tc', 'br-cy', 'br-tn', 'br-kh'];
const SPUR: Record<string, string> = { 'br-hq': 'dc-hq', 'dc-dr': 'br-tc', 'dc-vendor': 'br-tn' };
const LANES = 3;
const LANE_GAP = 0.085;
// 鏡頭幾乎正對著西岸，抬得比較高：島橫躺在畫面上（北在左），輪廓才認得出來
const VIEW: Stage['view'] = { azimuth: -80, elevation: 48, azimuthRange: [-1.55, -0.95], polarRange: [0.5, 1.05], padTop: 26 };

export function buildIsland(places: IslandPlaces): Stage {
  const group = new Group();
  const boxes = new Batch(new BoxGeometry(1, 1, 1));
  const cones = new Batch(new ConeGeometry(0.5, 1, 4));
  const tubes = new Batch(new CylinderGeometry(0.5, 0.5, 1, 16));
  const pickables: Mesh[] = [];
  const anchors = new Map<string, Vector3>();

  // ── 底板與海
  const x0 = toX(119.92);
  const x1 = toX(122.3);
  const z0 = toZ(25.48);
  const z1 = toZ(21.72);
  boxes.add([x1 - x0 + 0.5, 0.2, z1 - z0 + 0.5], [(x0 + x1) / 2, -0.2, (z0 + z1) / 2], PALETTE.plinth);
  boxes.add([x1 - x0, SEA, z1 - z0], [(x0 + x1) / 2, 0, (z0 + z1) / 2], PALETTE.sea);

  // ── 島：最下面一層照北中南切成三片（各自可以換顏色），上面三層往山脈收
  const regions = new Map<string, MeshStandardMaterial>();
  for (const band of BANDS) {
    const piece = clip(
      clip(COAST, (p) => p[1] - band.from - BAND_GAP),
      (p) => band.to - BAND_GAP - p[1],
    );
    const material = matte(PALETTE.white);
    const mesh = plate(group, piece, SEA, LAND - SEA, material);
    mesh.userData.pick = { kind: 'region', id: band.id };
    pickables.push(mesh);
    regions.set(band.id, material);
    const [lon, lat] = REGION_AT[band.id];
    anchors.set(`region:${band.id}`, new Vector3(toX(lon), SEA + 0.02, toZ(lat)));
  }
  const hill = matte(PALETTE.white);
  [0.62, 0.78, 0.9].forEach((amount, i) => {
    plate(group, pulled(amount), LAND + i * LAYER, LAYER, hill);
  });

  // ── 據點與機房的位置：照經緯度擺，靠太近的推開
  const ids = [...places.dcs.map((d) => d.id as string), ...places.branches.map((b) => b.id)];
  // 城市多半貼著海岸，房子照實擺會有一半掛在海上，所以每個點先往山脈的方向收進來一點
  const raw = [...places.dcs, ...places.branches].map((p) => {
    const [lon, lat] = toward([p.lon, p.lat], 0.1);
    return { x: toX(lon), z: toZ(lat) };
  });
  const at = new Map(spread(raw, 0.9).map((p, i) => [ids[i], new Vector3(p.x, LAND, p.z)]));
  const pos = (id: string) => at.get(id) ?? new Vector3(0, LAND, 0);

  // ── 線路：骨幹是一條淺色的帶子，支線細一點
  const nodes = BACKBONE.filter((id) => at.has(id));
  for (let i = 0; i < nodes.length - 1; i++) boxes.strip(pos(nodes[i]), pos(nodes[i + 1]), LANE_GAP * LANES + 0.06, 0.012, PALETTE.line);
  for (const id of nodes) tubes.add([LANE_GAP * LANES + 0.06, 0.012, LANE_GAP * LANES + 0.06], [pos(id).x, LAND, pos(id).z], PALETTE.line);
  for (const [id, to] of Object.entries(SPUR)) if (at.has(id) && at.has(to)) boxes.strip(pos(id), pos(to), 0.14, 0.012, PALETTE.line);

  /** 從 a 走到 b 的路：先接上骨幹，沿著骨幹走，再接到目的地。lane 決定走帶子上的哪一道。 */
  function route(a: string, b: string, lane: number): Vector3[] {
    const shift = ((lane % LANES) - (LANES - 1) / 2) * LANE_GAP;
    const entry = (id: string) => nodes.indexOf(SPUR[id] ?? id);
    const from = entry(a);
    const to = entry(b);
    const path: Vector3[] = [];
    const put = (p: Vector3) => path.push(new Vector3(p.x + shift, LAND + 0.03, p.z));
    if (SPUR[a]) put(pos(a));
    const step = to >= from ? 1 : -1;
    for (let i = from; ; i += step) {
      put(pos(nodes[i]));
      if (i === to) break;
    }
    if (SPUR[b]) put(pos(b));
    return path.length > 1 ? path : [path[0], path[0].clone()];
  }

  // ── 三個機房：各用自己的材質，停擺時整棟換顏色
  const dcBody = new Map<DcId, MeshStandardMaterial>();
  const top = new Map<string, number>();
  const block = (id: DcId, size: [number, number, number], lift = 0) => {
    const material = dcBody.get(id) ?? matte(PALETTE.white);
    dcBody.set(id, material);
    const p = pos(id);
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(p.x, LAND + lift + size[1] / 2, p.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  if (at.has('dc-hq')) {
    // 總行：一層一層疊起來的小塔，跟剖面模型的五層樓對得上
    const p = pos('dc-hq');
    boxes.add([0.4, 1.2, 0.4], [p.x, LAND, p.z], PALETTE.detail);
    for (let k = 0; k < 5; k++) block('dc-hq', [0.62, 0.17, 0.62], 0.02 + k * 0.24);
    boxes.add([0.26, 0.13, 0.26], [p.x, LAND + 1.19, p.z], PALETTE.furniture);
    top.set('dc-hq', 1.34);
  }
  if (at.has('dc-dr')) {
    // 備援中心：一棟矮而寬的機房，朝西的那一面有一排機櫃門
    const p = pos('dc-dr');
    block('dc-dr', [0.6, 0.42, 0.9]);
    for (let k = 0; k < 5; k++) boxes.add([0.014, 0.28, 0.11], [p.x - 0.307, LAND + 0.05, p.z - 0.33 + k * 0.165], PALETTE.detail);
    boxes.add([0.26, 0.1, 0.26], [p.x + 0.06, LAND + 0.42, p.z + 0.2], PALETTE.furniture);
    top.set('dc-dr', 0.55);
  }
  if (at.has('dc-vendor')) {
    // 廠商機房：屋頂墊高一截，跟自家的機房分得出來
    const p = pos('dc-vendor');
    block('dc-vendor', [0.56, 0.34, 0.7]);
    for (const [dx, dz] of [
      [-0.21, -0.28],
      [0.21, -0.28],
      [-0.21, 0.28],
      [0.21, 0.28],
    ])
      boxes.add([0.05, 0.1, 0.05], [p.x + dx, LAND + 0.34, p.z + dz], PALETTE.detail);
    boxes.add([0.64, 0.045, 0.78], [p.x, LAND + 0.44, p.z], PALETTE.furniture);
    top.set('dc-vendor', 0.5);
  }

  // ── 營業據點：小房子，人多的大一點
  for (const b of places.branches) {
    const p = pos(b.id);
    const side = 0.4 + Math.min(b.staff, 64) / 320;
    const height = 0.28 + Math.min(b.staff, 64) / 260;
    boxes.add([side, height, side], [p.x, LAND, p.z], PALETTE.white);
    cones.add([side * 1.5, 0.24, side * 1.5], [p.x, LAND + height, p.z], PALETTE.furniture, Math.PI / 4);
    top.set(b.id, height + 0.24);
  }
  for (const id of ids) {
    const p = pos(id);
    const height = top.get(id) ?? 0.4;
    pickables.push(hitBox(group, [0.8, height + 0.3, 0.8], [p.x, LAND + (height + 0.3) / 2, p.z], { kind: 'site', id }));
    anchors.set(`site:${id}`, new Vector3(p.x, LAND + height + 0.3, p.z));
  }

  // ── 指北：底板西北角的一支箭頭
  const north = new Vector3(x0 + 0.75, SEA, z0 + 1.5);
  boxes.add([0.05, 0.012, 0.8], [north.x, SEA, north.z + 0.3], PALETTE.detail);
  cones.add([0.34, 0.012, 0.34], [north.x, SEA, north.z - 0.2], PALETTE.detail, Math.PI);
  anchors.set('note:north', new Vector3(north.x, SEA, north.z - 0.55));

  boxes.build(group);
  cones.build(group);
  tubes.build(group);

  // ── 會變的零件
  const marks = new Marks(group, ids.length, 1.15, aimAt(VIEW.azimuth, VIEW.elevation));
  // 等核准的簽呈：據點旁邊的一疊紙，幾件就幾張
  const sheets = new InstancedMesh(new BoxGeometry(0.24, 0.016, 0.17), matte(PALETTE.white), 96);
  sheets.instanceMatrix.setUsage(DynamicDrawUsage);
  sheets.castShadow = true;
  sheets.receiveShadow = true;
  sheets.frustumCulled = false;
  sheets.count = 0;
  group.add(sheets);
  // 備援中心門口的小方塊：現在有幾個系統在這裡跑
  const units = new InstancedMesh(new BoxGeometry(0.1, 0.2, 0.1), matte(PALETTE.rack), 9);
  units.instanceMatrix.setUsage(DynamicDrawUsage);
  units.castShadow = true;
  units.frustumCulled = false;
  units.count = 0;
  group.add(units);
  const ring = new Mesh(new CylinderGeometry(0.56, 0.56, 0.016, 32), flat(PALETTE.primary));
  ring.visible = false;
  group.add(ring);
  const dummy = new Object3D();

  function paint({ model, sites, selected }: Paint): void {
    if (!sites) return;
    // 區域裡的據點連不上時，整片換成偏紅的霧面色；被選取的區域換成偏冷的顏色
    for (const region of sites.regions)
      regions.get(region.id)?.color.setHex(region.health === 'crit' ? PALETTE.affected : region.id === selected.region ? PALETTE.picked : PALETTE.white);
    ids.forEach((id, i) => {
      const dc = sites.dcs.find((d) => d.id === id);
      const site = sites.sites.find((s) => s.id === id);
      const p = pos(id);
      marks.set(i, new Vector3(p.x, LAND + (top.get(id) ?? 0.4) + 0.18, p.z), dc?.health ?? site?.health ?? null);
      if (dc) dcBody.get(dc.id)?.color.setHex(dc.down.length || (dc.id === 'dc-hq' && model.drill) ? PALETTE.affected : PALETTE.white);
    });
    let n = 0;
    for (const site of sites.sites) {
      if (site.kind !== 'branch' || !at.has(site.id)) continue;
      const p = pos(site.id);
      for (let k = 0; k < site.pendingApprovals && n < 96; k++, n++) {
        dummy.position.set(p.x - 0.42, LAND + 0.008 + k * 0.019, p.z + 0.16);
        dummy.rotation.set(0, (((k * 37 + n) % 5) - 2) * 0.09, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        sheets.setMatrixAt(n, dummy.matrix);
      }
    }
    sheets.count = n;
    sheets.instanceMatrix.needsUpdate = true;
    const running = sites.dcs.find((d) => d.id === 'dc-dr')?.running.length ?? 0;
    const dr = pos('dc-dr');
    for (let k = 0; k < running; k++) {
      dummy.position.set(dr.x - 0.5, LAND + 0.1, dr.z - 0.4 + k * 0.13);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      units.setMatrixAt(k, dummy.matrix);
    }
    units.count = running;
    units.instanceMatrix.needsUpdate = true;
    const picked = selected.site && at.has(selected.site) ? pos(selected.site) : null;
    ring.visible = picked !== null;
    if (picked) ring.position.set(picked.x, LAND + 0.008, picked.z);
  }

  function slips({ sites, lowFx }: Paint): SlipSpec[] {
    if (!sites) return [];
    const out: SlipSpec[] = [];
    let lane = 0;
    for (const site of sites.sites) {
      // 下班之後據點沒有往來，線上就沒有紙片
      if (site.kind !== 'branch' || !site.open || !at.has(site.id)) continue;
      out.push({
        path: route(site.id, site.home, lane++),
        count: lowFx ? 1 : site.level,
        speed: site.health === 'crit' ? 0 : 0.55 + site.level * 0.25,
        color: site.health === 'ok' ? SLIP_OK : TONE[site.health],
        tags: [`site:${site.id}`, `region:${site.regionId}`, `site:${site.home}`],
      });
    }
    for (const trunk of sites.trunks) {
      if (!trunk.active || !at.has(trunk.from) || !at.has(trunk.to)) continue;
      out.push({
        path: route(trunk.from, trunk.to, lane++),
        count: lowFx ? 1 : Math.min(3, trunk.level),
        speed: trunk.health === 'crit' ? 0 : 0.6 + trunk.level * 0.2,
        color: trunk.health === 'ok' ? SLIP_OK : TONE[trunk.health],
        tags: [`site:${trunk.from}`, `site:${trunk.to}`, ...(trunk.id === 'vendor' ? ['system:crm'] : [])],
      });
    }
    return out;
  }

  return {
    group,
    anchors,
    pickables,
    view: VIEW,
    slipScale: 0.7,
    fixedLight: false,
    roomLight: null,
    paint,
    slips,
    bounds: new Box3(new Vector3(x0 - 0.25, -0.2, z0 - 0.25), new Vector3(x1 + 0.25, LAND + 1.7, z1 + 0.25)),
    outline: [
      ...[-0.2, SEA].flatMap((y) => [
        new Vector3(x0 - 0.25, y, z0 - 0.25),
        new Vector3(x0 - 0.25, y, z1 + 0.25),
        new Vector3(x1 + 0.25, y, z0 - 0.25),
        new Vector3(x1 + 0.25, y, z1 + 0.25),
      ]),
      ...(at.has('dc-hq') ? [new Vector3(pos('dc-hq').x, LAND + 1.6, pos('dc-hq').z)] : []),
    ],
  };
}
