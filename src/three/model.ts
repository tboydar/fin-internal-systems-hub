import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { FLOORS, RACKS } from '../core/twin';
import type { Domain, Health, SystemId } from '../core/types';

// 微縮總行的「模型」：一棟沿著正面剖開的總行，放在一塊底板上。
// 這個檔案只蓋不會動的東西（結構、家具、機房、據點），回傳之後會換顏色的那幾個零件。
// 會動的小紙片、光線、鏡頭與標籤在 twin.ts。
//
// 畫法照建築剖面模型的習慣：
// - 被剖到的面（樓板、牆、土層的正面）填深色，一眼看得出哪裡是切面
// - 其餘都是霧面的白，靠光影交代體積，不描邊
// - 每層樓的家具不一樣，不看標籤也分得出是哪個單位

type V3 = [number, number, number];

export const PALETTE = {
  white: 0xf5f4f1,
  furniture: 0xe9eaea,
  detail: 0xaeb7bf,
  glass: 0xc9d3db,
  ground: 0xe8e9e7,
  road: 0xd8dcde,
  earth: 0xdcdedd,
  strata: 0xc3c8cb,
  cut: 0x485663,
  plinth: 0x35444f,
  rack: 0xcdd3d8,
  tray: 0xdcdfe2,
  figure: 0x8996a3,
  tree: 0xe6e8e4,
  primary: 0x1d3a56,
  affected: 0xecc9c4,
} as const;

export const TONE: Record<Health, number> = { ok: 0x25714b, warn: 0xb26f0c, crit: 0xa3271f };

export const W = 9; // 建築的寬（x）
export const D = 4; // 建築的深（z）
export const B1 = 2.3; // 地下一樓的高度，也是地面的高度
export const FLOOR_H = 1.2;
const T = 0.1; // 樓板與牆的厚度
export const FRONT = D / 2; // 剖面所在的平面
const LEFT = -W / 2 - 0.9;
const RIGHT = W / 2 + 5.4;
const BACK = -D / 2 - 1.1;

export const RACK_GAP = 0.86;
// 整排機櫃往左靠：鏡頭在右前方，太靠右會被右邊的牆擋住
const RACK_SHIFT = -0.45;
// 機櫃靠前放：太靠後的話，上緣會被一樓樓板的前緣擋住
export const RACK_Z = 0.15;
const RACK_H = 1.05;
const RACK_BASE = T + 0.06;
export const RACK_TOP = RACK_BASE + RACK_H;
/** 小紙片走的高度：機房地上輸送帶的表面。 */
export const BELT_Y = T + 0.05;
export const BELT_Z0 = 0.98;
export const BELT_LANES = 5;
export const BELT_LANE_GAP = 0.13;

export const rackX = (id: SystemId) => RACK_SHIFT + (RACKS.indexOf(id) - (RACKS.length - 1) / 2) * RACK_GAP;
export const floorY = (level: number) => B1 + level * FLOOR_H;
const TOP = floorY(FLOORS.length);

const UP = new Vector3(0, 1, 0);
const matte = (color: number) => new MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
const flat = (color: number) => new MeshBasicMaterial({ color });

/** 同一種形狀的許多小零件合成一個 InstancedMesh，整批只算一次繪製。 */
class Batch {
  private items: { matrix: Matrix4; color: number }[] = [];
  constructor(private geometry: BufferGeometry) {}

  /** at 是零件「底部中心」的位置，擺家具時不必自己加半個高度。 */
  add(size: V3, at: V3, color: number, turn = 0): void {
    const position = new Vector3(at[0], at[1] + size[1] / 2, at[2]);
    this.items.push({ matrix: new Matrix4().compose(position, new Quaternion().setFromAxisAngle(UP, turn), new Vector3(...size)), color });
  }

  build(parent: Group): void {
    const mesh = new InstancedMesh(this.geometry, matte(0xffffff), this.items.length);
    const tint = new Color();
    this.items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, tint.setHex(item.color));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

/** 結構用的方塊。cut 有給的話，朝正面（+z）的那一面用切面的材質。 */
function solid(group: Group, size: V3, center: V3, body: Material, cut?: Material): Mesh {
  // BoxGeometry 六個面的順序是 +x、-x、+y、-y、+z、-z
  const mesh = new Mesh(new BoxGeometry(...size), cut ? [body, body, body, body, cut, body] : body);
  mesh.position.set(...center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export interface TwinScene {
  group: Group;
  /** 每層樓的樓板：受影響時樓板換成偏紅的霧面色，切面換成中斷的顏色。 */
  floors: Map<Domain, { slab: MeshStandardMaterial; cut: MeshBasicMaterial }>;
  racks: Map<SystemId, Mesh<BoxGeometry, MeshStandardMaterial>>;
  /** 選取時機櫃腳下的一圈。 */
  rings: Map<SystemId, Mesh>;
  /** 機櫃上方的狀態標記：圓是正常、三角是注意、方塊是中斷。 */
  marks: Map<SystemId, Record<Health, Mesh>>;
  /** 所有據點小房子共用的材質，換顏色時一次換完。 */
  houses: MeshStandardMaterial;
  /** 標籤要貼的位置。 */
  anchors: Map<string, Vector3>;
  /** 整個模型的範圍，陰影用它決定要算多大。 */
  bounds: Box3;
  /** 模型輪廓上的幾個點，鏡頭用它把模型剛好放進畫面。 */
  outline: Vector3[];
}

export function buildModel(branchCount: number): TwinScene {
  const group = new Group();
  const boxes = new Batch(new BoxGeometry(1, 1, 1));
  const tubes = new Batch(new CylinderGeometry(0.5, 0.5, 1, 20));
  const balls = new Batch(new SphereGeometry(0.5, 16, 12));
  const crowns = new Batch(new IcosahedronGeometry(0.5, 1));

  const white = matte(PALETTE.white);
  const cut = flat(PALETTE.cut);
  const ground = matte(PALETTE.ground);
  const earth = matte(PALETTE.earth);

  /** 模型裡的小人：一個圓柱加一顆頭。只是比例尺，數量不代表任何數字。 */
  const figure = (x: number, y: number, z: number) => {
    tubes.add([0.15, 0.3, 0.15], [x, y, z], PALETTE.figure);
    balls.add([0.13, 0.13, 0.13], [x, y + 0.31, z], PALETTE.figure);
  };
  /** 一張桌子：桌面加兩片側板。monitors 是桌上的螢幕數；seated 是桌子後面有沒有人。 */
  const desk = (x: number, y: number, z: number, monitors = 1, seated = false) => {
    boxes.add([0.92, 0.04, 0.46], [x, y + 0.24, z], PALETTE.furniture);
    boxes.add([0.04, 0.24, 0.42], [x - 0.42, y, z], PALETTE.furniture);
    boxes.add([0.04, 0.24, 0.42], [x + 0.42, y, z], PALETTE.furniture);
    for (let m = 0; m < monitors; m++) boxes.add([0.26, 0.17, 0.025], [x + (m - (monitors - 1) / 2) * 0.3, y + 0.28, z + 0.1], PALETTE.detail);
    if (seated) figure(x, y, z - 0.4);
  };
  const tree = (x: number, z: number, size = 1) => {
    tubes.add([0.05, 0.26 * size, 0.05], [x, B1, z], PALETTE.detail);
    crowns.add([0.5 * size, 0.56 * size, 0.5 * size], [x, B1 + 0.2 * size, z], PALETTE.tree, x * 1.7);
  };

  // ── 底板與基地：基地是一整塊，正面沿著剖面切齊，所以看得到地面以下
  solid(group, [RIGHT - LEFT + 0.7, 0.2, FRONT - BACK + 0.7], [(LEFT + RIGHT) / 2, -0.1, (BACK + FRONT) / 2], matte(PALETTE.plinth));
  for (const [x0, x1, z1] of [
    [LEFT, -W / 2, FRONT],
    [W / 2, RIGHT, FRONT],
    [-W / 2, W / 2, -D / 2],
  ]) {
    // 頂面是地面的顏色，其餘是土層
    const piece = new Mesh(new BoxGeometry(x1 - x0, B1, z1 - BACK), [earth, earth, ground, earth, earth, earth]);
    piece.position.set((x0 + x1) / 2, B1 / 2, (BACK + z1) / 2);
    piece.castShadow = true;
    piece.receiveShadow = true;
    group.add(piece);
    // 土層的切面刻一道一道的橫線，像一層一層疊起來的模型板
    if (z1 === FRONT) for (let y = 0.3; y < B1 - 0.1; y += 0.3) boxes.add([x1 - x0, 0.014, 0.006], [(x0 + x1) / 2, y, FRONT], PALETTE.strata);
  }

  // ── 結構：背牆與兩側的牆從地下一路到屋頂，樓板夾在中間；正面不做牆
  solid(group, [W, TOP, T], [0, TOP / 2, -D / 2 + T / 2], white);
  solid(group, [T, TOP, D - T], [-W / 2 + T / 2, TOP / 2, T / 2], white, cut);
  solid(group, [T, TOP, D - T], [W / 2 - T / 2, TOP / 2, T / 2], white, cut);
  solid(group, [W - 2 * T, T, D - T], [0, T / 2, T / 2], white, cut);
  const floors: TwinScene['floors'] = new Map();
  FLOORS.forEach((floor, i) => {
    const slab = matte(PALETTE.white);
    const slabCut = flat(PALETTE.cut);
    solid(group, [W - 2 * T, T, D - T], [0, floorY(i) + T / 2, T / 2], slab, slabCut);
    floors.set(floor.domain, { slab, cut: slabCut });
  });

  // ── 屋頂：樓板、女兒牆、樓梯間與空調設備
  solid(group, [W + 0.3, 0.14, D + 0.15], [0, TOP + 0.07, -0.075], white, cut);
  const roofY = TOP + 0.14;
  solid(group, [W + 0.3, 0.24, 0.08], [0, roofY + 0.12, -D / 2 - 0.11], white);
  solid(group, [0.08, 0.24, D + 0.07], [-W / 2 - 0.11, roofY + 0.12, -0.035], white, cut);
  solid(group, [0.08, 0.24, D + 0.07], [W / 2 + 0.11, roofY + 0.12, -0.035], white, cut);
  boxes.add([1.05, 0.62, 1.5], [-3.9, roofY, -1.15], PALETTE.white);
  boxes.add([1.3, 0.36, 0.8], [1.2, roofY, -0.9], PALETTE.furniture);
  boxes.add([0.8, 0.3, 0.8], [2.9, roofY, 0.4], PALETTE.furniture);
  boxes.add([0.5, 0.05, 0.5], [1.2, roofY + 0.36, -0.9], PALETTE.detail);
  tubes.add([0.62, 0.5, 0.62], [-0.9, roofY, -1.05], PALETTE.furniture);

  // ── 電梯與樓梯間：從一樓貫穿到屋頂，每層樓一扇門
  boxes.add([0.95, TOP - B1 - T, 1.5], [-3.925, B1 + T, -1.15], PALETTE.white);

  // ── 每一層樓
  const bays = [-2.35, -0.45, 1.45, 3.35];
  FLOORS.forEach((floor, i) => {
    const y = floorY(i) + T;
    boxes.add([0.42, 0.72, 0.02], [-3.925, y, -0.39], PALETTE.detail);
    // 背牆的窗：每一跨兩片
    for (const bay of bays) for (const side of [-0.38, 0.38]) boxes.add([0.7, 0.5, 0.02], [bay + side, y + 0.36, -D / 2 + T + 0.011], PALETTE.glass);
    // 右側外牆的窗；一樓留給大門
    for (const z of [-1.3, -0.45, 0.4, 1.25]) {
      if (i === 0 && z > 0) continue;
      boxes.add([0.02, 0.5, 0.62], [W / 2 + 0.011, y + 0.36, z], PALETTE.glass);
    }

    if (floor.domain === 'sales') {
      // 營業廳：一長條櫃檯，後面是行員，前面是等候的長椅
      boxes.add([5.6, 0.34, 0.34], [0.5, y, -0.7], PALETTE.furniture);
      boxes.add([5.7, 0.04, 0.44], [0.5, y + 0.34, -0.7], PALETTE.white);
      for (const x of [-1.6, -0.2, 1.2, 2.6]) boxes.add([0.03, 0.2, 0.3], [x, y + 0.38, -0.7], PALETTE.glass);
      boxes.add([5.6, 0.66, 0.22], [0.5, y, -1.72], PALETTE.furniture);
      for (const x of [-0.9, 0.5, 1.9]) figure(x, y, -1.15);
      for (const x of [-1.6, 0, 1.6]) boxes.add([0.95, 0.14, 0.3], [x, y, 1.0], PALETTE.furniture);
      figure(0.5, y, -0.25);
      figure(2.4, y, 0.55);
      // 大門與雨遮，在右側外牆
      boxes.add([0.02, 0.84, 0.4], [W / 2 + 0.011, y, 0.42], PALETTE.glass);
      boxes.add([0.02, 0.84, 0.4], [W / 2 + 0.011, y, 0.86], PALETTE.glass);
      boxes.add([0.75, 0.05, 1.3], [W / 2 + 0.375, y + 0.9, 0.64], PALETTE.white);
    } else if (floor.domain === 'finance') {
      // 財務：兩排辦公桌，背牆一整排檔案櫃，角落一座保險櫃
      for (const [n, x] of [-2.2, -0.5, 1.2, 2.9].entries()) {
        desk(x, y, -0.55, 1, n % 2 === 0);
        desk(x, y, 0.95, 1, n % 2 === 1);
      }
      for (let k = 0; k < 6; k++) boxes.add([0.5, 0.6, 0.3], [-2.9 + k * 0.54, y, -1.7], PALETTE.furniture);
      boxes.add([0.7, 0.82, 0.52], [3.9, y, -1.58], PALETTE.detail);
    } else if (floor.domain === 'hr') {
      // 人資：左邊是辦公桌，右邊是兩間面談室，前面一張圓桌
      desk(-2.2, y, -0.55, 1, true);
      desk(-0.6, y, -0.55);
      desk(-2.2, y, 0.95);
      desk(-0.6, y, 0.95, 1, true);
      boxes.add([0.05, 0.85, 1.7], [1.5, y, -1.05], PALETTE.furniture);
      boxes.add([0.05, 0.85, 1.7], [2.95, y, -1.05], PALETTE.furniture);
      boxes.add([0.85, 0.42, 0.05], [2.05, y, -0.2], PALETTE.furniture);
      boxes.add([0.85, 0.42, 0.05], [3.5, y, -0.2], PALETTE.furniture);
      for (const x of [2.22, 3.67]) boxes.add([0.5, 0.24, 0.5], [x, y, -1.1], PALETTE.furniture);
      figure(2.22, y, -1.55);
      figure(2.22, y, -0.65);
      tubes.add([0.9, 0.24, 0.9], [2.6, y, 1.05], PALETTE.furniture);
      figure(2.0, y, 1.3);
      figure(3.2, y, 0.85);
    } else if (floor.domain === 'procurement') {
      // 採購：辦公桌、靠牆的貨架、一張放樣品的長桌、堆在棧板上的箱子
      for (const [n, x] of [-2.2, -0.5, 1.2].entries()) {
        desk(x, y, -0.55, 1, n === 1);
        desk(x, y, 0.95, 1, n !== 1);
      }
      for (const z of [-1.5, -0.6]) {
        boxes.add([1.5, 0.82, 0.32], [3.5, y, z], PALETTE.furniture);
        for (const h of [0.27, 0.54]) boxes.add([1.54, 0.03, 0.36], [3.5, y + h, z], PALETTE.detail);
      }
      boxes.add([1.25, 0.26, 0.55], [3.4, y, 1.0], PALETTE.furniture);
      for (const [k, x] of [3.0, 3.35, 3.75].entries()) boxes.add([0.22, 0.14 + k * 0.03, 0.22], [x, y + 0.26, 1.0], PALETTE.white, k * 0.4);
      boxes.add([0.62, 0.04, 0.62], [2.45, y, 0.1], PALETTE.detail);
      for (const [dx, dz, lift] of [
        [-0.15, -0.15, 0],
        [0.15, -0.15, 0],
        [-0.15, 0.15, 0],
        [0.15, 0.15, 0],
        [0, 0, 0.24],
      ]) {
        boxes.add([0.28, 0.24, 0.28], [2.45 + dx, y + 0.04 + lift, 0.1 + dz], PALETTE.white, lift ? 0.5 : 0);
      }
      figure(2.75, y, 1.5);
    } else {
      // 資訊：雙螢幕的辦公桌、矮牆隔出來的網路機房、一張站著開會的高桌
      for (const [n, x] of [-2.2, -0.5, 1.2].entries()) {
        desk(x, y, -0.55, 2, n !== 0);
        desk(x, y, 0.95, 2, n === 0);
      }
      boxes.add([2.0, 0.5, 0.05], [3.35, y, -0.45], PALETTE.furniture);
      boxes.add([0.05, 0.5, 1.4], [2.35, y, -1.15], PALETTE.furniture);
      for (const x of [2.8, 3.3, 3.8]) boxes.add([0.34, 0.74, 0.42], [x, y, -1.5], PALETTE.rack);
      boxes.add([1.0, 0.38, 0.5], [3.3, y, 1.0], PALETTE.furniture);
      figure(2.9, y, 1.45);
      figure(3.7, y, 1.45);
    }
  });

  // ── 機房：九個機櫃站在高架地板上，上方是線槽，前面是送紙片的輸送帶
  const racks: TwinScene['racks'] = new Map();
  const rings: TwinScene['rings'] = new Map();
  const marks: TwinScene['marks'] = new Map();
  const span = RACK_GAP * (RACKS.length - 1);
  boxes.add([W - 2 * T, 0.06, RACK_Z + 0.36 + D / 2 - T], [0, T, (RACK_Z + 0.36 - D / 2 + T) / 2], PALETTE.furniture);
  boxes.add([span + 0.5, 0.04, 0.28], [RACK_SHIFT, B1 - 0.34, RACK_Z - 0.18], PALETTE.furniture);
  boxes.add([span + 0.9, 0.03, BELT_LANE_GAP * (BELT_LANES - 1) + 0.3], [RACK_SHIFT, T, BELT_Z0 + (BELT_LANE_GAP * (BELT_LANES - 1)) / 2], PALETTE.tray);
  const markShapes: Record<Health, () => Mesh> = {
    ok: () => new Mesh(new SphereGeometry(0.11, 20, 14), flat(TONE.ok)),
    warn: () => new Mesh(new ConeGeometry(0.14, 0.23, 3), flat(TONE.warn)),
    crit: () => new Mesh(new BoxGeometry(0.2, 0.2, 0.2), flat(TONE.crit)),
  };
  for (const id of RACKS) {
    const x = rackX(id);
    const rack = new Mesh(new BoxGeometry(0.56, RACK_H, 0.6), matte(PALETTE.rack));
    rack.position.set(x, RACK_BASE + RACK_H / 2, RACK_Z);
    rack.castShadow = true;
    rack.receiveShadow = true;
    rack.userData.systemId = id;
    group.add(rack);
    racks.set(id, rack);
    for (let k = 0; k < 5; k++) boxes.add([0.4, 0.035, 0.012], [x, RACK_BASE + 0.2 + k * 0.2, RACK_Z + 0.306], PALETTE.detail);
    boxes.add([0.03, B1 - 0.34 - RACK_TOP, 0.03], [x, RACK_TOP, RACK_Z - 0.18], PALETTE.furniture);
    boxes.add([0.2, 0.03, 0.5], [x, T, RACK_Z + 0.3 + 0.25], PALETTE.tray);
    const ring = new Mesh(new BoxGeometry(0.8, 0.03, 0.84), flat(PALETTE.primary));
    ring.position.set(x, RACK_BASE + 0.015, RACK_Z);
    ring.visible = false;
    group.add(ring);
    rings.set(id, ring);
    const set = {} as Record<Health, Mesh>;
    for (const health of ['ok', 'warn', 'crit'] as const) {
      const mark = markShapes[health]();
      mark.position.set(x, RACK_TOP + 0.19, RACK_Z + 0.05);
      mark.visible = false;
      group.add(mark);
      set[health] = mark;
    }
    marks.set(id, set);
  }
  // 值班的人，站在機櫃與輸送帶之間
  figure(rackX('esb') + RACK_GAP / 2, T, RACK_Z + 0.55);

  // ── 營業據點：右邊地面上的小房子，沿著一條路排兩排；路從總行的大門接出去
  const houses = matte(PALETTE.white);
  const perRow = Math.ceil(branchCount / 2);
  const roadZ = 0.64;
  boxes.add([RIGHT - W / 2 - 0.5, 0.012, 0.62], [(RIGHT + W / 2) / 2 - 0.25, B1, roadZ], PALETTE.road);
  const roof = matte(PALETTE.furniture);
  for (let n = 0; n < branchCount; n++) {
    const row = n < perRow ? 0 : 1;
    const col = row === 0 ? n : n - perRow;
    const x = W / 2 + 1.25 + col * 1.02;
    const z = row === 0 ? roadZ - 0.98 : roadZ + 0.92;
    // 大小略有不同，看起來才像一條街；變化量由順序決定，每次都一樣
    const height = 0.4 + ((n * 7) % 4) * 0.045;
    const body = solid(group, [0.6, height, 0.56], [x, B1 + height / 2, z], houses);
    body.name = `branch-${n}`;
    const top = new Mesh(new ConeGeometry(0.47, 0.3, 4), roof);
    top.position.set(x, B1 + height + 0.15, z);
    top.rotation.y = Math.PI / 4;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);
  }
  for (const [x, z, size] of [
    [W / 2 + 0.62, roadZ - 0.95, 1],
    [W / 2 + 0.7, 1.55, 0.85],
    [RIGHT - 0.45, roadZ - 0.9, 0.9],
    [RIGHT - 0.5, roadZ + 0.95, 1.05],
    [W / 2 + 1.6, -2.3, 1.15],
    [W / 2 + 2.5, -2.55, 0.9],
    [W / 2 + 3.7, -2.25, 1.05],
    [W / 2 + 4.6, -2.6, 0.85],
  ]) {
    tree(x, z, size);
  }
  figure(W / 2 + 0.55, B1, 0.3);
  figure(W / 2 + 2.3, B1, roadZ + 0.1);
  figure(W / 2 + 3.6, B1, roadZ - 0.15);

  boxes.build(group);
  tubes.build(group);
  balls.build(group);
  crowns.build(group);

  const anchors = new Map<string, Vector3>();
  for (const id of RACKS) anchors.set(`system:${id}`, new Vector3(rackX(id), RACK_TOP + 0.36, RACK_Z + 0.05));
  for (const [i, floor] of FLOORS.entries()) anchors.set(`floor:${floor.domain}`, new Vector3(-W / 2, floorY(i) + T, FRONT));
  anchors.set('branches:all', new Vector3(W / 2 + 1.25 + ((perRow - 1) * 1.02) / 2, B1 + 1.2, roadZ - 0.98));

  return {
    group,
    floors,
    racks,
    rings,
    marks,
    houses,
    anchors,
    bounds: new Box3(new Vector3(LEFT - 0.35, -0.2, BACK - 0.35), new Vector3(RIGHT + 0.35, roofY + 0.62, FRONT + 0.35)),
    outline: [
      ...[-0.2, B1].flatMap((y) => [
        new Vector3(LEFT - 0.35, y, BACK - 0.35),
        new Vector3(LEFT - 0.35, y, FRONT + 0.35),
        new Vector3(RIGHT + 0.35, y, BACK - 0.35),
        new Vector3(RIGHT + 0.35, y, FRONT + 0.35),
      ]),
      ...[-1, 1].flatMap((side) => [
        new Vector3((side * (W + 0.3)) / 2, roofY + 0.24, -D / 2 - 0.15),
        new Vector3((side * (W + 0.3)) / 2, roofY + 0.24, FRONT),
      ]),
      new Vector3(-4.43, roofY + 0.62, -1.9),
      new Vector3(-3.37, roofY + 0.62, -1.9),
      new Vector3(RIGHT, B1 + 1.0, BACK),
    ],
  };
}

/**
 * 一條介面的小紙片要走的路：從來源機櫃前面走到輸送帶，沿著輸送帶到目的機櫃，再走進去。
 * 經過整合層的介面會先繞進整合層的機櫃一趟。lane 決定走輸送帶上的哪一道。
 */
export function slipRoute(from: SystemId, to: SystemId, viaEsb: boolean, lane: number): Vector3[] {
  const z = BELT_Z0 + (lane % BELT_LANES) * BELT_LANE_GAP;
  const door = RACK_Z + 0.34;
  const at = (id: SystemId, depth: number) => new Vector3(rackX(id), BELT_Y, depth);
  const points = [at(from, door), at(from, z)];
  if (viaEsb && from !== 'esb' && to !== 'esb') points.push(at('esb', z), at('esb', door), at('esb', z));
  points.push(at(to, z), at(to, door));
  return points;
}
