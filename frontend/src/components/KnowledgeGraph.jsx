import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Maximize, Shuffle, Sparkles, X } from 'lucide-react';
import {
  forceCenter,
  forceCollide,
  forceManyBody,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import { useFolderTree } from '../hooks/useFolderTree.js';
import PanelHeader from './PanelHeader.jsx';
import { ICON_BUTTON_CLASS, EASE_COLLAPSE } from './ui.js';
import { openFilePreview } from '../ui.js';
import { getKgTaxonomy } from '../api.js';

const VIEW_W = 600;
const VIEW_H = 420;

// 簇心拉力强度：越大簇越紧、结构越糊。0.05 是实测取值（见 GraphCanvas 的语义布局注释）。
const SEMANTIC_PULL = 0.05;

// 图谱区高度：原卡片高 295px，头部栏占 37px（p-1.5×2 + size-6 + 1px 分割线）。
const GRAPH_H = '258px';

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建）。
let collapsedPersistent = false;

// 图谱视图模式跨导航保留（理由同上：右栏组件会卸载重建）。
// 两档：content = 按内容分类组织；folder = 按文件夹层级。
export const VIEW_MODES = ['content', 'folder'];
const DEFAULT_VIEW_MODE = 'content';
let viewModePersistent = DEFAULT_VIEW_MODE;

/**
 * 内容分类数据在模块级去重：分类是整库级别的数据，右栏组件随路由卸载重建，
 * 用一个共享的在途 Promise 保证「同时挂载/来回切档只发一次请求」。
 */
let kgTaxonomyInflight = null;
function loadKgTaxonomy() {
  if (!kgTaxonomyInflight) {
    kgTaxonomyInflight = getKgTaxonomy()
      .catch(() => null)
      .then((data) => {
        if (!data) kgTaxonomyInflight = null; // 失败允许下次重试
        return data;
      });
  }
  return kgTaxonomyInflight;
}

/** 仅供测试：清掉分类共享缓存与档位记忆。 */
export function __resetKgSemanticsCache() {
  kgTaxonomyInflight = null;
  viewModePersistent = DEFAULT_VIEW_MODE;
}

/** 切档并跨导航记住（右栏组件会随路由卸载重建）。 */
function setViewModePersistent(setter, mode) {
  viewModePersistent = mode;
  setter(mode);
}

/** 档位按钮：与前两个图标按钮同款外观，用 aria-pressed 表达当前档（两档单选）。 */
function ViewModeButton({ active, onClick, title, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`${ICON_BUTTON_CLASS}${active ? ' text-ink' : ''}`}
      style={active ? { background: 'var(--surface)' } : undefined}
    >
      <Icon className="h-[15px] w-[15px]" />
    </button>
  );
}

// Node ids: folders are `f<id>` (root is f0), files are `file<id>`,
// 内容分类节点是 `k:<clusterKey>`（细分）与学科对应的 `f<id>`（复用目录节点）。
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

function displayName(name) {
  const s = String(name || '');
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

/** 簇 → 色槽：固定顺序分配，超出的簇用中性兜底色。 */
export const MAX_SEMANTIC_COLORS = 6;

/** 读 CSS 变量（亮/暗主题各一套，见 index.css）。jsdom 无样式表时回落成 undefined。 */
function cssVar(name) {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return undefined;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export const semanticColorFor = (index) =>
  index >= 0 && index < MAX_SEMANTIC_COLORS ? cssVar(`--kg-c${index + 1}`) : cssVar('--kg-cn');

/**
 * 内容视图的图结构：**用内容分类替代目录骨架**。
 *
 *   根目录 ─┬─ 学科分类（大类）─┬─ 内容细分 ─ 文件
 *           └─ …                └─ …
 *
 * 结构由后端算好（`GET /api/index/taxonomy`）：大类 = 顶层学科目录，细分 = 该学科目录内按内容
 * 向量 k-means 的结果（细分名字由 LLM 起一次并缓存）。前端只负责拼图，不参与聚类。
 *
 * 关键取舍：
 *   - **不再画目录层级边**（这正是「按内容组织」的含义）：文件挂在「内容细分」下，而不是挂在
 *     它所在的文件夹下；当前范围里的其他子目录仍作为节点挂到父目录，局部视图才能继续下钻。
 *   - **学科节点是否存在，只看该学科目录在不在范围内**，与「它的文件在不在范围内」无关：
 *     首页的局部范围只有目录、没有文件，若按文件判据就会一个学科都不显示（首页直接空态）。
 *     学科节点代表整个学科，`size` 用分类里的总文件数。
 *   - **细分/文件节点按「文件是否在范围内」决定**：首页因此是一张干净的学科地图，点进学科
 *     才展开它的内容细分。
 *   - 学科节点与细分节点都可点击进入对应目录（meta.folderId）。
 *   - 未被索引的文件（扫描件/老格式）不在分类里，**不画**——画了没有归属边，只会变成游离点；
 *     它们在「目录视图」里照常可见。
 *
 * @param nodes 当前视图范围内的图谱节点（buildGraph/localSubgraph 的产物）
 * @param taxonomy 后端 /taxonomy 响应
 * @param parentOf Map<folderId, parentFolderId|null>，用于把子目录接到父目录下
 * @param anchorId 当前位置的节点 id（学科不在范围内时，细分/文件挂到它下面；默认根目录）
 */
export function buildTopicGraph(nodes, taxonomy, { rootId = 'f0', parentOf, anchorId } = {}) {
  const fileByNum = new Map();
  const folderByNum = new Map();
  const inScope = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const f = String(n.id).match(/^file(\d+)$/);
    if (f) fileByNum.set(Number(f[1]), n);
    const d = String(n.id).match(/^f(\d+)$/);
    if (d && Number(d[1]) !== 0) folderByNum.set(Number(d[1]), n);
  }
  // 锚点：当前位置节点优先（深层目录的局部图里可能既没有学科节点也没有根节点）
  const anchor =
    (anchorId && inScope.has(anchorId) && anchorId) ||
    (inScope.has(rootId) && rootId) ||
    [...folderByNum.values()][0]?.id ||
    null;

  const groups = taxonomy?.groups || [];
  // 按 id 去重：目录节点先整体保留（导航入口 + 骨架锚点），学科节点再**就地覆盖**成分类节点，
  // 否则同一个 f<id> 会被 push 两次（React 的 key 重复、d3 也会把它当成两个节点）。
  const byId = new Map();
  for (const n of nodes) if (n.type === 'folder') byId.set(n.id, n);
  const links = [];
  const clusters = [];
  const decoratedFolders = new Set();

  for (const g of groups) {
    const subjectInScope = folderByNum.has(g.subjectId);
    const subjectTotal = g.clusters.reduce((n, c) => n + c.fileIds.length, 0);
    // 学科节点：只要该学科目录在范围内就画（与本地有没有它的文件无关）
    if (subjectInScope) {
      decoratedFolders.add(g.subjectId);
      byId.set(`f${g.subjectId}`, {
        id: `f${g.subjectId}`,
        name: g.subject,
        type: 'topic',
        kind: 'subject',
        size: subjectTotal,
        meta: { folder_id: g.subjectId },
      });
      if (anchor) links.push({ source: anchor, target: `f${g.subjectId}` });
    }
    const parentId = subjectInScope ? `f${g.subjectId}` : anchor;
    if (!parentId) continue;

    for (const c of g.clusters) {
      const present = c.fileIds.filter((id) => fileByNum.has(id));
      if (!present.length) continue;
      if (present.length < 2) {
        // 只有一个文件时不套一层细分节点，直接挂到学科下——**不能丢**：这些文件是已建索引的，
        // 丢掉等于它们在内容视图里凭空消失（文件少的学科尤其常见）。
        for (const fileId of present) {
          const fileNode = fileByNum.get(fileId);
          byId.set(fileNode.id, fileNode);
          links.push({ source: parentId, target: fileNode.id });
        }
        continue;
      }
      const clusterNodeId = `k:${c.key}`;
      byId.set(clusterNodeId, {
        id: clusterNodeId,
        name: c.name || '',
        type: 'topic',
        kind: 'cluster',
        size: present.length,
        meta: { folder_id: g.subjectId },
      });
      links.push({ source: parentId, target: clusterNodeId });
      for (const fileId of present) {
        const fileNode = fileByNum.get(fileId);
        byId.set(fileNode.id, fileNode);
        links.push({ source: clusterNodeId, target: fileNode.id });
      }
      clusters.push({ key: clusterNodeId, nodeIds: present.map((id) => `file${id}`) });
    }
  }

  // 当前范围里的其他子目录接回父目录（节点已在上面统一放入，这里只补边）
  for (const [id, node] of folderByNum) {
    if (decoratedFolders.has(id)) continue;
    const parent = parentOf?.get(id) ?? null;
    const parentInScope = parent != null && folderByNum.has(parent);
    if (!parentInScope && !anchor) continue;
    links.push({ source: parentInScope ? `f${parent}` : anchor, target: node.id });
  }

  // 收口：边必须两端都在节点集里。d3 的 forceLink 遇到悬空端点会直接抛
  // `node not found: <id>`（分类图的边都从根出发，而局部子图里可能没有根节点），
  // 这里滤掉比让画布崩掉好——悬空边本来就画不出来。
  const out = [...byId.values()];
  const nodeIds = new Set(byId.keys());
  const safeLinks = links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
  return { nodes: out, links: safeLinks, clusters };
}

/**
 * 从边集推出每个节点的父节点与邻居（内容分类图里这两种都用得上：
 * 悬停要亮起「子节点 + 所属分类」，并让「文件 → 细分 → 学科 → 根」这条骨架保持高亮）。
 */
function relationsOf(links) {
  const parents = new Map();
  const neighbors = new Map();
  const add = (map, k, v) => {
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(v);
  };
  for (const l of links) {
    const s = endpointId(l.source);
    const t = endpointId(l.target);
    if (!parents.has(t)) parents.set(t, s);
    add(neighbors, s, t);
    add(neighbors, t, s);
  }
  return { parents, neighbors };
}

/** 从节点 id 取后端给的分类标签（学科 / 细分的可读名字）。 */
export function labelOfNode(id, labels) {
  if (!labels) return null;
  const folder = String(id).match(/^f(\d+)$/);
  if (folder) return labels[`folder:${folder[1]}`] || null;
  return labels[`cluster:${String(id).replace(/^k:/, '')}`] || null;
}

/**
 * 知识库 — force-directed graph of the library.
 * 内容档按「学科 → 内容细分 → 文件」组织，目录档保持文件夹层级。
 */
export default function KnowledgeGraph({ currentId = 0, className = '', onFullChange }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Enlarged dialog mode: 'full' = whole library (globe), 'local' = current
  // folder neighborhood zoomed (maximize). null = dialog closed.
  const [dialog, setDialog] = useState(null);
  const [collapsed, setCollapsed] = useState(collapsedPersistent);
  // 视图模式：content（默认，按内容分类）/ folder（按文件夹层级）
  const [viewMode, setViewMode] = useState(viewModePersistent);
  const [taxonomy, setTaxonomy] = useState(null);
  const [contentState, setContentState] = useState('idle'); // idle | loading | ready | error
  const { tree, rootFiles, loading } = useFolderTree();

  useEffect(() => {
    if (viewMode !== 'content') return undefined;
    let alive = true;
    setContentState((prev) => (prev === 'idle' || prev === 'error' ? 'loading' : prev));
    loadKgTaxonomy()
      .then((data) => {
        if (!alive) return;
        if (!data) {
          setContentState('error');
          return;
        }
        setTaxonomy(data);
        setContentState('ready');
      })
      .catch(() => {
        if (alive) setContentState('error');
      });
    return () => {
      alive = false;
    };
  }, [viewMode]);

  // Full graph only depends on the tree + root files: keep it stable across
  // folder navigation so browsing doesn't re-walk/re-allocate the whole library.
  const fullGraph = useMemo(() => buildGraph(tree, rootFiles, t('tree.home')), [tree, rootFiles, t]);
  const { localNodes, localLinks, fullNodes, fullLinks } = useMemo(() => {
    const local = localSubgraph(fullGraph.nodes, fullGraph.links, currentId);
    return {
      localNodes: local.nodes,
      localLinks: local.links,
      // 全库弹窗同样给拷贝：否则它自己的 forceSimulation 会把 fullGraph 的端点改写成对象、
      // 并把位置写进同一批节点对象，和局部图互相踩（同一类问题的另一种表现）。
      fullNodes: fullGraph.nodes.map((n) => ({ ...n })),
      fullLinks: fullGraph.links.map((l) => ({ ...l })),
    };
  }, [fullGraph, currentId]);

  // 目录树里的父子关系（用于把子目录接到父目录下）
  const parentOfFolders = useMemo(() => {
    const map = new Map();
    for (const l of fullGraph.links) {
      const child = String(l.target).match(/^f(\d+)$/);
      const parent = String(l.source).match(/^f(\d+)$/);
      if (child && parent && !map.has(Number(child[1]))) {
        map.set(Number(child[1]), Number(parent[1]) === 0 ? null : Number(parent[1]));
      }
    }
    return map;
  }, [fullGraph]);

  /**
   * 画布数据：内容档用分类图（局部 / 全库两份），目录档用目录层级图。
   * 都用**拷贝**——d3 会就地改写它拿到的节点与边（见 localSubgraph 注释）。
   */
  const canvasData = useMemo(() => {
    const forContent = viewMode === 'content' && taxonomy;
    const build = (nodes, links, anchor) =>
      forContent
        ? buildTopicGraph(nodes, taxonomy, { parentOf: parentOfFolders, anchorId: anchor })
        : { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })), clusters: [] };
    return {
      local: build(localNodes, localLinks, nodeIdOf(currentId)),
      full: build(fullNodes, fullLinks, 'f0'),
      clusters: forContent
        ? buildTopicGraph(localNodes, taxonomy, {
            parentOf: parentOfFolders,
            anchorId: nodeIdOf(currentId),
          }).clusters
        : [],
    };
  }, [viewMode, taxonomy, parentOfFolders, localNodes, localLinks, fullNodes, fullLinks, currentId]);

  /**
   * 内容档在分类数据到达前**不能**先用目录边画一次：局部子图里没有根节点（只含根的直接邻居），
   * 而分类图的所有边都从根出发 → d3 的 forceLink 会抛 `node not found: f0`。
   * 所以这一档必须等数据到齐再渲染画布。
   */
  const canvasReady = viewMode === 'folder' || Boolean(taxonomy);
  // 「空」的判据是**当前范围里一个分类节点都没有**（而不是节点数 ≤1：目录节点总会保留，
  // 拿节点数判断会永远不为空，提示就永远不出现）。
  // 还要区分两种空：整库索引就没东西（all）vs 只是当前位置没有已索引资料（here）——
  // 后者在小文件夹里很常见，提示不该说成「索引里没有可用资料」。
  const canvasEmpty = viewMode === 'content' && taxonomy && !canvasData.local.nodes.some((n) => n.type === 'topic');
  const emptyKind = !canvasEmpty ? null : taxonomy.files > 0 ? 'here' : 'all';

  const onNavigate = useCallback(
    (node) => {
      if (node.type === 'folder' || node.kind === 'subject') {
        const folderId = node.kind === 'subject' ? node.meta?.folder_id : Number(node.id.slice(1));
        navigate(node.isRoot ? '/' : `/folder/${folderId}`);
      } else if (node.kind === 'cluster') {
        // 内容细分节点：进入它所属的学科目录（细分本身不是一个目录，不能跳转过去）
        if (node.meta?.folder_id) navigate(`/folder/${node.meta.folder_id}`);
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

  const labels = taxonomy?.labels || null;
  const dialogData = dialog === 'local' ? canvasData.local : canvasData.full;

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
            <ViewModeButton
              active={viewMode === 'content'}
              onClick={() => setViewModePersistent(setViewMode, 'content')}
              title={t('kg.modeContent')}
              icon={Sparkles}
            />
            <ViewModeButton
              active={viewMode === 'folder'}
              onClick={() => setViewModePersistent(setViewMode, 'folder')}
              title={t('kg.modeFolder')}
              icon={Shuffle}
            />
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
        ) : !canvasReady ? (
          // 分类数据还没到（首次会现算：k-means + 可能的 LLM 命名）
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-slate-500">
            {contentState === 'error' ? t('kg.contentFailed') : t('kg.contentLoading')}
          </div>
        ) : canvasEmpty ? (
          // 没聚出任何分类：整库索引为空（all）或只是当前位置没资料（here）
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-slate-500">
            {emptyKind === 'all' ? t('kg.contentEmpty') : t('kg.contentEmptyHere')}
          </div>
        ) : (
          <GraphCanvas
            nodes={canvasData.local.nodes}
            links={canvasData.local.links}
            currentId={currentId}
            onNavigate={onNavigate}
            height={GRAPH_H}
            clusterNodes={canvasData.clusters.map((c) => new Set(c.nodeIds))}
            labels={labels}
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
              nodes={dialogData.nodes}
              links={dialogData.links}
              currentId={currentId}
              onNavigate={onNavigate}
              height="100%"
              clusterNodes={
                viewMode === 'content'
                  ? (dialog === 'local' ? canvasData.clusters : canvasData.clusters).map((c) => new Set(c.nodeIds))
                  : []
              }
              labels={labels}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GraphCanvas({ nodes, links, currentId, onNavigate, height, clusterNodes, labels }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const dragRef = useRef(null);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState(null);
  // 图例已去掉：悬停某簇的入口没有了，只保留「悬停节点亮起它的关系」这条交互。
  const neighborsRef = useRef(new Set());
  const parentRef = useRef(null);

  // 节点 id → 簇槽号（= 上色顺序）；渲染着色与簇心布局共用。
  const slotOf = useMemo(() => {
    const map = new Map();
    clusterNodes.forEach((set, slot) => {
      for (const id of set) map.set(id, slot);
    });
    return map;
  }, [clusterNodes]);

  const clusterColorFor = useMemo(() => {
    const palette = [];
    for (let i = 0; i < MAX_SEMANTIC_COLORS; i += 1) palette.push(semanticColorFor(i));
    return (slot) => palette[slot];
  }, []);

  const degrees = useMemo(() => buildDegrees(links), [links]);
  const radiusOf = useCallback(
    (n) => (n.type === 'topic' ? 4 + Math.sqrt(n.size || 1) * 1.6 : 2 + Math.sqrt(degrees[n.id] || 0) * 2.2),
    [degrees]
  );
  const current = nodeIdOf(currentId);
  const { parents, neighbors } = useMemo(() => relationsOf(links), [links]);

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
          .distance((l) => (endpointId(l.source) === 'f0' ? 70 : 46))
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
      // 解绑 tick（BUG-67）：只 stop 不摘监听时，旧模拟的回调仍在（节点集每次变化都重建
      // 一份 simulation），卸载后继续 setState、逐帧触发无意义重渲染。
      sim.on('tick', null);
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  /* 簇心定位：按簇心把同簇节点轻轻拉开（forceX/forceY 指向各自簇心）。
   * 实测强度 0.05：再大整张图会被拽成几个硬邦邦的圆团，层级/分类骨架看不出来。 */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return undefined;
    const sums = new Map(); // slot → { x, y, count }
    for (const n of nodes) {
      const slot = slotOf.get(n.id);
      if (slot === undefined) continue;
      const acc = sums.get(slot) || { x: 0, y: 0, count: 0 };
      if (Number.isFinite(n.x)) {
        acc.x += n.x;
        acc.y += n.y;
      }
      acc.count += 1;
      sums.set(slot, acc);
    }
    if (!sums.size) {
      sim.force('semanticX', null);
      sim.force('semanticY', null);
      return undefined;
    }
    const centerOf = (n) => {
      const acc = sums.get(slotOf.get(n.id));
      if (!acc) return [VIEW_W / 2, VIEW_H / 2];
      return [acc.x / acc.count, acc.y / acc.count];
    };
    sim
      .force('semanticX', forceX((n) => centerOf(n)[0]).strength(SEMANTIC_PULL))
      .force('semanticY', forceY((n) => centerOf(n)[1]).strength(SEMANTIC_PULL));
    sim.alpha(0.3).restart(); // 让新力生效（仿真此时已 stop）
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, slotOf]);

  // Recompute neighbors（悬停亮起：直接邻居 + 所属分类 + 分类骨架，其余淡出）
  const onHover = useCallback(
    (id) => {
      setHovered(id);
      if (!id) {
        neighborsRef.current = new Set();
        parentRef.current = null;
        return;
      }
      const set = new Set([id]);
      for (const nb of neighbors.get(id) || []) set.add(nb);
      // 所属分类（父节点）与它的上级也亮着，文件才不会显得「无依无靠」
      let parent = parents.get(id) || null;
      let guard = 0;
      while (parent && guard < 4) {
        set.add(parent);
        parent = parents.get(parent) || null;
        guard += 1;
      }
      neighborsRef.current = set;
      parentRef.current = parents.get(id) || null;
    },
    [neighbors, parents]
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

  // 内容分类图里节点少、语义重，标签默认就显示；目录图沿用「放大或悬停才显示」。
  const hasTopics = nodes.some((n) => n.type === 'topic');
  const showLabels = hasTopics || view.k > 1.2;
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
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={active && hovered ? 'var(--ink)' : 'var(--line-strong)'}
                strokeWidth={1}
                opacity={dim ? 0.05 : hovered ? 0.55 : 0.4}
              />
            );
          })}
          {nodes.map((n) => {
            const r = radiusOf(n);
            const slot = slotOf.get(n.id);
            const dim = hovered && !neighborsRef.current.has(n.id);
            const isFolder = n.type === 'folder';
            const isTopic = n.type === 'topic';
            const isCurrent = n.id === current;
            const clusterColor =
              slot !== undefined && slot < MAX_SEMANTIC_COLORS ? clusterColorFor(slot) : undefined;
            const topicLabel = isTopic ? n.name || labelOfNode(n.id, labels) : null;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                style={{
                  cursor: 'pointer',
                  opacity: dim ? 0.12 : 1,
                  transition: 'opacity 150ms',
                }}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPointerMove={onNodeMove}
                onPointerUp={(e) => onNodeUp(e, n)}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
              >
                {isCurrent && (
                  <circle r={r + 3} fill="none" stroke="var(--ink)" strokeWidth={1.2} opacity={0.5} />
                )}
                {/* 分类节点实心 + 簇色，构成图骨架；同一内容细分的文件用同色描边，
                    这样「一组资料」在视觉上是一体的（悬停/着色都与分类一致）。 */}
                <circle
                  r={r}
                  fill={
                    isTopic
                      ? clusterColor || 'var(--ink)'
                      : isFolder
                        ? 'var(--ink)'
                        : 'var(--surface)'
                  }
                  stroke={clusterColor || (isFolder ? 'var(--ink)' : 'var(--line-strong)')}
                  strokeWidth={isTopic ? 1.2 : clusterColor ? 1.4 : 1}
                />
                {(showLabels || hovered === n.id) && (topicLabel || !isTopic) && (
                  <text
                    y={-r - 6}
                    textAnchor="middle"
                    fontSize={isTopic ? 11 : 10}
                    fontWeight={isTopic ? 600 : 400}
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{
                      fill: 'var(--ink)',
                      stroke: 'var(--kg-label-stroke)',
                      pointerEvents: 'none',
                    }}
                  >
                    {displayName(topicLabel || n.name)}
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
