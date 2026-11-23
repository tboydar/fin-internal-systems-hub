import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

// 互動流程圖的「React 島」。
// 全站其他部分是原生 TypeScript；只有流程圖用 xyflow（@xyflow/react）。
// 頁面呼叫 mountFlow(容器, 節點與連線的純資料, 選項)，拿回 { update, destroy }，
// 完全不需要知道 React 的存在。這個檔案（連同 React）是延遲載入的，首屏不會下載。

export type FlowTone = 'plain' | 'ok' | 'warn' | 'crit';

export interface FlowNodeSpec {
  id: string;
  /** 預設位置；使用者拖曳後的位置會記在 localStorage，優先採用。 */
  x: number;
  y: number;
  title: string;
  code?: string;
  sub?: string;
  stat?: string;
  tone?: FlowTone;
  /** 狀態的文字（正常／注意／中斷）。狀態一律是形狀＋顏色＋文字。 */
  toneLabel?: string;
  /** 被篩選條件排除：變淡。 */
  dim?: boolean;
  /** 在「如果它停了」的影響範圍裡。 */
  hit?: boolean;
  width?: number;
}

export interface FlowEdgeSpec {
  id: string;
  source: string;
  target: string;
  label?: string;
  tone?: FlowTone;
  dim?: boolean;
  hit?: boolean;
  /** 給螢幕報讀器的完整說明。 */
  ariaLabel?: string;
}

export interface FlowSpec {
  nodes: FlowNodeSpec[];
  edges: FlowEdgeSpec[];
}

export interface FlowOptions {
  /** 給了就會記住使用者拖曳後的版面。 */
  layoutKey?: string;
  labels: { reset: string; hint: string; canvas: string; zoomIn: string; zoomOut: string; fit: string };
  onNodeClick?(id: string): void;
  onEdgeClick?(id: string): void;
}

export interface FlowHandle {
  update(spec: FlowSpec, selected?: string | null): void;
  destroy(): void;
}

type CardNode = Node<FlowNodeSpec & Record<string, unknown>, 'card'>;
type Snapshot = { spec: FlowSpec; selected: string | null };
type Bus = { get(): Snapshot; subscribe(fn: () => void): () => void };
type Layout = Record<string, { x: number; y: number }>;
type Side = 'top' | 'right' | 'bottom' | 'left';

const TONE_COLOR: Record<FlowTone, string> = { plain: '#66727e', ok: '#7d8a94', warn: '#96590a', crit: '#a3271f' };
const LAYOUT_PREFIX = 'fish:flow:';
const FIT_PADDING = '24px';
const NODE_W = 172;
const NODE_H = 76;

function loadLayout(key?: string): Layout {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_PREFIX + key) ?? '{}') as Layout;
  } catch {
    return {};
  }
}

function saveLayout(key: string | undefined, layout: Layout): void {
  if (!key) return;
  try {
    localStorage.setItem(LAYOUT_PREFIX + key, JSON.stringify(layout));
  } catch {
    // localStorage 不可用時，版面只保留到離開頁面為止
  }
}

const SHAPES: Record<Exclude<FlowTone, 'plain'>, React.JSX.Element> = {
  ok: <circle cx="6" cy="6" r="4.2" />,
  warn: <path d="M6 1.3l5.2 9.4H.8z" />,
  crit: <rect x="1.6" y="1.6" width="8.8" height="8.8" />,
};

const SIDES: [Side, Position][] = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

function Card({ data }: NodeProps<CardNode>) {
  const tone = data.tone ?? 'plain';
  return (
    <div className={`fnode tone-${tone}${data.dim ? ' is-dim' : ''}${data.hit ? ' is-hit' : ''}`} style={{ width: data.width ?? NODE_W }}>
      {/* 每一邊各有一個出口與一個入口，錯開擺放，來回兩個方向的連線才不會疊在一起 */}
      {SIDES.map(([side, position]) => (
        <span key={side}>
          <Handle id={`s-${side}`} type="source" position={position} isConnectable={false} className={`fh fh-s fh-${side}`} />
          <Handle id={`t-${side}`} type="target" position={position} isConnectable={false} className={`fh fh-t fh-${side}`} />
        </span>
      ))}
      <div className="fnode-head">
        {data.code && <span className="fnode-code">{data.code}</span>}
        {tone !== 'plain' && (
          <span className={`fnode-mark is-${tone}`}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              {SHAPES[tone]}
            </svg>
            {data.toneLabel}
          </span>
        )}
      </div>
      <div className="fnode-title">{data.title}</div>
      {data.sub && <div className="fnode-sub">{data.sub}</div>}
      {data.stat && <div className="fnode-stat">{data.stat}</div>}
    </div>
  );
}

const nodeTypes = { card: Card };

/** 依兩個節點的相對位置，決定連線從哪一邊出去、從哪一邊進來。 */
function sides(from: { x: number; y: number }, to: { x: number; y: number }): [Side, Side] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.9) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

function toEdges(snap: Snapshot, at: Map<string, { x: number; y: number }>): Edge[] {
  return snap.spec.edges.map((e): Edge => {
    const tone = e.tone ?? 'plain';
    const color = TONE_COLOR[tone];
    const selected = snap.selected === e.id;
    const [from, to] = sides(at.get(e.source) ?? { x: 0, y: 0 }, at.get(e.target) ?? { x: 0, y: 0 });
    // 狀態除了顏色，也用線型區分：正常是實線、注意是點線、中斷是粗虛線
    const dash = tone === 'crit' ? '7 4' : tone === 'warn' ? '2 4' : undefined;
    const width = (tone === 'crit' ? 2.6 : tone === 'warn' ? 2.2 : 1.4) + (selected || e.hit ? 1.4 : 0);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: `s-${from}`,
      targetHandle: `t-${to}`,
      type: 'default',
      label: e.label,
      selected,
      className: `${e.dim ? 'is-dim' : ''}${e.hit ? ' is-hit' : ''}`,
      style: { stroke: selected ? '#1d3a56' : color, strokeWidth: width, strokeDasharray: dash, opacity: e.dim ? 0.18 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: selected ? '#1d3a56' : color, width: 14, height: 14 },
      labelStyle: {
        fontSize: 11,
        fill: selected ? '#1d3a56' : tone === 'plain' || tone === 'ok' ? '#44515e' : color,
        fontWeight: tone === 'crit' || selected ? 600 : 400,
        opacity: e.dim ? 0.25 : 1,
      },
      labelBgStyle: { fill: '#ffffff', opacity: e.dim ? 0.4 : 0.92 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 2,
      interactionWidth: 18,
      ariaLabel: e.ariaLabel,
    };
  });
}

/** 把頁面給的純資料轉成 xyflow 節點；已存在的節點保留目前位置（使用者可能拖過）。 */
function toNodes(snap: Snapshot, layout: Layout, prev: CardNode[]): CardNode[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  return snap.spec.nodes.map((n): CardNode => {
    const before = old.get(n.id);
    return {
      ...before,
      id: n.id,
      type: 'card',
      position: before?.position ?? layout[n.id] ?? { x: n.x, y: n.y },
      data: { ...n },
      selected: snap.selected === n.id,
      ariaLabel: [n.code, n.title, n.toneLabel, n.stat].filter(Boolean).join('，'),
    };
  });
}

const centers = (nodes: CardNode[]) => new Map(nodes.map((n) => [n.id, { x: n.position.x + NODE_W / 2, y: n.position.y + NODE_H / 2 }]));

/**
 * 等所有節點都量到實際尺寸後再置中縮放；太早做會用錯誤的尺寸計算。
 * 容器的寬度變了（旁邊的明細開或關）也重新置中，圖才不會被切掉或縮在一角。
 */
function AutoFit({ host }: { host: React.RefObject<HTMLDivElement | null> }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (ready) void fitView({ padding: FIT_PADDING });
  }, [ready, fitView]);
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) < 8) return;
      width = el.clientWidth;
      void fitView({ padding: FIT_PADDING, duration: 150 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [host, fitView]);
  return null;
}

function FlowApp({ bus, options }: { bus: Bus; options: FlowOptions }) {
  const snap = useSyncExternalStore(bus.subscribe, bus.get);
  const layout = useRef<Layout>(loadLayout(options.layoutKey));
  const instance = useRef<ReactFlowInstance<CardNode, Edge> | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  // 第一次 render 就帶入節點，fitView 才有東西可以對齊。
  const initial = useRef<CardNode[]>(toNodes(snap, layout.current, []));
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(initial.current);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(snap, centers(initial.current)));

  // 頁面送來新的資料，或節點被拖到新的位置：重算節點內容與連線的進出方向。
  useEffect(() => {
    setNodes((prev) => toNodes(snap, layout.current, prev));
  }, [snap, setNodes]);
  useEffect(() => {
    setEdges(toEdges(snap, centers(nodes)));
  }, [snap, nodes, setEdges]);

  const resetLayout = useCallback(() => {
    layout.current = {};
    saveLayout(options.layoutKey, {});
    const home = new Map(bus.get().spec.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    setNodes((prev) => prev.map((n) => ({ ...n, position: home.get(n.id) ?? n.position })));
    requestAnimationFrame(() => void instance.current?.fitView({ padding: FIT_PADDING, duration: 200 }));
  }, [bus, options.layoutKey, setNodes]);

  return (
    <>
      <div className="flow-bar">
        <span>{options.labels.hint}</span>
        <button type="button" className="btn btn-sm" onClick={resetLayout}>
          {options.labels.reset}
        </button>
      </div>
      <div className="flow-canvas" ref={host}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={(rf) => {
            instance.current = rf;
          }}
          onNodeClick={(_event, node) => options.onNodeClick?.(node.id)}
          onEdgeClick={(_event, edge) => options.onEdgeClick?.(edge.id)}
          // 鍵盤：Tab 移到節點或連線，Enter 選取。選取的結果跟滑鼠點擊走同一條路。
          onSelectionChange={({ nodes: pickedNodes, edges: pickedEdges }) => {
            const current = bus.get().selected;
            if (pickedNodes.length === 1 && pickedNodes[0].id !== current) options.onNodeClick?.(pickedNodes[0].id);
            else if (pickedEdges.length === 1 && pickedNodes.length === 0 && pickedEdges[0].id !== current) options.onEdgeClick?.(pickedEdges[0].id);
          }}
          onNodeDragStop={(_event, node) => {
            layout.current[node.id] = node.position;
            saveLayout(options.layoutKey, layout.current);
          }}
          nodesConnectable={false}
          deleteKeyCode={null}
          forceColorMode="light"
          minZoom={0.4}
          maxZoom={1.6}
          // 滾輪留給頁面捲動；要縮放請按住 Ctrl／⌘ 再滾，或用左下角的控制鈕。
          zoomOnScroll={false}
          preventScrolling={false}
          ariaLabelConfig={{
            'node.a11yDescription.default': options.labels.canvas,
            'edge.a11yDescription.default': options.labels.canvas,
            'controls.zoomIn.ariaLabel': options.labels.zoomIn,
            'controls.zoomOut.ariaLabel': options.labels.zoomOut,
            'controls.fitView.ariaLabel': options.labels.fit,
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#c9d0d6" />
          <Controls showInteractive={false} />
          <AutoFit host={host} />
        </ReactFlow>
      </div>
    </>
  );
}

export function mountFlow(container: HTMLElement, spec: FlowSpec, options: FlowOptions): FlowHandle {
  let snap: Snapshot = { spec, selected: null };
  const listeners = new Set<() => void>();
  const bus: Bus = {
    get: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const root = createRoot(container);
  root.render(<FlowApp bus={bus} options={options} />);
  return {
    update(next, selected) {
      snap = { spec: next, selected: selected === undefined ? snap.selected : selected };
      for (const fn of [...listeners]) fn();
    },
    destroy: () => root.unmount(),
  };
}
