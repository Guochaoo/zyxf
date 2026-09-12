import { describe, test, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildGraph, localSubgraph, buildDegrees, nodeIdOf, endpointId } from '../components/KnowledgeGraph.jsx';

// 组件挂载测试用固定树（不触发请求）；上方纯函数用例用本地 fixture。
vi.mock('../hooks/useFolderTree.js', () => ({
  useFolderTree: () => ({
    tree: [
      { id: 1, name: 'ACM', children: [], files: [{ id: 11, name: 'a.pdf' }] },
      { id: 6, name: '高数', children: [], files: [{ id: 12, name: 'b.pdf' }] },
    ],
    rootFiles: [{ id: 99, name: 'root.pdf' }],
    loading: false,
  }),
}));

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

// BUG-105 回归：组件挂载级的属性接线必须被测——曾因把 localSubgraph 返回的
// { nodes, links } 直接解构成 { localNodes, localLinks }，links=undefined，
// buildDegrees 抛 "links is not iterable" 打穿整页到 bootError（纯函数用例拦不住）。
describe('知识图谱：组件挂载（属性接线回归）', () => {
  test('树就绪后渲染全部节点与连线', async () => {
    const { default: KnowledgeGraph } = await import('../components/KnowledgeGraph.jsx');
    render(
      <MemoryRouter>
        <KnowledgeGraph currentId={0} />
      </MemoryRouter>
    );
    // f0 + f1 + f6 + file99 = 4 个节点；f0 的 3 条连线
    await waitFor(() => {
      expect(document.querySelectorAll('g[data-node]')).toHaveLength(4);
      expect(document.querySelectorAll('line[data-link]')).toHaveLength(3);
    });
  });
});
