import { describe, test, expect } from 'vitest';
import {
  buildGraph,
  localSubgraph,
  buildDegrees,
  nodeIdOf,
  endpointId,
  tokenizeNodeName,
  buildSemanticNodes,
  buildSemanticEdges,
  buildClusters,
} from '../components/KnowledgeGraph.jsx';

// 线上现象：进入某个文件夹再返回主页（folderId=0）后，知识图谱只剩中间一个小点。
// 根因：d3-force 会就地改写传给它的对象——forceLink 把 link.source/target 从字符串 id
// 换成节点对象，forceSimulation 往节点上写 x/y。而 fullGraph 是跨导航复用的 memo，
// 于是「第二次进同一处」时 `l.source === 'f0'` 这种字符串比较全部失配，局部子图退化成单节点；
// buildDegrees 也把度数记到 "[object Object]" 上，节点半径全塌成 2px。
const tree = [
  { id: 1, name: 'ACM', children: [], files: [{ id: 11, name: 'a.pdf' }] },
  { id: 6, name: '高数', children: [{ id: 7, name: '期中', children: [], files: [] }], files: [{ id: 12, name: 'b.pdf' }] },
];
const rootFiles = [{ id: 99, name: 'root.pdf' }];
const rootName = '首页';

// 模拟 d3-force 跑过一轮之后的副作用：端点变对象、节点带坐标。
function simulateD3Mutation(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) {
    n.x = 1;
    n.y = 1;
  }
  for (const l of graph.links) {
    l.source = byId.get(endpointId(l.source));
    l.target = byId.get(endpointId(l.target));
  }
  return graph;
}

describe('知识图谱：局部子图与度数（d3-force 就地改写后仍要正确）', () => {
  test('buildGraph 生成 root(f0) 与顶级文件夹/根文件相连', () => {
    const { nodes, links } = buildGraph(tree, rootFiles, rootName);
    expect(nodes[0]).toMatchObject({ id: 'f0', name: rootName, isRoot: true });
    // f0 的邻居 = 两个顶级文件夹 + 一个根文件
    const neighbors = links.filter((l) => l.source === 'f0').map((l) => l.target).sort();
    expect(neighbors).toEqual(['f1', 'f6', 'file99']);
    expect(nodeIdOf(0)).toBe('f0');
    expect(nodeIdOf(6)).toBe('f6');
  });

  test('主页局部子图包含 root 的全部邻居', () => {
    const graph = buildGraph(tree, rootFiles, rootName);
    const local = localSubgraph(graph.nodes, graph.links, 0);
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['f0', 'f1', 'f6', 'file99']);
  });

  test('回归：模拟跑过一轮后再取主页局部子图，仍包含全部邻居（不是只剩一个点）', () => {
    const graph = buildGraph(tree, rootFiles, rootName);
    const before = localSubgraph(graph.nodes, graph.links, 0);
    simulateD3Mutation(graph); // ← 第二次进主页时，memo 里的对象已被改写成对象端点
    const after = localSubgraph(graph.nodes, graph.links, 0);
    expect(after.nodes.map((n) => n.id).sort()).toEqual(before.nodes.map((n) => n.id).sort());
    expect(after.nodes.length).toBe(4);
  });

  test('回归：局部子图返回拷贝，模拟改写不会污染 fullGraph', () => {
    const graph = buildGraph(tree, rootFiles, rootName);
    const local = localSubgraph(graph.nodes, graph.links, 0);
    expect(local.nodes[0]).not.toBe(graph.nodes[0]);
    expect(local.links[0]).not.toBe(graph.links[0]);
    // 端点交回时是字符串 id，模拟才能重新解析
    for (const l of local.links) {
      expect(typeof l.source).toBe('string');
      expect(typeof l.target).toBe('string');
    }
  });

  test('回归：度数按真实节点 id 统计（不是 "[object Object]"）', () => {
    const graph = buildGraph(tree, rootFiles, rootName);
    simulateD3Mutation(graph);
    const deg = buildDegrees(graph.links);
    expect(deg['[object Object]']).toBeUndefined();
    expect(deg.f0).toBe(3); // 两个顶级文件夹 + 一个根文件
    expect(deg.file99).toBe(1);
  });

  test('进入文件夹时局部子图含父节点与子节点', () => {
    const graph = buildGraph(tree, rootFiles, rootName);
    simulateD3Mutation(graph);
    const inFolder = localSubgraph(graph.nodes, graph.links, 6).nodes.map((n) => n.id).sort();
    expect(inFolder).toEqual(['f0', 'f6', 'f7', 'file12']);
  });
});

// ---- 语义层（名称分词 / 语义边 / 成簇） ----
// 构造文件节点：folder 用于「同目录兜底边」，缺省表示根目录文件。
function fileNode(id, name, folder = null) {
  return { id, name, type: 'file', meta: { folder_id: folder } };
}
const semNodes = (defs) => buildSemanticNodes(defs.map(([id, name, folder]) => fileNode(id, name, folder)));

describe('知识图谱语义层：名称分词', () => {
  test('去掉扩展名、按 2/3-gram 出主题 token，并滤掉文档性质泛词', () => {
    const tokens = tokenizeNodeName('高等数学2023-2024期末试卷.pdf', true);
    expect(tokens.has('数学')).toBe(true);
    // 「试」是停用字，「期末」「试卷」是文档性质词：都不该留下——否则任意两门课的
    // 「XX期末试卷」都会连上。
    expect(tokens.has('试卷')).toBe(false);
    expect(tokens.has('期末')).toBe(false);
  });

  test('全角与半角、大小写归一化后得到同一批 token', () => {
    const a = tokenizeNodeName('LaTeX 基础（上）.pdf', true);
    const b = tokenizeNodeName('latex 基础(上).PDF', true);
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.has('latex')).toBe(true);
  });

  test('文件夹名不当成带扩展名的文件切（「复变函数」这种目录名要能出主题 token）', () => {
    const tokens = tokenizeNodeName('复变函数', false);
    expect(tokens.has('变函')).toBe(true);
    expect(tokens.has('函数')).toBe(true);
  });
});

describe('知识图谱语义层：语义边阈值', () => {
  test('共享 ≥2 个主题 token 才连边，只共享 1 个不连', () => {
    const nodes = semNodes([
      ['file1', '高等数学期末试卷A.pdf'],
      ['file2', '高等数学期中复习资料B.pdf'], // 与 file1 共享「数学」
      ['file3', '大学物理期末试卷.pdf'], // 只共享「期末/试卷」这类泛词（已被过滤）
    ]);
    const edges = buildSemanticEdges(nodes);
    const pairs = edges.map((e) => `${e.source}|${e.target}`);
    expect(pairs).toContain('file1|file2');
    expect(pairs).not.toContain('file1|file3');
    expect(pairs).not.toContain('file2|file3');
  });

  test('关键词：纯日期这种没有主题的节点，只能靠同目录弱边接回去', () => {
    const nodes = semNodes([
      ['file1', '2019.6.18.pdf', 5], // 纯日期：切完不剩任何 token
      ['file2', '高等数学练习题.pdf', 5], // 与 file1 同目录，自己带主题 token
    ]);
    expect([...nodes[0].tokens]).toEqual([]);
    const edges = buildSemanticEdges(nodes);
    const weak = edges.find((e) => e.source === 'file1' && e.target === 'file2');
    expect(weak).toBeTruthy();
    expect(weak.weak).toBe(true);
  });

  test('单字 token 不参与成簇（否则「案」「章」这类套话碎片会把全库连成一片）', () => {
    // 两个文件的主题只剩单字：各自都不能凭这个单字连边
    const nodes = semNodes([
      ['file1', '第一章.pdf', 1],
      ['file2', '第二章.pdf', 1],
    ]);
    const edges = buildSemanticEdges(nodes).filter((e) => !e.weak);
    expect(edges).toHaveLength(0);
  });

  test('库内高频词被 idf 压低：光靠「西安/交通」这类词连不上不同学科的资料', () => {
    // 10 个文件都带「西安交通大学」，其中两个还各带一门课；靠高频词那对不该连边。
    const defs = [];
    for (let i = 1; i <= 8; i += 1) defs.push([`file${i}`, `西安交通大学资料${i}.pdf`]);
    defs.push(['file9', '西安交通大学概率论期中试题.pdf']);
    defs.push(['file10', '西安交通大学足球理论课笔记.pdf']);
    const edges = buildSemanticEdges(semNodes(defs));
    const pairs = edges.map((e) => `${e.source}|${e.target}`);
    expect(pairs).not.toContain('file9|file10');
  });

  test('语义边不写回入参（d3 若拿到同一批对象会就地改写，见 BUG-98）', () => {
    const nodes = semNodes([
      ['file1', '高等数学期末试卷A.pdf'],
      ['file2', '高等数学期末试卷B.pdf'],
    ]);
    const before = nodes.map((n) => [...n.tokens].sort().join(','));
    const edges = buildSemanticEdges(nodes);
    // 连边返回的是端点 id 字符串，不是节点对象引用
    for (const e of edges) {
      expect(typeof e.source).toBe('string');
      expect(typeof e.target).toBe('string');
    }
    // 节点的 token 集合逐个不变
    expect(nodes.map((n) => [...n.tokens].sort().join(','))).toEqual(before);
  });
});

describe('知识图谱语义层：成簇', () => {
  const nodes = semNodes([
    ['file1', '高等数学期末试卷A.pdf', 1],
    ['file2', '高等数学期末试卷B.pdf', 1],
    ['file3', '高等数学期末试卷C.pdf', 2],
    ['file4', '足球专项理论课.pdf', 3],
  ]);

  test('传递连边归为同一簇，孤立节点自成一簇', () => {
    const edges = buildSemanticEdges(nodes);
    const clusters = buildClusters(nodes, edges, nodes);
    const big = clusters.find((c) => c.nodeIds.includes('file1'));
    expect(big.nodeIds.sort()).toEqual(['file1', 'file2', 'file3']); // file1-file2、file2-file3 连成一片
    expect(clusters.find((c) => c.nodeIds.includes('file4')).nodeIds).toEqual(['file4']);
  });

  test('簇标签取簇内共享 token，且顺序稳定（同输入两次结果一致）', () => {
    const edges = buildSemanticEdges(nodes);
    const a = buildClusters(nodes, edges, nodes);
    const b = buildClusters(nodes, edges, nodes);
    expect(a.map((c) => `${c.label}:${c.nodeIds.length}`)).toEqual(b.map((c) => `${c.label}:${c.nodeIds.length}`));
    const big = a.find((c) => c.nodeIds.length === 3);
    expect(big.label).toContain('数学');
    // 大簇在前，图例取前几个时不会每次跳色
    expect(a[0].nodeIds.length).toBe(3);
  });

  test('语义边与节点集不匹配时（局部视图只含子集）不炸、忽略悬空边', () => {
    const edges = buildSemanticEdges(nodes);
    const subset = nodes.filter((n) => n.id === 'file1' || n.id === 'file2');
    const clusters = buildClusters(subset, edges, subset);
    expect(clusters.reduce((sum, c) => sum + c.nodeIds.length, 0)).toBe(2);
  });
});
