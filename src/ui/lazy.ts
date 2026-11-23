import { T } from '../core/i18n';
import type { FlowHandle, FlowOptions, FlowSpec } from '../flow/FlowIsland';

// 大型函式庫都走動態 import：首屏只下載介面本身，
// 流程圖（xyflow + React）與 3D 場景（three）各自一包，進到用得到的頁面才下載。
// scripts/check-bundle.ts 會在每次建置後確認這件事。

let flowModule: Promise<typeof import('../flow/FlowIsland')> | null = null;
export function loadFlow(): Promise<typeof import('../flow/FlowIsland')> {
  flowModule ??= import('../flow/FlowIsland');
  return flowModule;
}

/**
 * 在容器裡掛上一張互動流程圖。xyflow 與 React 是延遲載入的，
 * 所以這裡先回傳一個代理：載入完成前的 update() 會被記下來，載入後補上。
 */
export function attachFlow(container: HTMLElement, spec: FlowSpec, options: Omit<FlowOptions, 'labels'> & { selected?: string | null }): FlowHandle {
  let handle: FlowHandle | null = null;
  let dead = false;
  let latest: { spec: FlowSpec; selected: string | null } = { spec, selected: options.selected ?? null };
  const loading = document.createElement('p');
  loading.className = 'flow-loading';
  loading.textContent = T('流程圖載入中', 'Loading the diagram');
  container.replaceChildren(loading);

  loadFlow().then(
    ({ mountFlow }) => {
      if (dead) return;
      container.replaceChildren();
      handle = mountFlow(container, latest.spec, {
        ...options,
        labels: {
          reset: T('還原版面', 'Reset layout'),
          hint: T(
            '節點可以拖曳；按住 Ctrl 或 ⌘ 再滾動可以縮放。用 Tab 移到節點或連線，按 Enter 選取。',
            'Drag nodes to rearrange; hold Ctrl or ⌘ and scroll to zoom. Tab to a node or connection and press Enter to select it.',
          ),
          canvas: T('按 Enter 選取，內容會顯示在圖的旁邊', 'Press Enter to select; details appear beside the diagram'),
          zoomIn: T('放大', 'Zoom in'),
          zoomOut: T('縮小', 'Zoom out'),
          fit: T('全部顯示', 'Fit to view'),
        },
      });
      handle.update(latest.spec, latest.selected);
    },
    () => {
      if (dead) return;
      loading.textContent = T('流程圖載入失敗。下方的清單有同樣的資料。', 'The diagram failed to load. The list below has the same data.');
    },
  );

  return {
    update(next, selected) {
      latest = { spec: next, selected: selected === undefined ? latest.selected : selected };
      handle?.update(latest.spec, latest.selected);
    },
    destroy() {
      dead = true;
      handle?.destroy();
      handle = null;
    },
  };
}
