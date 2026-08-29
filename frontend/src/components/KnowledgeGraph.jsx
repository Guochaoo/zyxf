import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { ICON_BUTTON_CLASS } from './ui.js';
import { openFilePreview } from '../ui.js';

const VIEW_W = 600;
const VIEW_H = 420;

// 图谱区高度：原卡片高 295px，头部栏占 37px（p-1.5×2 + size-6 + 1px 分割线）。
const GRAPH_H = '258px';

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建）。
let collapsedPersistent = false;

// Node ids: folders are `f<id>` (root is f0), files are `file<id>`.
const nodeIdOf = (currentId) => (currentId ? `f${currentId}` : 'f0');

function buildGraph(tree, rootFiles) {
  const nodes = [{ id: 'f0', name: '首页', type: 'folder', isRoot: true }];
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
function localSubgraph(nodes, links, currentId) {
  const current = nodeIdOf(currentId);
  const ids = new Set([current]);
  for (const l of links) {
    if (l.source === current) ids.add(l.target);
    if (l.target === current) ids.add(l.source);
  }
  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    links: links.filter((l) => ids.has(l.source) && ids.has(l.target)),
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
  const navigate = useNavigate();
  // Enlarged dialog mode: 'full' = whole library (globe), 'local' = current
  // folder neighborhood zoomed (maximize). null = dialog closed.
  const [dialog, setDialog] = useState(null);
  const [collapsed, setCollapsed] = useState(collapsedPersistent);
  const { tree, rootFiles, loading } = useFolderTree();

  // Full graph only depends on the tree + root files: keep it stable across
  // folder navigation so browsing doesn't re-walk/re-allocate the whole library.
  const fullGraph = useMemo(() => buildGraph(tree, rootFiles), [tree, rootFiles]);
  const { localNodes, localLinks, fullNodes, fullLinks } = useMemo(() => {
    const local = localSubgraph(fullGraph.nodes, fullGraph.links, currentId);
    return {
      localNodes: local.nodes,
      localLinks: local.links,
      fullNodes: fullGraph.nodes,
      fullLinks: fullGraph.links,
    };
  }, [fullGraph, currentId]);

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

  return (
    <div
      className={`relative flex shrink-0 flex-col bg-white rounded-[14px] overflow-hidden ${className}`.trim()}
    >
      {/* 头部栏 — 灰底标签行；收起后仅剩本栏（14px 圆角胶囊） */}
      <PanelHeader
        title="知识图谱"
        collapsed={collapsed}
        onToggleCollapsed={() =>
          setCollapsed((v) => {
            collapsedPersistent = !v;
            return !v;
          })
        }
        expandTitle="展开图谱"
        collapseTitle="收起图谱"
      >
        {!empty && (
          <>
            <button
              type="button"
              onClick={() => setDialog('full')}
              title="查看全库图谱"
              aria-label="查看全库图谱"
              className={ICON_BUTTON_CLASS}
            >
              <Globe className="h-[15px] w-[15px]" />
            </button>
            <button
              type="button"
              onClick={() => setDialog('local')}
              title="放大当前图谱"
              aria-label="放大当前图谱"
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
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {loading || empty ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            {loading ? '加载中…' : '暂无内容'}
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
            className="relative h-full max-h-[85vh] w-full max-w-[1200px] overflow-hidden rounded-[14px] bg-white shadow-[rgba(0,0,0,0.12)_0_16px_48px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDialog(null)}
              aria-label="关闭"
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-500 shadow-[rgba(23,23,23,0.12)_0_0_0_1px,rgba(23,23,23,0.06)_0_1px_2px] transition-colors hover:bg-black/5 hover:text-black"
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

function buildDegrees(links) {
  const deg = {};
  for (const l of links) {
    deg[l.source] = (deg[l.source] || 0) + 1;
    deg[l.target] = (deg[l.target] || 0) + 1;
  }
  return deg;
}

function GraphCanvas({ nodes, links, currentId, onNavigate, height }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const dragRef = useRef(null);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState(null);
  const neighborsRef = useRef(new Set());

  const degrees = useMemo(() => buildDegrees(links), [links]);
  const radiusOf = useCallback(
    (n) => 2 + Math.sqrt(degrees[n.id] || 0) * 2.2,
    [degrees]
  );
  const current = nodeIdOf(currentId);

  // (Re)build the simulation whenever the node set changes.
  useEffect(() => {
    simRef.current?.stop();
    setView({ x: 0, y: 0, k: 1 });
    setHovered(null);
    if (nodes.length <= 1) {
      // A lone node never gets a simulation to place it; park it dead-center
      // so the positioned render gate below stays satisfied.
      if (nodes[0]) {
        nodes[0].x = VIEW_W / 2;
        nodes[0].y = VIEW_H / 2;
      }
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
    sim.on('tick', () => setTick((t) => t + 1));
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

    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  // Recompute neighbors when hovering.
  const onHover = useCallback(
    (id) => {
      setHovered(id);
      if (!id) return;
      const set = new Set([id]);
      for (const l of links) {
        // d3-force rewrites l.source/l.target from string ids to node objects
        // after the simulation runs, so normalize before comparing.
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
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
      setTick((t) => t + 1);
    },
    [view.k]
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
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            const active = hovered && (neighborsRef.current.has(s) || neighborsRef.current.has(t));
            const dim = hovered && !active;
            return (
              <line
                key={`l-${i}`}
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={hovered ? '#171717' : 'rgba(23,23,23,0.25)'}
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
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.12 : 1, transition: 'opacity 150ms' }}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPointerMove={onNodeMove}
                onPointerUp={(e) => onNodeUp(e, n)}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
              >
                {isCurrent && (
                  <circle r={r + 3} fill="none" stroke="#171717" strokeWidth={1.2} opacity={0.5} />
                )}
                <circle
                  r={r}
                  fill={isFolder ? '#171717' : '#ffffff'}
                  stroke={isFolder ? '#171717' : 'rgba(23,23,23,0.45)'}
                  strokeWidth={1}
                />
                {(hovered === n.id || showLabels) && (
                  <text
                    y={-r - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#171717"
                    stroke="#ffffff"
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}
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
