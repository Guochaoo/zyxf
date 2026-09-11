import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Hash, Maximize, Shuffle, Sparkles, X } from 'lucide-react';
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
import { getKgSemantics } from '../api.js';

const VIEW_W = 600;
const VIEW_H = 420;

// 簇心拉力强度：越大簇越紧、层级骨架越糊。0.05 是实测取值（见 GraphCanvas 的语义布局注释）。
const SEMANTIC_PULL = 0.05;

// 图谱区高度：原卡片高 295px，头部栏占 37px（p-1.5×2 + size-6 + 1px 分割线）。
const GRAPH_H = '258px';

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建）。
let collapsedPersistent = false;

// 语义视图模式跨导航保留（理由同上：右栏组件会卸载重建）。
// 三档：content = 按文件内容向量聚类；name = 按文件名主题聚类；folder = 只看目录层级。
export const VIEW_MODES = ['content', 'name', 'folder'];
const DEFAULT_VIEW_MODE = 'content';
let viewModePersistent = DEFAULT_VIEW_MODE;

/**
 * 内容视图数据在模块级去重：整库向量边是全局数据，右栏组件随路由卸载重建，
 * 用一个共享的在途 Promise 保证「同时挂载/来回切档只发一次请求」。
 */
let kgSemanticsInflight = null;
function loadKgSemantics() {
  if (!kgSemanticsInflight) {
    kgSemanticsInflight = getKgSemantics()
      .catch(() => null)
      .then((data) => {
        // 失败时清掉缓存，下次切档可重试（成功的结果整会话复用）
        if (!data) kgSemanticsInflight = null;
        return data;
      });
  }
  return kgSemanticsInflight;
}

/** 仅供测试：清掉内容视图的共享缓存。 */
export function __resetKgSemanticsCache() {
  kgSemanticsInflight = null;
}

/** 切档并跨导航记住（右栏组件会随路由卸载重建）。 */
function setViewModePersistent(setter, mode) {
  viewModePersistent = mode;
  setter(mode);
}

/** 档位按钮：与前两个图标按钮同款外观，用 aria-pressed 表达当前档（三档单选）。 */
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

/* ---- 语义层：把「名称里的主题」变成边与簇 -------------------------------------
 * 图谱原本只有目录层级边，语义组织必须先制造信号。全部走名称层（不读文件内容），
 * 三个纯函数按顺序串起来：tokenizeNodeName → buildSemanticEdges → buildClusters。
 *
 * 阈值是拿真实库跑出来的（908 个节点 / 850 个文件），不是拍的：
 *   - 只比同类型节点（文件↔文件、文件夹↔文件夹）。跨类型连边会把「文件夹名必是其后代
 *     节点 token 子集」的结构变成星形全连通，必然塌成一个巨簇；
 *   - 共享 token 只算「库内非套话」的那些（df ≤ MAX_SEMANTIC_DF），且至少 2 个：套话词
 *     （数学/大学…）命中再多也不能证明同主题；
 *   - 共享 token 要占较小的那个主题集合的 1/2 以上：否则长名称之间靠零散公共词连边；
 *   - 再用 idf 加权的 Jaccard ≥ 0.6 卡一道：'西安'/'交通' 这类库内高频词即使命中多，
 *     权重也被压低。实测这一组阈值把「265 节点的巨簇」拆成 ~100 个主题簇、最大 17。
 */
export const MAX_SEMANTIC_DF = 15; // 出现在超过这么多文档里的 token 视为库内套话，不参与连边
export const MIN_SHARED_TOKENS = 2;
export const MIN_TOKEN_OVERLAP = 0.5;
export const MIN_WEIGHTED_JACCARD = 0.6;

// 出现在「词与词交界」上的停用字。它们不删除 token，而是把中文串在**这里切开**，
// 只在切出的片段内部生成 n-gram：「高等数学期末试卷」→ 高 | 数学 | 期末 | 试，
// 于是留下「数学」这类真主题词，切掉「学期」这种跨词碎片——后者在库内出现频率极高
// （任意「XX数学期中」与「XX物理期末」都会撞上），足以把不相关学科连成一片。
// ⚠️ 判据是「单独成词时没有主题信息」，不是「常出现在套话里」。数/物/理/化/学 这类
// 学科相关字一个都不能收——「数学」「有机化学」会被切碎；偶尔漏出「学期」这种跨词碎片
// 由 STOP_WORDS 与 idf 加权兜底（库内高频词的权重被压低，连不成边）。
// 与 和 及 或 的 之 等 中 第 年 级 版 次 末 卷 参 答 总 汇 复 讲
const STOP_CHARS = new Set([
  '\u4e0e', '\u548c', '\u53ca', '\u6216', '\u7684', '\u4e4b', '\u7b49', '\u4e2d', '\u7b2c', '\u5e74',
  '\u7ea7', '\u7248', '\u6b21', '\u672b', '\u5377', '\u53c2', '\u7b54', '\u603b', '\u6c47', '\u590d',
  '\u8bb2',
]);

// 泛词：文档性质 + 编排套话。这类词讲「这是什么类型的材料」，不讲「讲哪门课」。
// ⚠️ 下面的中文数据不是界面文案、也不该随语言切换，i18n 的「源码里不许硬编码中文」规则
// 对它不适用，故整段标注豁免（见 test/i18n.test.js 的豁免说明）。
// i18n-exempt-cjk
const STOP_WORDS = new Set([
  '讲义', '课件', '资料', '往年题', '往年', '真题', '试题', '答案', '参考答案', '参考',
  '作业', '习题', '练习', '复习', '期末', '期中', '考试', '上机', '教材', '教辅', '笔记',
  '总结', '汇总', '基础', '重点', '难点', '典型', '题解', '课堂', '随堂', '课程', '讲稿',
  '试卷', '大纲', '提纲', '解答', '例题', '自测题', '样卷', '样题', '知识点', '梳理', '附加',
  '部分', '全套', '最新', '完整', '大学', '第一', '第二', '第三', '第四', '第五',
]);
// 文件名里常见的英文泛词（the/and 这类连接词与格式词）。
const STOP_LATIN = new Set([
  'the', 'and', 'for', 'with', 'via', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'rar',
  'png', 'jpg', 'chap', 'chapter', 'part', 'vol', 'unit', 'test', 'answer', 'answers',
  'english', 'final', 'mid',
]);

const SEMANTIC_KEY_PATTERN = /[_\-.,+·、()（）[\]【】《》<>"'~!?=:;|\\/]+/g;

function normalizeForTokens(raw) {
  return String(raw || '')
    .normalize('NFKC') // 全角括号/字母/数字统一成半角，否则「（１）」与「(1)」切法不同
    .replace(SEMANTIC_KEY_PATTERN, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 名称 → 主题 token 集合（中文 2/3-gram + 拉丁词；不读文件内容）。 */
export function tokenizeNodeName(name, isFile = false) {
  const tokens = new Set();
  // 去掉文件扩展名。⚠️ 不能用 /\.[A-Za-z0-9]{1,5}$/ 这种「点 + 1~5 位」的写法：对
  // 「试卷A.pdf」它先命中「.pdf」把 A 留在主题里，而「试卷A.PDF」又会因为大小写而
  // 走到另一条分支，同一份资料在两种写法下切出不同 token。这里按最后一个点切开，
  // 只要点后面是 1~5 位字母数字就当扩展名（「试卷A.pdf」→「试卷A」）。
  const rawName = String(name || '');
  const dot = rawName.lastIndexOf('.');
  const stripped = isFile && dot > 0 && /^[A-Za-z0-9]{1,5}$/.test(rawName.slice(dot + 1))
    ? rawName.slice(0, dot)
    : rawName;
  const normalized = normalizeForTokens(stripped);
  // 按停用字把中文串切成片段，只在片段内部生成 n-gram（见 STOP_CHARS 的说明）。
  // 连续的停用字算**一个**边界：「高等数学期末试卷」= 高 |(等)| 数学 |(期末)| 试卷，
  // 不给「期末」留下被拆成单字再粘成「学期」的机会。
  const segments = [];
  let segment = [];
  let inStopRun = false;
  const flush = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };
  for (const word of normalized.split(' ')) {
    const chars = [...word];
    let latin = '';
    for (const ch of chars) {
      if (/[\u4e00-\u9fff]/.test(ch)) {
        if (STOP_CHARS.has(ch)) {
          if (!inStopRun) flush();
          inStopRun = true;
        } else {
          segment.push(ch);
          inStopRun = false;
        }
        if (latin) {
          if (latin.length >= 3) tokens.add(latin);
          latin = '';
        }
      } else if (/[a-z0-9]/.test(ch)) {
        latin += ch;
      } else if (latin) {
        if (latin.length >= 3) tokens.add(latin);
        latin = '';
      }
    }
    if (latin.length >= 3) tokens.add(latin);
    flush(); // 空格/标点本身就是词边界：不让 n-gram 跨过去
    inStopRun = false;
  }
  for (const part of segments) {
    // 单个字不成词，直接丢掉。「高等数学」被切成 高 | 数学 时，「高」留下不会帮忙，
    // 反而会跟下一个片段的首字粘成「学期」这种跨词碎片（正是要剪掉的东西）。
    // 真正的缩写「高数」「大物」本身就是一个片段，n-gram 天然覆盖。
    for (let i = 0; i < part.length - 1; i += 1) tokens.add(part[i] + part[i + 1]);
    // 3-gram 让「化工原理」这类整课名成为一个 token，分章资料才连得上。
    for (let i = 0; i < part.length - 2; i += 1) {
      tokens.add(part[i] + part[i + 1] + part[i + 2]);
    }
  }
  for (const t of [...tokens]) {
    if (STOP_WORDS.has(t) || STOP_LATIN.has(t) || /^(19|20)\d\d$/.test(t)) tokens.delete(t);
  }
  return tokens;
}

/**
 * 给节点补上主题 token（不改入参）。同目录兜底边靠 meta.folder_id，所以不做节点树回溯。
 */
export function buildSemanticNodes(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    tokens: tokenizeNodeName(n.name, n.type === 'file'),
    folderId: n.meta?.folder_id ?? null,
  }));
}

/** 主题索引：文档频次 → idf、每个节点的主题 token 与总权重。buildSemanticEdges 的唯一前置。 */
function buildThemeIndex(nodes) {
  const docFreq = new Map();
  for (const n of nodes) {
    for (const t of n.tokens) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log(1 + nodes.length / (1 + (docFreq.get(t) || 1)));
  // 库内套话（出现超过 MAX_SEMANTIC_DF 个文档的 token）不算主题：既不计入权重、也不计入
  // 共享个数。少算一半都不行——只压权重时，「数学」这种 df≈68 的词只要命中一条就能把
  // 全库数学类资料连成一个几百节点的巨簇（实测 908 节点里 282 个连成一片）。
  const themeTokens = new Map();
  for (const n of nodes) {
    // 单字 token 不参与成簇：停用字切出的「案」「章」在库内是 df 80+ 的套话碎片
    // （答案/第X章），两个文件各命中一个就能凑够 2 个共享 token，实测会把 908 个节点里的
    // 331 个连成一簇。纯缩写（「高数.pdf」切完只剩「高」）由同目录弱边兜底接回去，
    // 不走这条「单字也算主题」的路，否则「高」和「案」又能把全库连起来。
    themeTokens.set(
      n.id,
      [...n.tokens].filter((t) => t.length >= 2 && (docFreq.get(t) || 0) <= MAX_SEMANTIC_DF)
    );
  }
  const weights = new Map();
  for (const n of nodes) weights.set(n.id, themeTokens.get(n.id).reduce((sum, t) => sum + idf(t), 0));
  return { docFreq, idf, themeTokens, weights };
}

/** 候选对：只取「共享至少一个非套话主题 token」的节点对（按 id 去重）。 */
function collectThemePairs(nodes, themeTokens) {
  const postings = new Map(); // token → 含它的节点 id
  for (const n of nodes) {
    for (const t of themeTokens.get(n.id)) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(n.id);
    }
  }
  const pairs = new Set();
  for (const ids of postings.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        pairs.add(ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`);
      }
    }
  }
  return [...pairs].map((k) => k.split('|'));
}

/** 语义边：同类型节点之间，共享主题 token 达到阈值即连边（权重 = idf 加权重合度）。 */
export function buildSemanticEdges(semanticNodes) {
  const nodes = Array.isArray(semanticNodes) ? semanticNodes : [];
  const { idf, themeTokens, weights } = buildThemeIndex(nodes);

  const edges = [];
  const connect = (a, b) => {
    // 两个名称都只剩套话 token 时不存在主题，直接跳过（否则边界情况 0/0 会连出假边）。
    const wa = weights.get(a.id);
    const wb = weights.get(b.id);
    if (!wa || !wb) return;
    const shared = themeTokens.get(a.id).filter((t) => b.tokens.has(t));
    if (shared.length < MIN_SHARED_TOKENS) return;
    const smallerTheme = Math.min(themeTokens.get(a.id).length, themeTokens.get(b.id).length);
    if (shared.length / smallerTheme < MIN_TOKEN_OVERLAP) return;
    const sharedWeight = shared.reduce((sum, t) => sum + idf(t), 0);
    if (sharedWeight / Math.min(wa, wb) < MIN_WEIGHTED_JACCARD) return;
    edges.push({ source: a.id, target: b.id, weight: shared.length, tokens: shared });
  };

  // 候选对来自倒排表而不是全库两两比对：全量比对在 908 节点上实测 54 ms（本层唯一的
  // 耗时点），而绝大多数节点对连一个主题 token 都不共享。判据一个字没改——这里只是把
  // 「必然不满足 shared ≥ 2」的对提前排除。
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const [aId, bId] of collectThemePairs(nodes, themeTokens)) {
    const a = byId.get(aId);
    const b = byId.get(bId);
    // 只比同类型：跨类型时「文件夹名必是其子节点 token 的子集」，会连成星形巨簇。
    if (a && b && a.type === b.type) connect(a, b);
  }
  const fileNodes = nodes.filter((n) => n.type === 'file');

  // 兜底：文件名本身没有任何 token（例如「2019.6.18.pdf」这种纯日期）时，同目录至少还算
  // 相关，连一条权重 1 的弱边。判据必须是「token 为空」而不是「主题为空」——按后者的话，
  // 一个把「高」「案」这类单字全部过滤掉的纯缩写名会变成空壳，再多连几个同目录资料就能把
  // 本来分属不同主题的簇桥接成巨簇（实测 908 个节点里 348 个连成一片）。
  const byFolder = new Map();
  for (const n of fileNodes) {
    if (!n.folderId) continue;
    if (!byFolder.has(n.folderId)) byFolder.set(n.folderId, []);
    byFolder.get(n.folderId).push(n);
  }
  for (const siblings of byFolder.values()) {
    if (siblings.length < 2) continue;
    for (let i = 0; i < siblings.length; i += 1) {
      for (let j = i + 1; j < siblings.length; j += 1) {
        const a = siblings[i];
        const b = siblings[j];
        // 只有一边完全没有 token 时才连；两边都有内容就交给 connect 判断。
        if (a.tokens.size && b.tokens.size) continue;
        if (!a.tokens.size && !b.tokens.size) continue;
        edges.push({ source: a.id, target: b.id, weight: 1, weak: true, tokens: [] });
      }
    }
  }
  return edges;
}

export function buildClusters(nodes, semanticEdges, semanticNodes) {
  const labels = new Map((semanticNodes || []).map((n) => [n.id, n.tokens]));
  const parent = new Map();
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of semanticEdges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    const ra = find(e.source);
    const rb = find(e.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const n of nodes) {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n.id);
  }
  const clusters = [];
  for (const members of groups.values()) {
    const labelCount = new Map();
    for (const id of members) for (const t of labels.get(id) || []) labelCount.set(t, (labelCount.get(t) || 0) + 1);
    const top = [...labelCount.entries()]
      // 标签要代表整簇，不是「这一簇里恰好出现过的词」：要求覆盖三分之一的成员
      // （51 个化学课件里 12 个提到的「生命科学」不该当这簇的名字）。
      .filter(([, count]) => count >= Math.max(2, Math.ceil(members.length / 3)))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 2)
      .map(([t]) => t);
    clusters.push({ key: members[0], nodeIds: members, label: top.join(' · ') || null });
  }
  // 大簇在前：图例取前几个就够，顺序稳定（同尺寸按 key 排）才不会有每次渲染跳色的观感。
  clusters.sort(
    (a, b) =>
      b.nodeIds.length - a.nodeIds.length ||
      (a.nodeIds[0] < b.nodeIds[0] ? -1 : a.nodeIds[0] > b.nodeIds[0] ? 1 : 0)
  );
  return clusters;
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
 * 内容视图：把后端给的「最相似邻居」边收敛进来。
 * 后端已做 top-K 截断与阈值过滤（见 routes/indexing.js 的 /semantics），这里只做三件事：
 *   1. 只保留两端都在当前视图范围内的边；
 *   2. 成簇——阈值以上的边取连通分量；
 *   3. 簇标签取簇内最高频的目录名（不调 LLM 也能读出「这一簇是什么」）。
 *
 * ⚠️ 成簇阈值 0.78 是在真实向量上标定的，不是拍的：346 个文件的相似度分布里，
 *   0.75 → 最大簇 112 个成员（链式效应把跨学科的「南卷汇」试卷集串成一坨），
 *   0.78 → 最大 46、0.80 → 最大 23。取 0.78 兼顾「该合的合上」与「不该合的不合」。
 */
export const VECTOR_LINK_THRESHOLD = 0.78;

/** 后端回的是数据库 file_id（数字），图谱节点 id 是 «file<id>»：两端必须归一，否则一条边都接不上。 */
export const vectorNodeId = (id) => (String(id).startsWith('file') ? String(id) : `file${id}`);

export function buildVectorGraph(nodes, edges, labels) {
  // 两边都过 vectorNodeId：节点在图谱里是 'file11'，后端回的是 11，不归一就一条边都接不上
  const scope = new Set(nodes.map((n) => vectorNodeId(n.id)));
  const inScope = (edges || [])
    .map((e) => ({ ...e, source: vectorNodeId(e.source), target: vectorNodeId(e.target) }))
    .filter((e) => scope.has(e.source) && scope.has(e.target));
  const clustered = inScope.filter((e) => e.weight >= VECTOR_LINK_THRESHOLD);

  const parent = new Map(nodes.map((n) => [vectorNodeId(n.id), vectorNodeId(n.id)]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const e of clustered) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    const ra = find(e.source);
    const rb = find(e.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const n of nodes) {
    const key = vectorNodeId(n.id);
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }
  const clusters = [];
  for (const ids of groups.values()) {
    const counted = new Map();
    for (const id of ids) {
      const label = labels?.[id] ?? labels?.[Number(String(id).replace(/^file/, ''))];
      if (label) counted.set(label, (counted.get(label) || 0) + 1);
    }
    const top = [...counted.entries()]
      .filter(([, count]) => count >= Math.max(2, Math.ceil(ids.length / 3)))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 1)
      .map(([t]) => t);
    clusters.push({ key: ids[0], nodeIds: ids, label: top[0] || null });
  }
  clusters.sort(
    (a, b) =>
      b.nodeIds.length - a.nodeIds.length ||
      (a.nodeIds[0] < b.nodeIds[0] ? -1 : a.nodeIds[0] > b.nodeIds[0] ? 1 : 0)
  );
  return { edges: inScope, clusters };
}

/**
 * 图例：只列成员 ≥2 且有标签的簇（单点没有「聚成一类」的含义，列出来只是噪音），
 * 取前 MAX_SEMANTIC_COLORS 个（色槽数量与画布上色一致）。
 */
function legendOf(clusters) {
  return clusters
    .filter((cluster) => cluster.nodeIds.length > 1 && cluster.label)
    .slice(0, MAX_SEMANTIC_COLORS)
    .map((cluster, index) => ({
      key: cluster.key,
      label: cluster.label,
      count: cluster.nodeIds.length,
      color: semanticColorFor(index),
    }));
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
  // 视图模式：content（默认，按内容向量聚类）/ name（按文件名主题）/ folder（纯目录层级）
  const [viewMode, setViewMode] = useState(viewModePersistent);
  // 内容视图的数据：整库级别，只在切到 content 档时拉一次。
  // ⚠️ 用「模块级在途 Promise + 显式 refresh」而不是把 contentState 放进 effect 依赖：
  // 后者会在 setLoading 时立即重跑 effect，cleanup 把 cancelled 置真，数据回来就被丢掉
  // （表现是内容视图永远停在「正在读取内容索引」，但网络请求其实成功了）。
  const [contentData, setContentData] = useState(null);
  const [contentState, setContentState] = useState('idle'); // idle | loading | ready | error
  const { tree, rootFiles, loading } = useFolderTree();

  useEffect(() => {
    if (viewMode !== 'content') return undefined;
    let alive = true;
    setContentState((prev) => (prev === 'idle' || prev === 'error' ? 'loading' : prev));
    loadKgSemantics()
      .then((data) => {
        if (!alive) return;
        if (!data) {
          setContentState('error');
          return;
        }
        setContentData(data);
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

  /**
   * 语义层：两档数据来源，输出同一种结构（nodes / edges / clusters / legend），
   * 下游渲染（虚线边、簇色、图例、簇心布局）完全共用。
   *   - content：边来自后端算好的内容向量相似度，簇标签 = 簇内最高频目录名；
   *   - name：边来自文件名主题（本地纯函数），簇标签 = 共享 token。
   * 都不写回 fullGraph —— d3 会就地改写它拿到的节点/边（见 localSubgraph 注释）。
   */
  const semantics = useMemo(() => {
    if (viewMode === 'folder') return null;
    if (viewMode === 'content') {
      if (!contentData) return null;
      const { edges, clusters } = buildVectorGraph(fullGraph.nodes, contentData.edges, contentData.labels);
      return { nodes: [], edges, clusters, legend: legendOf(clusters) };
    }
    const semanticNodes = buildSemanticNodes(fullGraph.nodes);
    const edges = buildSemanticEdges(semanticNodes);
    // 簇序即色槽序（buildClusters 已按规模排好）：图例第 i 项与画布上第 i 槽同色。
    const clusters = buildClusters(fullGraph.nodes, edges, semanticNodes);
    return { nodes: semanticNodes, edges, clusters, legend: legendOf(clusters) };
  }, [viewMode, contentData, fullGraph]);

  // 当前视图范围内实际要画的语义边（局部视图只画两端都在场的边）。
  const semanticEdgesIn = useCallback(
    (nodes) => {
      if (!semantics) return [];
      const scope = new Set(nodes.map((n) => n.id));
      return semantics.edges.filter((e) => scope.has(e.source) && scope.has(e.target));
    },
    [semantics]
  );
  // 节点 → 所属簇（渲染上色用）；不传时退化成原来的「文件夹墨黑 / 文件白」。
  const clusterNodes = semantics
    ? semantics.clusters.slice(0, MAX_SEMANTIC_COLORS).map((c) => new Set(c.nodeIds))
    : [];
  const legend = semantics ? semantics.legend : [];

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
            <ViewModeButton
              active={viewMode === 'content'}
              onClick={() => setViewModePersistent(setViewMode, 'content')}
              title={t('kg.modeContent')}
              icon={Sparkles}
            />
            <ViewModeButton
              active={viewMode === 'name'}
              onClick={() => setViewModePersistent(setViewMode, 'name')}
              title={t('kg.modeName')}
              icon={Hash}
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
        ) : viewMode === 'content' && !semantics ? (
          // 内容视图的数据还没到（首次拉向量边）：给明确反馈，不要显示成「没有数据」
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-slate-500">
            {contentState === 'error' ? t('kg.contentFailed') : t('kg.contentLoading')}
          </div>
        ) : viewMode === 'content' && semantics.edges.length === 0 ? (
          // 索引建完了但没有任何向量边：可能是模型没装、或这批文件都是扫描件/老格式。
          // 明确指向名称视图，否则看起来和「图谱坏了」一样。
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-slate-500">
            {t('kg.contentEmpty')}
          </div>
        ) : (
          <GraphCanvas
            nodes={localNodes}
            links={localLinks}
            currentId={currentId}
            onNavigate={onNavigate}
            height={GRAPH_H}
            semanticEdges={semanticEdgesIn(localNodes)}
            clusterNodes={clusterNodes}
            legend={legend}
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
              semanticEdges={semanticEdgesIn(dialog === 'local' ? localNodes : fullNodes)}
              clusterNodes={clusterNodes}
              legend={legend}
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

function GraphCanvas({ nodes, links, currentId, onNavigate, height, semanticEdges, clusterNodes, legend }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const dragRef = useRef(null);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState(null);
  // 图例悬停：点亮某一簇（其余节点淡出），让「这簇到底是哪些资料」可查。
  const [legendHover, setLegendHover] = useState(-1);
  const neighborsRef = useRef(new Set());
  // 语义边的端点解析成节点引用（只读：仿真不绑定这些边，见下面 forceX/forceY 的注释）。
  const semanticDraw = useMemo(() => {
    if (!semanticEdges?.length) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return semanticEdges
      .map((e) => ({ source: byId.get(e.source), target: byId.get(e.target), weight: e.weight }))
      .filter((e) => e.source && e.target);
  }, [semanticEdges, nodes]);

  const clusterColorFor = useMemo(() => {
    const palette = [];
    for (let i = 0; i < MAX_SEMANTIC_COLORS; i += 1) palette.push(semanticColorFor(i));
    return (slot) => palette[slot];
  }, []);

  // 节点 id → 簇槽号（= 图例序号）：渲染上色、图例悬停过滤、簇心布局共用同一张表。
  const slotOf = useMemo(() => {
    const map = new Map();
    clusterNodes.forEach((set, slot) => {
      for (const id of set) map.set(id, slot);
    });
    return map;
  }, [clusterNodes]);

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
      // 解绑 tick（BUG-67）：只 stop 不摘监听时，旧模拟的回调仍在（节点集每次变化都重建
      // 一份 simulation），卸载后继续 setState、逐帧触发无意义重渲染。
      sim.on('tick', null);
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  /* 语义簇定位：按簇心把同簇节点轻轻拉开（forceX/forceY 指向各自簇心），目录层级边仍然
   * 负责整体骨架。刻意**不**把语义边绑进 forceLink：那会让 d3 就地改写我们传入的语义边
   * 端点（同 BUG-98 那类「共享对象被改写」的坑），而且语义边数量远多于目录边，会盖过层级布局。
   * 强度取 0.05 是实测值：再大整张图会被拽成几个硬邦邦的圆团，层级结构看不出来。 */
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
      {/* 图例：只列成员 ≥2 的簇（单点没有「聚成一类」的含义）。悬停可点亮该簇。 */}
      {legend.length > 0 && (
        <foreignObject x={6} y={6} width={VIEW_W - 12} height={VIEW_H - 12} pointerEvents="none">
          <div className="flex max-w-[54%] flex-wrap gap-x-2.5 gap-y-1">
            {legend.map((item, i) => (
              <span
                key={item.key}
                className="flex items-center gap-1 rounded px-1 text-[9px] leading-4"
                style={{
                  color: 'var(--ink-2)',
                  background: 'var(--kg-legend-bg)',
                  opacity: legendHover >= 0 && legendHover !== i ? 0.4 : 1,
                  pointerEvents: 'auto',
                  cursor: 'default',
                }}
                onMouseEnter={() => setLegendHover(i)}
                onMouseLeave={() => setLegendHover(-1)}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: item.color || 'var(--ink-3)' }}
                />
                {displayName(item.label)}
              </span>
            ))}
          </div>
        </foreignObject>
      )}
      {positioned && (
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* 语义边画在层级边之前（更底层），虚线与目录实线区分：它表达「主题相关」，
              不是「属于同一目录」。画层级边时按 hover 关联关系，语义边不做 hover 高亮。 */}
          {semanticDraw.map((e, i) => {
            const slot = slotOf.get(e.source.id);
            const faded = legendHover >= 0 && slot !== legendHover;
            return (
              <line
                key={`s-${i}`}
                x1={e.source.x}
                y1={e.source.y}
                x2={e.target.x}
                y2={e.target.y}
                stroke={hovered ? 'var(--line-strong)' : 'var(--kg-semantic-line)'}
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={hovered ? 0.12 : faded ? 0.06 : 0.5}
              />
            );
          })}
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
                stroke={hovered ? 'var(--ink)' : 'var(--line-strong)'}
                strokeWidth={1}
                opacity={dim ? 0.05 : hovered ? 0.7 : 0.5}
              />
            );
          })}
          {nodes.map((n) => {
            const r = radiusOf(n);
            const slot = slotOf.get(n.id);
            const inLegendCluster = legendHover < 0 || slot === legendHover;
            const dim = (hovered && !neighborsRef.current.has(n.id)) || !inLegendCluster;
            const isFolder = n.type === 'folder';
            const isCurrent = n.id === current;
            // 超出色板的簇不给颜色（用中性兜底），避免不同主题拿到同一个颜色看起来像同一类。
            const clusterColor = slot !== undefined && slot < MAX_SEMANTIC_COLORS ? clusterColorFor(slot) : undefined;
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
                  <circle r={r + 3} fill="none" stroke="var(--ink)" strokeWidth={1.2} opacity={0.5} />
                )}
                {/* 文件夹仍用实心、文件仍用空心（这一层语义不能被颜色抢掉）：
                    有簇色时只换颜色，没有簇色时保持原来的墨黑/白。 */}
                <circle
                  r={r}
                  fill={clusterColor || (isFolder ? 'var(--ink)' : 'var(--surface)')}
                  stroke={clusterColor || (isFolder ? 'var(--ink)' : 'var(--line-strong)')}
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
