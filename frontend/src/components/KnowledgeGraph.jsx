import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Maximize, X } from 'lucide-react';
import {
  forceCenter,
  forceCollide,
  forceManyBody,
  forceLink,
  forceSimulation,
} from 'd3-force';
import { useFolderTree } from '../hooks/useFolderTree.js';
import PanelHeader from './PanelHeader.jsx';
import { ICON_BUTTON_CLASS, EASE_COLLAPSE } from './ui.js';
import { openFilePreview } from '../ui.js';

const VIEW_W = 600;
const VIEW_H = 420;

// 图谱区高度：原卡片高 295px，头部栏占 37px（p-1.5×2 + size-6 + 1px 分割线）。
const GRAPH_H = '258px';

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建）。
let collapsedPersistent = false;

// Node ids: folders are `f<id>` (root is f0), files are `file<id>`.
export const nodeIdOf = (currentId) => (currentId ? `f${currentId}` : 'f0');

// d3-force 在模拟运行后会把 l.source/l.target 从字符串 id 改写为节点对象，
// 取端点 id 前先归一化。
export const endpointId = (n) => (typeof n === 'object' ? n.id : n);

export function buildGraph(tree, rootFiles, rootName) {
  const nodes = [{ id: 'f0', name: rootName, type: 'folder', isRoot: true }];
  const links = [];
  const walk = (folder, parentId) => {
    const fid = `f${folder.id}`;
    nodes.push({ id: fid, name: folder.name, type: 'folder' });
    links.push({ source: parentId, target: fid });
    for (const c of folder.children || []) walk(c, fid);
    for (const f of folder.files || []) {
      nodes.push({ id: `file${f.id}`, name: f.name, type: 'file', meta: f });
      links.push({ source: fid, target: `file${f.id}` });
    }
  };
  for (const t of tree || []) walk(t, 'f0');
  for (const f of rootFiles || []) {
    nodes.push({ id: `file${f.id}`, name: f.name, type: 'file', meta: f });
    links.push({ source: 'f0', target: `file${f.id}` });
  }
  return { nodes, links };
}

// Keep only the current node and its direct neighbors (forestry-style local graph).
//
// ⚠️ 返回的是**拷贝**：d3-force 的 forceLink/forceSimulation 会就地改写传入的
// link.source/target（字符串 id → 节点对象）与节点的 x/y。而 fullGraph 是跨导航复用的
// memo，若把它的对象直接交给模拟，第二次进同一处就会踩到已被改写过的端点：
// 原来 `l.source === current` 的字符串比较全部失配 → 局部子图退化成「只剩当前节点」（主页
// 那条一刷新/一返回就只剩一个点的现象就是它），同时 buildDegrees 会把度数记到
// "[object Object]" 上，半径全变 2px。拷贝 + 端点归一化后每次都从干净的字符串 id 开始。
export function localSubgraph(nodes, links, currentId) {
  const current = nodeIdOf(currentId);
  const ids = new Set([current]);
  for (const l of links) {
    const s = endpointId(l.source);
    const t = endpointId(l.target);
    if (s === current) ids.add(t);
    if (t === current) ids.add(s);
  }
  return {
    nodes: nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n })),
    links: links
      .filter((l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)))
      .map((l) => ({ ...l, source: endpointId(l.source), target: endpointId(l.target) })),
  };
}

function displayName(name) {
  const s = String(name || '');
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

/**
 * 知识库 — force-directed graph of the library, forestry.md "Connected Pages"
 * style: circular nodes sized by degree, hover highlights neighbors,
 * zoom reveals labels; pan/zoom/drag; full-library view in a modal.
 */
export default function KnowledgeGraph({ currentId = 0, className = '', onFullChange }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Enlarged dialog mode: 'full' = whole library (globe), 'local' = current
  // folder neighborhood zoomed (maximize). null = dialog closed.
  const [dialog, setDialog] = useState(null);
  const [collapsed, setCollapsed] = useState(collapsedPersistent);
  const { tree, rootFiles, loading } = useFolderTree();

  // Full graph only depends on the tree + root files: keep it stable across
  // folder navigation so browsing doesn't re-walk/re-allocate the whole library.
  const fullGraph = useMemo(() => buildGraph(tree, rootFiles, t('tree.home')), [tree, rootFiles, t]);
  const { localNodes, localLinks } = useMemo(
    () => localSubgraph(fullGraph.nodes, fullGraph.links, currentId),
    [fullGraph, currentId]
  );
  // 全库弹窗用的拷贝与 currentId 解耦（IMPROVE-54）：拷贝只为防 d3-force 就地改写
  // fullGraph，依赖 currentId 会让每次切目录都全库 spread 一遍。
  const { fullNodes, fullLinks } = useMemo(
    () => ({
      fullNodes: fullGraph.nodes.map((n) => ({ ...n })),
      fullLinks: fullGraph.links.map((l) => ({ ...l })),
    }),
    [fullGraph]
  );

  const onNavigate = useCallback(
    (node) => {
      if (node.type === 'folder') {
        navigate(node.isRoot ? '/' : `/folder/${Number(node.id.slice(1))}`);
      } else {
        openFilePreview(node.meta, navigate);
      }
    },
    [navigate]
  );

  const empty = !loading && fullNodes.length <= 1;

  // Let the parent (App) know when the enlarged dialog opens/closes so it can
  // hide the floating menu button while the dialog is up.
  useEffect(() => {
    onFullChange?.(dialog !== null);
  }, [dialog, onFullChange]);

  // BUG-64：卸载时必须复位 graphFull（窄屏卸载时 App 的悬浮菜单会因此永久消失）。
  // 用 ref 读最新回调，保证这个清理只在真正卸载时执行。
  const onFullChangeRef = useRef(onFullChange);
  onFullChangeRef.current = onFullChange;
  useEffect(() => () => onFullChangeRef.current?.(false), []);

  return (
    <div
      className={`relative flex shrink-0 flex-col bg-surface rounded-[14px] overflow-hidden ${className}`.trim()}
    >
      {/* 头部栏 — 灰底标签行；收起后仅剩本栏（14px 圆角胶囊） */}
      <PanelHeader
        title={t('kg.title')}
        collapsed={collapsed}
        onToggleCollapsed={() =>
          setCollapsed((v) => {
            collapsedPersistent = !v;
            return !v;
          })
        }
        expandTitle={t('kg.expand')}
        collapseTitle={t('kg.collapse')}
      >
        {!empty && (
          <>
            <button
              type="button"
              onClick={() => setDialog('full')}
              title={t('kg.viewAll')}
              aria-label={t('kg.viewAll')}
              className={ICON_BUTTON_CLASS}
            >
              <Globe className="h-[15px] w-[15px]" />
            </button>
            <button
              type="button"
              onClick={() => setDialog('local')}
              title={t('kg.zoomIn')}
              aria-label={t('kg.zoomIn')}
              className={ICON_BUTTON_CLASS}
            >
              <Maximize className="h-[15px] w-[15px]" />
            </button>
          </>
        )}
      </PanelHeader>
      {/* 图谱内容区：高度动画收起/展开，下方对话卡片（flex-1）自然补位 */}
      <div
        className="overflow-hidden transition-[height] duration-[360ms]"
        style={{
          height: collapsed ? 0 : GRAPH_H,
          transitionTimingFunction: EASE_COLLAPSE,
        }}
      >
        {loading || empty ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            {loading ? t('common.loading') : t('kg.empty')}
          </div>
        ) : (
          <GraphCanvas
            nodes={localNodes}
            links={localLinks}
            currentId={currentId}
            onNavigate={onNavigate}
            height={GRAPH_H}
          />
        )}
      </div>

      {dialog && !empty && (
        <div
          className="rb-frost-backdrop fixed inset-0 z-[150] flex items-center justify-center p-6 sm:p-10"
          onClick={() => setDialog(null)}
        >
          <div
            className="relative h-full max-h-[85vh] w-full max-w-[1200px] overflow-hidden rounded-[14px] bg-surface shadow-[rgba(0,0,0,0.12)_0_16px_48px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDialog(null)}
              aria-label={t('kg.close')}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-md bg-surface text-slate-500 shadow-[rgba(23,23,23,0.12)_0_0_0_1px,rgba(23,23,23,0.06)_0_1px_2px] transition-colors hover:bg-black/5 hover:text-black"
            >
              <X className="h-5 w-5" />
            </button>
            <GraphCanvas
              nodes={dialog === 'local' ? localNodes : fullNodes}
              links={dialog === 'local' ? localLinks : fullLinks}
              currentId={currentId}
              onNavigate={onNavigate}
              height="100%"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function buildDegrees(links) {
  const deg = {};
  for (const l of links) {
    // 端点可能是字符串 id，也可能已被 d3-force 改写成节点对象（见 localSubgraph 的注释）
    const s = endpointId(l.source);
    const t = endpointId(l.target);
    deg[s] = (deg[s] || 0) + 1;
    deg[t] = (deg[t] || 0) + 1;
  }
  return deg;
}

function GraphCanvas({ nodes, links, currentId, onNavigate, height }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const dragRef = useRef(null);
  // IMPROVE-54：模拟的每一帧不再经过 React——tick/拖拽直接写 DOM 属性，
  // hover/缩放等低频状态仍走 state。元素引用按需从 DOM 收集（data-* 定位），
  // 集合规模与 nodes/links 不一致时重建。
  const [, setMounted] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState(null);
  const neighborsRef = useRef(new Set());
  const linkElsRef = useRef(null);
  const nodeElsRef = useRef(null);

  const degrees = useMemo(() => buildDegrees(links), [links]);
  const radiusOf = useCallback(
    (n) => 2 + Math.sqrt(degrees[n.id] || 0) * 2.2,
    [degrees]
  );
  const current = nodeIdOf(currentId);

  // 把当前模拟坐标写进 SVG（连线端点 + 节点 transform）。元素列表懒收集：
  // 渲染顺序即链接下标顺序，节点用 data-node 属性取 id。
  const applyPositions = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (!linkElsRef.current || linkElsRef.current.length !== links.length) {
      linkElsRef.current = links.length ? [...svg.querySelectorAll('line[data-link]')] : [];
    }
    if (!nodeElsRef.current || nodeElsRef.current.size !== nodes.length) {
      nodeElsRef.current = new Map();
      if (nodes.length) {
        for (const el of svg.querySelectorAll('g[data-node]')) {
          nodeElsRef.current.set(el.getAttribute('data-node'), el);
        }
      }
    }
    for (let i = 0; i < links.length; i++) {
      const el = linkElsRef.current[i];
      if (!el) continue;
      const l = links[i];
      el.setAttribute('x1', l.source.x);
      el.setAttribute('y1', l.source.y);
      el.setAttribute('x2', l.target.x);
      el.setAttribute('y2', l.target.y);
    }
    for (const n of nodes) {
      const el = nodeElsRef.current?.get(n.id);
      if (el) el.setAttribute('transform', `translate(${n.x},${n.y})`);
    }
  }, [nodes, links]);

  // (Re)build the simulation whenever the node set changes.
  useEffect(() => {
    simRef.current?.stop();
    setView({ x: 0, y: 0, k: 1 });
    setHovered(null);
    linkElsRef.current = null;
    nodeElsRef.current = null;
    if (nodes.length <= 1) {
      // A lone node never gets a simulation to place it; park it dead-center
      // so the positioned render gate below stays satisfied.
      if (nodes[0]) {
        nodes[0].x = VIEW_W / 2;
        nodes[0].y = VIEW_H / 2;
      }
      setMounted((t) => t + 1);
      return undefined;
    }

    const sim = forceSimulation(nodes)
      .force(
        'link',
        forceLink(links)
          .id((d) => d.id)
          .distance(55)
          .strength(0.5)
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(VIEW_W / 2, VIEW_H / 2).strength(0.5))
      .force(
        'collide',
        forceCollide((n) => radiusOf(n) + 2).iterations(3)
      );
    sim.stop();
    sim.tick(300); // settle deterministically
    // 残余运动逐帧直写 DOM（IMPROVE-54）：原实现每帧 setState 让全量 SVG 走一遍
    // reconcile，全库视图节点多时是明显的卡顿源。
    sim.on('tick', applyPositions);
    sim.alpha(0.1).restart(); // subtle residual motion
    simRef.current = sim;

    // Fit the settled graph into the view (forestry-style auto-fit).
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    if (minX !== Infinity) {
      const pad = 40;
      const k = Math.min(2.0, Math.max(0.35, (VIEW_W - pad * 2) / (maxX - minX + pad), (VIEW_H - pad * 2) / (maxY - minY + pad)));
      setView({
        k,
        x: VIEW_W / 2 - ((minX + maxX) / 2) * k,
        y: VIEW_H / 2 - ((minY + maxY) / 2) * k,
      });
    }
    // tick(300) 已就地写出坐标，这里触发一次 React 渲染按真实坐标挂载 SVG；
    // 之后位置变化全部走 applyPositions，不再有逐帧 setState。
    setMounted((t) => t + 1);

    return () => {
      sim.stop();
      // 解绑 tick（BUG-67）：只 stop 不摘监听时，旧模拟的回调仍在（节点集每次变化都重建
      // 一份 simulation），卸载后继续 setState、逐帧触发无意义重渲染。
      sim.on('tick', null);
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, applyPositions]);

  // Recompute neighbors when hovering.
  const onHover = useCallback(
    (id) => {
      setHovered(id);
      if (!id) return;
      const set = new Set([id]);
      for (const l of links) {
        const s = endpointId(l.source);
        const t = endpointId(l.target);
        if (s === id) set.add(t);
        if (t === id) set.add(s);
      }
      neighborsRef.current = set;
    },
    [links]
  );

  // Bind wheel natively with passive:false — React's synthetic onWheel is a
  // passive listener in this environment, so its preventDefault is ignored and
  // the page still scrolls. A native non-passive listener reliably stops the
  // page/scroll container and zooms the graph only.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return v;
        const factor = Math.exp(-e.deltaY * 0.0014);
        const k = Math.min(2.5, Math.max(0.25, v.k * factor));
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        return {
          k,
          x: cx - ((cx - v.x) / v.k) * k,
          y: cy - ((cy - v.y) / v.k) * k,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onBackgroundDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startV: view, moved: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [view]
  );

  const onBackgroundMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || d.mode !== 'pan') return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = 1;
    if (d.moved) setView((v) => ({ ...v, x: d.startV.x + dx, y: d.startV.y + dy }));
  }, []);

  const onBackgroundUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onNodeDown = useCallback((e, node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const sim = simRef.current;
    dragRef.current = {
      mode: 'node',
      node,
      startX: e.clientX,
      startY: e.clientY,
      startNX: node.x,
      startNY: node.y,
      moved: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (sim) {
      sim.alphaTarget(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;
    }
  }, []);

  const onNodeMove = useCallback(
    (e) => {
      const d = dragRef.current;
      if (!d || d.mode !== 'node') return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = 1;
      if (!d.moved) return;
      const k = view.k || 1;
      const node = d.node;
      node.fx = d.startNX + dx / k;
      node.fy = d.startNY + dy / k;
      node.x = node.fx;
      node.y = node.fy;
      // 拖拽逐帧直写 DOM（IMPROVE-54），不再 setState 触发全量 reconcile。
      applyPositions();
    },
    [view.k, applyPositions]
  );

  const onNodeUp = useCallback(
    (e, node) => {
      const d = dragRef.current;
      dragRef.current = null;
      const sim = simRef.current;
      if (sim) {
        sim.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      }
      if (d && !d.moved) onNavigate(node);
    },
    [onNavigate]
  );

  const showLabels = view.k > 1.2;
  const svgH = typeof height === 'number' ? `${height}px` : height;
  // d3-force assigns node.x/node.y inside the effect above, which runs after
  // the first commit — so freshly built node objects have no positions on
  // that first render. Gating here avoids `translate(undefined,undefined)`
  // (React logs "Expected number" per such <g>). Once ticked, positions are
  // always numbers, so this is only ever false for one commit.
  const positioned =
    nodes.length === 0 || nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="kg-graph w-full cursor-grab select-none touch-none active:cursor-grabbing"
      style={{ height: svgH }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onBackgroundMove}
      onPointerUp={onBackgroundUp}
      onPointerLeave={onBackgroundUp}
    >
      {positioned && (
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l, i) => {
            const s = endpointId(l.source);
            const t = endpointId(l.target);
            const active = hovered && (neighborsRef.current.has(s) || neighborsRef.current.has(t));
            const dim = hovered && !active;
            return (
              <line
                key={`l-${i}`}
                data-link=""
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={hovered ? 'var(--ink)' : 'var(--line-strong)'}
                strokeWidth={1}
                opacity={dim ? 0.05 : hovered ? 0.7 : 0.5}
              />
            );
          })}
          {nodes.map((n) => {
            const r = radiusOf(n);
            const dim = hovered && !neighborsRef.current.has(n.id);
            const isFolder = n.type === 'folder';
            const isCurrent = n.id === current;
            return (
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.12 : 1, transition: 'opacity 150ms' }}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPointerMove={onNodeMove}
                onPointerUp={(e) => onNodeUp(e, n)}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
              >
                {isCurrent && (
                  <circle r={r + 3} fill="none" stroke="var(--ink)" strokeWidth={1.2} opacity={0.5} />
                )}
                <circle
                  r={r}
                  fill={isFolder ? 'var(--ink)' : 'var(--surface)'}
                  stroke={isFolder ? 'var(--ink)' : 'var(--line-strong)'}
                  strokeWidth={1}
                />
                {(hovered === n.id || showLabels) && (
                  <text
                    y={-r - 6}
                    textAnchor="middle"
                    fontSize={10}
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{
                      fill: 'var(--ink)',
                      stroke: 'var(--kg-label-stroke)',
                      pointerEvents: 'none',
                    }}
                  >
                    {displayName(n.name)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
