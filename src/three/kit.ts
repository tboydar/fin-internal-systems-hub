import {
  type Box3,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  type Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { SitesModel } from '../core/sites';
import type { TwinModel } from '../core/twin';
import type { Domain, Health, RegionId, SystemId } from '../core/types';

// 三個比例尺（總行、全台、海外）共用的零件：顏色、材質、把小零件合成一批的 Batch、狀態標記，
// 以及每個比例尺要交給引擎（twin.ts）的東西長什麼樣子（Stage）。

export type V3 = [number, number, number];

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
  /** 被選取的區域或樓層：比白色冷一點、深一點，不是發光。 */
  picked: 0xcfdbe6,
  sea: 0xd3d9dd,
  /** 據點之間的線路：比桌面深一點，紙片放在上面才看得清楚。 */
  line: 0xc3cad0,
  night: 0xaab3bd,
  away: 0xe4e7e9,
} as const;

export const TONE: Record<Health, number> = { ok: 0x25714b, warn: 0xb26f0c, crit: 0xa3271f };
/** 正常的小紙片的顏色。 */
export const SLIP_OK = 0x5d7186;

export const UP = new Vector3(0, 1, 0);
export const matte = (color: number) => new MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
export const flat = (color: number) => new MeshBasicMaterial({ color });

/** 同一種形狀的許多小零件合成一個 InstancedMesh，整批只算一次繪製。 */
export class Batch {
  private items: { matrix: Matrix4; color: number }[] = [];
  constructor(private geometry: BufferGeometry) {}

  /** at 是零件「底部中心」的位置，擺家具時不必自己加半個高度。turn 是繞著垂直軸轉幾弧度。 */
  add(size: V3, at: V3, color: number, turn = 0): void {
    const position = new Vector3(at[0], at[1] + size[1] / 2, at[2]);
    this.items.push({ matrix: new Matrix4().compose(position, new Quaternion().setFromAxisAngle(UP, turn), new Vector3(...size)), color });
  }

  /** 沿著地面從 a 鋪到 b 的一條帶子（線路、道路）。 */
  strip(a: Vector3, b: Vector3, width: number, height: number, color: number): void {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-4) return;
    this.add([length, height, width], [(a.x + b.x) / 2, Math.min(a.y, b.y), (a.z + b.z) / 2], color, -Math.atan2(b.z - a.z, b.x - a.x));
  }

  build(parent: Group): void {
    if (!this.items.length) return;
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
export function solid(group: Group, size: V3, center: V3, body: Material, cut?: Material): Mesh {
  // BoxGeometry 六個面的順序是 +x、-x、+y、-y、+z、-z
  const mesh = new Mesh(new BoxGeometry(...size), cut ? [body, body, body, body, cut, body] : body);
  mesh.position.set(...center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** 看不見、只用來接滑鼠的方塊：範圍比實際的零件大一點，比較好點。 */
export function hitBox(group: Group, size: V3, center: V3, pick: PickTarget): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size));
  mesh.position.set(...center);
  mesh.visible = false;
  mesh.userData.pick = pick;
  group.add(mesh);
  return mesh;
}

/**
 * 一批狀態標記：圓是正常、三角是注意、方塊是中斷，跟 2D 頁面上的標記同一套形狀。
 * 做成薄薄一片、正對著鏡頭的預設方向：鏡頭抬得高的比例尺，立體的三角錐從上面看會變形，平面的不會。
 * 用不受光的材質，白天晚上都一樣好認。每個位置同時只會顯示一種形狀。
 */
export class Marks {
  private meshes: Record<Health, InstancedMesh>;
  private matrix = new Matrix4();
  private hidden = new Matrix4().makeScale(0, 0, 0);
  private facing: Matrix4;

  /** toward 是從模型指向鏡頭的方向。 */
  constructor(parent: Group, capacity: number, size: number, toward: Vector3) {
    this.facing = new Matrix4().lookAt(toward, new Vector3(), UP);
    const make = (geometry: BufferGeometry, tone: number) => {
      const mesh = new InstancedMesh(geometry, new MeshBasicMaterial({ color: tone, side: DoubleSide }), capacity);
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, this.hidden);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    this.meshes = {
      ok: make(new CircleGeometry(0.12 * size, 28), TONE.ok),
      // 三個邊的「圓」就是正三角形；轉 90 度讓尖端朝上
      warn: make(new CircleGeometry(0.16 * size, 3, Math.PI / 2), TONE.warn),
      crit: make(new PlaneGeometry(0.21 * size, 0.21 * size), TONE.crit),
    };
  }

  set(index: number, at: Vector3, health: Health | null): void {
    for (const key of ['ok', 'warn', 'crit'] as const) {
      this.meshes[key].setMatrixAt(index, key === health ? this.matrix.copy(this.facing).setPosition(at) : this.hidden);
      this.meshes[key].instanceMatrix.needsUpdate = true;
    }
  }
}

/** 鏡頭的方位與仰角（度）換成從模型指向鏡頭的方向。 */
export function aimAt(azimuth: number, elevation: number, out = new Vector3()): Vector3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** 畫面上可以點的東西。 */
export interface PickTarget {
  kind: 'system' | 'floor' | 'site' | 'region';
  id: string;
}

export interface Selection {
  system: SystemId | null;
  floor: Domain | null;
  site: string | null;
  region: RegionId | null;
}

/** 一次重畫要用的資料。三個比例尺讀同一份。 */
export interface Paint {
  model: TwinModel;
  /** 多據點的資料。只有「總行」用不到它，那時可以是 null。 */
  sites: SitesModel | null;
  selected: Selection;
  lowFx: boolean;
}

/** 一條路線上要放幾張小紙片。tags 是它跟哪些東西有關（system:crm、site:br-tc…），滑過或選取時用來挑出相關的紙片。 */
export interface SlipSpec {
  path: Vector3[];
  count: number;
  speed: number;
  color: number;
  tags: string[];
}

/** 一個比例尺的場景。引擎只認這個形狀，不管裡面蓋的是大樓還是島。 */
export interface Stage {
  group: Group;
  /** 整個模型的範圍，陰影用它決定要算多大。 */
  bounds: Box3;
  /** 模型輪廓上的幾個點，鏡頭用它把模型剛好放進畫面。 */
  outline: Vector3[];
  /** 標籤要貼的位置。 */
  anchors: Map<string, Vector3>;
  /** 可以點的零件，userData.pick 寫著它是什麼。 */
  pickables: Object3D[];
  /** 鏡頭的預設角度（度）與可以轉動的範圍（弧度）；padTop 是上方要留給標籤的像素。 */
  view: { azimuth: number; elevation: number; azimuthRange: [number, number]; polarRange: [number, number]; padTop: number };
  /** 這個比例尺的小紙片要多大（總行是 1）。 */
  slipScale: number;
  /** true：光線固定用白天的，不跟著台北的時間變（時區桌上每一格的時間都不一樣）。 */
  fixedLight: boolean;
  /** 室內燈的位置；沒有室內的比例尺是 null。 */
  roomLight: Vector3 | null;
  /** 把狀態畫上去：換材質的顏色、換標記的形狀。 */
  paint(frame: Paint): void;
  /** 這個小時要跑的小紙片。 */
  slips(frame: Paint): SlipSpec[];
}

/** 把一串點兩兩之間靠太近的推開一點，結果每次都一樣。回傳新的位置。 */
export function spread(points: { x: number; z: number }[], gap: number, rounds = 40): { x: number; z: number }[] {
  const out = points.map((p) => ({ ...p }));
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let dz = out[j].z - out[i].z;
        let d = Math.hypot(dx, dz);
        if (d >= gap) continue;
        // 完全疊在一起的兩個點，用順序決定往哪邊推
        if (d < 1e-6) {
          dx = Math.cos(i * 2.4 + j);
          dz = Math.sin(i * 2.4 + j);
          d = 1;
        }
        const push = (gap - d) / 2 + 1e-3;
        out[i].x -= (dx / d) * push;
        out[i].z -= (dz / d) * push;
        out[j].x += (dx / d) * push;
        out[j].z += (dz / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
