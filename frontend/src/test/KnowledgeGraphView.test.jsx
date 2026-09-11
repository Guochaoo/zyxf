import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// 图谱的数据来源（模块级共享 store）：这里给固定树，避免真实网络请求。
const getFolderTreeMock = vi.fn();
const getKgSemanticsMock = vi.fn();
vi.mock('../api.js', () => ({
  getFolderTree: (...a) => getFolderTreeMock(...a),
  getKgSemantics: (...a) => getKgSemanticsMock(...a),
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../ui.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openFilePreview: vi.fn(),
}));

const {
  default: KnowledgeGraph,
  tokenizeNodeName,
  buildSemanticNodes,
  buildSemanticEdges,
  buildVectorGraph,
  VECTOR_LINK_THRESHOLD,
  __resetKgSemanticsCache,
} = await import('../components/KnowledgeGraph.jsx');
const { __resetFolderTreeStore } = await import('../hooks/useFolderTree.js');

// 树：两个高数资料（同一主题）+ 一个足球资料，另有一个纯日期名用来验证「同目录兜底」。
const tree = [
  {
    id: 1,
    name: '高数',
    children: [],
    files: [
      { id: 11, name: '高等数学期末试卷A.pdf', folder_id: 1 },
      { id: 12, name: '高等数学期中复习资料B.pdf', folder_id: 1 },
      { id: 13, name: '2019.6.18.pdf', folder_id: 1 }, // token 为空
    ],
  },
  { id: 2, name: '足球', children: [], files: [{ id: 21, name: '足球专项理论课.pdf', folder_id: 2 }] },
];

function renderGraph(currentId = 1) {
  // currentId=1：局部子图 = 该文件夹 + 它的父级 + 自己的文件，语义边才有两端都在场
  return render(
    <MemoryRouter>
      <KnowledgeGraph currentId={currentId} />
    </MemoryRouter>
  );
}

describe('知识图谱视图（渲染层）', () => {
  beforeEach(() => {
    __resetFolderTreeStore();
    __resetKgSemanticsCache(); // 内容视图数据是模块级共享的，用例之间必须清掉
    getFolderTreeMock.mockReset();
    getFolderTreeMock.mockResolvedValue({ tree, files: [] });
    // 内容视图的默认桩：没有向量数据（正是「模型未装/尚未索引」时的真实响应形状）
    getKgSemanticsMock.mockReset();
    getKgSemanticsMock.mockResolvedValue({ enabled: true, files: 0, edges: [], labels: {}, hint: '尚未建立内容索引' });
    // jsdom 不加载 index.css，手写一份簇色变量，断言「节点颜色来自 --kg-cN」。
    document.documentElement.style.setProperty('--kg-c1', 'rgb(1, 2, 3)');
    document.documentElement.style.setProperty('--kg-c2', 'rgb(4, 5, 6)');
  });

  test('默认内容视图：没有向量数据时给出可读提示，而不是空白（也不是「暂无图谱数据」）', async () => {
    renderGraph();
    const modeBtn = await screen.findByRole('button', { name: '内容视图：按资料内容聚类' });
    expect(modeBtn.getAttribute('aria-pressed')).toBe('true'); // 默认档就是内容视图
    // 索引里没有可用资料 → 明确指向名称视图，而不是一片空白
    expect(await screen.findByText(/内容索引里还没有可用的资料/)).toBeTruthy();
  });

  test('切到名称视图：画出簇图例、语义边（虚线）并按簇上色', async () => {
    const { container } = renderGraph();
    fireEvent.click(await screen.findByRole('button', { name: '名称视图：按资料名主题聚类' }));
    // 等定位完成（positioned 为真）才会画线与节点：只看 circle 会在首帧后就返回
    await waitFor(() => expect(container.querySelectorAll('line').length).toBeGreaterThan(0));

    // 图例：两个高数资料共享「数学」，聚成一簇，标签取共享 token
    const legend = container.querySelector('foreignObject');
    expect(legend).toBeTruthy();
    expect(legend.textContent).toContain('数学');

    // 语义边用虚线、目录边用实线：两者必须能区分
    const dashed = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '3 3'
    );
    expect(dashed.length).toBeGreaterThan(0);

    // 至少有一个节点拿到了簇色（inline fill 来自 --kg-c1/--kg-c2）
    const colored = [...container.querySelectorAll('circle')].filter((c) =>
      /rgb\(1, 2, 3\)|rgb\(4, 5, 6\)/.test(c.getAttribute('fill') || '')
    );
    expect(colored.length).toBeGreaterThan(0);
  });

  test('切到目录视图：语义边与图例都消失，目录层级边仍在', async () => {
    const { container } = renderGraph();
    await waitFor(() => expect(container.querySelectorAll('line').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: '目录视图：只看文件夹层级' }));
    await waitFor(() => expect(container.querySelector('foreignObject')).toBeNull());

    const dashed = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '3 3'
    );
    expect(dashed).toHaveLength(0);
    // 目录层级边必须还在：这一档只关语义层，不能把整张图关掉
    expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  test('内容视图拿到向量边后：虚线边与簇图例来自内容相似度', async () => {
    // 三个文件互相相似（>0.9），一个离群（与谁都不像）：应呈现为一个簇 + 一个单点
    getKgSemanticsMock.mockResolvedValue({
      enabled: true,
      model: 'bge-small-zh-v1.5',
      files: 4,
      edges: [
        { source: 11, target: 12, weight: 0.93 },
        { source: 11, target: 13, weight: 0.91 },
        { source: 12, target: 13, weight: 0.9 },
      ],
      labels: { 11: '高数', 12: '高数', 13: '高数', 21: '足球' },
    });
    const { container } = renderGraph();
    fireEvent.click(await screen.findByRole('button', { name: '名称视图：按资料名主题聚类' }));
    fireEvent.click(screen.getByRole('button', { name: '内容视图：按资料内容聚类' }));

    await waitFor(() => expect(container.querySelector('foreignObject')).toBeTruthy());
    // 内容视图的簇标签取「簇内最高频目录名」
    expect(container.querySelector('foreignObject').textContent).toContain('高数');
    const dashed = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '3 3'
    );
    expect(dashed.length).toBeGreaterThan(0);
  });
});

describe('内容视图：向量边成簇（纯函数）', () => {
  const nodes = [
    { id: 1, name: 'a.pdf', type: 'file' },
    { id: 2, name: 'b.pdf', type: 'file' },
    { id: 3, name: 'c.pdf', type: 'file' },
    { id: 4, name: 'd.pdf', type: 'file' },
  ];
  const labels = { 1: '高数', 2: '高数', 3: '高数', 4: '足球' };

  test('只保留当前范围内的边（局部视图不会画到范围外的邻居）', () => {
    const all = [
      { source: 1, target: 2, weight: 0.9 },
      { source: 1, target: 9, weight: 0.95 }, // 9 不在范围内
    ];
    const { edges } = buildVectorGraph(nodes, all, labels);
    expect(edges).toHaveLength(1);
    // 端点统一成图谱节点 id 形式（file<id>），否则永远接不上节点
    expect(edges[0]).toMatchObject({ source: 'file1', target: 'file2' });
  });

  test('超过阈值的边把成员聚成一簇，标签取簇内最高频目录名', () => {
    const { clusters } = buildVectorGraph(
      nodes,
      [
        { source: 1, target: 2, weight: 0.9 },
        { source: 2, target: 3, weight: 0.88 },
      ],
      labels
    );
    const big = clusters.find((c) => c.nodeIds.includes('file1'));
    expect(big.nodeIds.sort()).toEqual(['file1', 'file2', 'file3']);
    expect(big.label).toBe('高数');
    // 离群文件自成一簇、没有标签（不会被硬塞进别人的簇）
    const lone = clusters.find((c) => c.nodeIds.includes('file4'));
    expect(lone.nodeIds).toEqual(['file4']);
    expect(lone.label).toBeNull();
  });

  test('低于阈值的相似度只画线、不成簇（避免链式把整库串成一坨）', () => {
    const weak = VECTOR_LINK_THRESHOLD - 0.01;
    const { edges, clusters } = buildVectorGraph(
      nodes,
      [
        { source: 1, target: 2, weight: weak },
        { source: 2, target: 3, weight: weak },
      ],
      labels
    );
    expect(edges).toHaveLength(2); // 线照画
    expect(clusters.every((c) => c.nodeIds.length === 1)).toBe(true); // 但不合并
  });

  test('桥接文件不能把两团单向拉近：非互为最近邻的强边不成簇', () => {
    // 夹具要点：K=4，所以每个节点最多认 4 个最近邻，第 5 个强邻居就不再是「互为」——
    // 节点 9 是那种「跟谁都像」的资料（和 1..5 都强相似），但它自己的前 4 名里没有 5，
    // 于是 9—5 这条强边只画线、不把两团合并。
    const wide = [
      { id: 1, name: '一号.pdf' },
      { id: 2, name: '二号.pdf' },
      { id: 3, name: '三号.pdf' },
      { id: 4, name: '四号.pdf' },
      { id: 5, name: '五号.pdf' },
      { id: 9, name: '九号.pdf' },
    ];
    const edges = [
      // 1..4 内部近乎重复 → 必然成簇
      { source: 1, target: 2, weight: 0.99 },
      { source: 1, target: 3, weight: 0.98 },
      { source: 1, target: 4, weight: 0.97 },
      { source: 2, target: 3, weight: 0.96 },
      { source: 2, target: 4, weight: 0.96 },
      { source: 3, target: 4, weight: 0.95 },
      // 9 与 1..4 以及 5 都强相似，但排名里 5 最靠后
      { source: 9, target: 1, weight: 0.99 },
      { source: 9, target: 2, weight: 0.98 },
      { source: 9, target: 3, weight: 0.97 },
      { source: 9, target: 4, weight: 0.96 },
      { source: 9, target: 5, weight: 0.94 },
    ];
    const { edges: drawn, clusters } = buildVectorGraph(wide, edges, {});
    // 所有强边都画出来（连线与成簇是两件事）
    expect(drawn).toHaveLength(edges.length);
    // 1..4 与 9 互为最近邻 → 合并成一簇；5 只被 9 单向认领（9 的前 4 名里没有 5）→ 不并入
    const withOne = clusters.find((c) => c.nodeIds.includes('file1'));
    expect(withOne.nodeIds.sort()).toEqual(['file1', 'file2', 'file3', 'file4', 'file9']);
    const five = clusters.find((c) => c.nodeIds.includes('file5'));
    expect(five.nodeIds).toEqual(['file5']);
  });
});

describe('名称层语义：主题边与弱边（纯函数）', () => {
  test('同一主题的资料连成主题边，纯日期名靠同目录弱边兜底', () => {
    const nodes = buildSemanticNodes([
      { id: 'file11', name: '高等数学期末试卷A.pdf', type: 'file', meta: { folder_id: 1 } },
      { id: 'file12', name: '高等数学期中复习资料B.pdf', type: 'file', meta: { folder_id: 1 } },
      { id: 'file13', name: '2019.6.18.pdf', type: 'file', meta: { folder_id: 1 } },
    ]);
    expect([...nodes[2].tokens]).toEqual([]); // 纯日期切完什么都不剩
    const edges = buildSemanticEdges(nodes);
    // 同一主题：两条边都在，且都带共享 token
    const themed = edges.filter((e) => e.tokens?.length);
    expect(themed.length).toBeGreaterThan(0);
    expect(themed[0].tokens).toContain('数学');
    // 没有 token 的那个只能靠弱边接回去
    const weak = edges.filter((e) => e.weak);
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.some((e) => e.source === 'file13' || e.target === 'file13')).toBe(true);
  });

  test('文档性质词不参与主题（否则任意两门课的「XX期末试卷」都会连上）', () => {
    const tokens = tokenizeNodeName('高等数学期末试卷A.pdf', true);
    expect(tokens.has('数学')).toBe(true);
    expect(tokens.has('期末')).toBe(false);
    expect(tokens.has('试卷')).toBe(false);
    expect(tokens.has('提纲')).toBe(false);
  });
});
