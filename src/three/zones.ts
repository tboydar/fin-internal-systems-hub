import { Box3, BoxGeometry, Color, CylinderGeometry, Group, Mesh, type MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { aimAt, Batch, flat, hitBox, Marks, matte, PALETTE, type Paint, SLIP_OK, type SlipSpec, type Stage, TONE } from './kit';

// 比例尺三「海外」：一張時區桌。
// 桌面由左到右切成 24 格，每一格是一個時區（比 UTC 慢 11 小時到快 12 小時）。
// 據點站在自己的時區那一格上；格子的顏色是當地的白天或晚上，前緣的深色短條是當地的上班時段。
// 時間往前走，白天、晚上與上班時段會一格一格往左移，太陽的標記跟著走。
//
// 為什麼不做地球：地球一次只看得到半邊，而這裡要比的正是地球兩邊的據點。
// 攤平之後，所有據點與它們的時差一眼看得完。南北的位置只是照緯度大概排一下。

const STRIP = 0.62; // 一格的寬
const BACK = -3.1;
const FRONT = 3.1;
const TOP = 0.16; // 桌面的高度
const TRUNK_Z = 2.2; // 線路走的位置
const LANES = 5;
const LANE_GAP = 0.07;
const VIEW: Stage['view'] = { azimuth: 14, elevation: 38, azimuthRange: [-0.3, 0.6], polarRange: [0.66, 1.2], padTop: 30 };

const stripX = (offset: number) => (offset - 0.5) * STRIP;
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export interface ZonePlace {
  id: string;
  /** 比 UTC 快幾小時（可以有小數）。 */
  offsetHr: number;
  lat: number;
  staff: number;
  /** 總行用小塔，海外據點用一棟辦公樓。 */
  hq: boolean;
}

export function buildZones(places: ZonePlace[]): Stage {
  const group = new Group();
  const boxes = new Batch(new BoxGeometry(1, 1, 1));
  const pickables: Mesh[] = [];
  const anchors = new Map<string, Vector3>();
  const xMin = stripX(-11) - STRIP / 2;
  const xMax = stripX(12) + STRIP / 2;

  boxes.add([xMax - xMin + 0.5, 0.2, FRONT - BACK + 0.5], [(xMin + xMax) / 2, -0.2, (BACK + FRONT) / 2], PALETTE.plinth);

  // ── 24 格：每格自己的材質，才能各自換成白天或晚上的顏色
  const strips: { offset: number; top: MeshStandardMaterial; band: Mesh }[] = [];
  const bandOn = matte(PALETTE.primary);
  const bandOff = matte(PALETTE.tray);
  for (let offset = -11; offset <= 12; offset++) {
    const top = matte(PALETTE.white);
    const slab = new Mesh(new BoxGeometry(STRIP - 0.03, TOP, FRONT - BACK), top);
    slab.position.set(stripX(offset), TOP / 2, (BACK + FRONT) / 2);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    const band = new Mesh(new BoxGeometry(STRIP - 0.03, 0.05, 0.3), bandOff);
    band.position.set(stripX(offset), TOP + 0.025, FRONT - 0.15);
    band.castShadow = true;
    band.receiveShadow = true;
    group.add(band);
    strips.push({ offset, top, band });
    anchors.set(`tick:${offset}`, new Vector3(stripX(offset), 0, FRONT + 0.28));
  }

  // ── 據點：站在自己的時區那一格，南北照緯度排；同一格裡靠太近的推開
  const z = new Map<string, number>();
  const byStrip = new Map<number, ZonePlace[]>();
  for (const place of places) byStrip.set(Math.round(place.offsetHr), [...(byStrip.get(Math.round(place.offsetHr)) ?? []), place]);
  for (const inside of byStrip.values()) {
    inside.sort((a, b) => b.lat - a.lat);
    const natural = inside.map((p) => -2.4 + ((55 - p.lat) / 50) * 3.6);
    const middle = natural.reduce((a, b) => a + b, 0) / natural.length;
    for (const [i, p] of inside.entries()) z.set(p.id, inside.length === 1 ? natural[0] : middle + (i - (inside.length - 1) / 2) * 1.25);
  }
  const at = new Map(places.map((p) => [p.id, new Vector3(stripX(p.offsetHr), TOP, Math.min(TRUNK_Z - 0.9, z.get(p.id) ?? 0))]));
  const pos = (id: string) => at.get(id) ?? new Vector3(0, TOP, 0);
  const hq = places.find((p) => p.hq);
  const top = new Map<string, number>();
  for (const place of places) {
    const p = pos(place.id);
    if (place.hq) {
      boxes.add([0.34, 1.2, 0.34], [p.x, TOP, p.z], PALETTE.detail);
      for (let k = 0; k < 5; k++) boxes.add([0.52, 0.17, 0.52], [p.x, TOP + 0.02 + k * 0.24, p.z], PALETTE.white);
      boxes.add([0.22, 0.13, 0.22], [p.x, TOP + 1.19, p.z], PALETTE.furniture);
      top.set(place.id, 1.34);
    } else {
      const height = 0.46 + Math.min(place.staff, 30) / 50;
      boxes.add([0.46, height, 0.46], [p.x, TOP, p.z], PALETTE.white);
      boxes.add([0.5, 0.04, 0.5], [p.x, TOP + height, p.z], PALETTE.furniture);
      for (let k = 1; k * 0.2 < height - 0.06; k++) boxes.add([0.466, 0.026, 0.466], [p.x, TOP + k * 0.2, p.z], PALETTE.glass);
      top.set(place.id, height + 0.04);
    }
    const height = top.get(place.id) ?? 0.5;
    pickables.push(hitBox(group, [0.6, height + 0.3, 0.6], [p.x, TOP + (height + 0.3) / 2, p.z], { kind: 'site', id: place.id }));
    anchors.set(`site:${place.id}`, new Vector3(p.x, TOP + height + 0.3, p.z));
    // 每個據點一條支線接到前面的幹線
    boxes.strip(new Vector3(p.x, TOP, p.z + 0.26), new Vector3(p.x, TOP, TRUNK_Z), 0.1, 0.012, PALETTE.line);
  }
  const xs = places.map((p) => pos(p.id).x);
  if (xs.length)
    boxes.strip(
      new Vector3(Math.min(...xs) - 0.2, TOP, TRUNK_Z),
      new Vector3(Math.max(...xs) + 0.2, TOP, TRUNK_Z),
      LANE_GAP * LANES + 0.08,
      0.012,
      PALETTE.line,
    );
  boxes.build(group);

  // ── 太陽：桌子後緣的一根桿子頂著一顆球，站在當地正午的那一格
  const sun = new Group();
  const pole = new Mesh(new CylinderGeometry(0.02, 0.02, 1.8, 8), matte(PALETTE.detail));
  pole.position.y = TOP + 0.9;
  const ball = new Mesh(new SphereGeometry(0.2, 24, 16), flat(0xe6cf94));
  ball.position.y = TOP + 1.9;
  sun.add(pole, ball);
  sun.position.z = BACK + 0.2;
  group.add(sun);
  anchors.set('note:noon', new Vector3(0, TOP + 2.3, BACK + 0.2));

  const marks = new Marks(group, places.length, 1.15, aimAt(VIEW.azimuth, VIEW.elevation));
  const ring = new Mesh(new CylinderGeometry(0.44, 0.44, 0.016, 32), flat(PALETTE.primary));
  ring.visible = false;
  group.add(ring);
  const day = new Color(PALETTE.white);
  const night = new Color(PALETTE.night);

  function paint({ sites, selected }: Paint): void {
    if (!sites) return;
    for (const strip of strips) {
      const view = sites.strips.find((s) => s.offset === strip.offset);
      if (!view) continue;
      // 當地 5 到 7 點天亮，17 到 19 點天黑；中間是白的，晚上是偏冷的灰
      const light = smooth((view.hour - 5) / 2) * (1 - smooth((view.hour - 17) / 2));
      strip.top.color.copy(night).lerp(day, light);
      strip.band.material = view.working ? bandOn : bandOff;
    }
    sun.position.x = stripX(sites.noonOffset);
    anchors.get('note:noon')?.setX(sun.position.x);
    places.forEach((place, i) => {
      const p = pos(place.id);
      const health = place.hq ? sites.dcs.find((d) => d.id === 'dc-hq')?.health : sites.sites.find((s) => s.id === place.id)?.health;
      marks.set(i, new Vector3(p.x, TOP + (top.get(place.id) ?? 0.5) + 0.18, p.z), health ?? null);
    });
    const picked = selected.site && at.has(selected.site) ? pos(selected.site) : null;
    ring.visible = picked !== null;
    if (picked) ring.position.set(picked.x, TOP + 0.008, picked.z);
  }

  function slips({ sites, lowFx }: Paint): SlipSpec[] {
    if (!sites) return [];
    if (!hq) return [];
    const home = pos(hq.id);
    const out: SlipSpec[] = [];
    let lane = 0;
    for (const site of sites.sites) {
      // 據點在上班，才有簽呈與客戶資料往總行送
      if (site.kind !== 'overseas' || !site.open || !at.has(site.id)) continue;
      const p = pos(site.id);
      const laneZ = TRUNK_Z + ((lane++ % LANES) - (LANES - 1) / 2) * LANE_GAP;
      const y = TOP + 0.03;
      out.push({
        path: [new Vector3(p.x, y, p.z + 0.28), new Vector3(p.x, y, laneZ), new Vector3(home.x, y, laneZ), new Vector3(home.x, y, home.z + 0.32)],
        count: lowFx ? 1 : site.level + 1,
        speed: site.health === 'crit' ? 0 : 0.7 + site.level * 0.25,
        color: site.health === 'ok' ? SLIP_OK : TONE[site.health],
        tags: [`site:${site.id}`, `site:${hq.id}`, 'region:overseas'],
      });
    }
    return out;
  }

  return {
    group,
    anchors,
    pickables,
    view: VIEW,
    slipScale: 0.8,
    fixedLight: true,
    roomLight: null,
    paint,
    slips,
    bounds: new Box3(new Vector3(xMin - 0.25, -0.2, BACK - 0.25), new Vector3(xMax + 0.25, TOP + 2.2, FRONT + 0.25)),
    outline: [
      ...[-0.2, TOP].flatMap((y) => [
        new Vector3(xMin - 0.25, y, BACK - 0.25),
        new Vector3(xMin - 0.25, y, FRONT + 0.25),
        new Vector3(xMax + 0.25, y, BACK - 0.25),
        new Vector3(xMax + 0.25, y, FRONT + 0.25),
      ]),
      new Vector3(xMin, TOP + 2.2, BACK),
      new Vector3(xMax, TOP + 2.2, BACK),
      new Vector3(xMin, 0, FRONT + 0.6),
      new Vector3(xMax, 0, FRONT + 0.6),
    ],
  };
}
