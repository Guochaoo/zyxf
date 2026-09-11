import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// 图谱的数据来源（模块级共享 store）：固定树 + 固定的内容分类，避免真实网络请求。
const getFolderTreeMock = vi.fn();
const getKgTaxonomyMock = vi.fn();
vi.mock('../api.js', () => ({
  getFolderTree: (...a) => getFolderTreeMock(...a),
  getKgTaxonomy: (...a) => getKgTaxonomyMock(...a),
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../ui.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openFilePreview: vi.fn(),
}));

const {
  default: KnowledgeGraph,
  buildTopicGraph,
  labelOfNode,
  __resetKgSemanticsCache,
} = await import('../components/KnowledgeGraph.jsx');
const { __resetFolderTreeStore } = await import('../hooks/useFolderTree.js');

// 两个学科目录：高数（三个文件，内容分成两个细分）与 足球（一个文件）
const tree = [
  {
    id: 1,
    name: '高数',
    children: [],
    files: [
      { id: 11, name: '高等数学期末试卷A.pdf', folder_id: 1 },
      { id: 12, name: '高等数学期中复习资料B.pdf', folder_id: 1 },
      { id: 13, name: '极限与导数练习.pdf', folder_id: 1 },
    ],
  },
  { id: 2, name: '足球', children: [], files: [{ id: 21, name: '足球专项理论课.pdf', folder_id: 2 }] },
];

// 后端分类：高数 → 「极限与导数」(11/12) + 「期中复习」(13)；足球 → 「体育理论」(21)
const taxonomy = {
  enabled: true,
  model: 'bge-small-zh-v1.5',
  llm: true,
  cached: true,
  files: 4,
  groups: [
    {
      subjectId: 1,
      subject: '高数',
      clusters: [
        { key: '1:0', name: '极限与导数', fileIds: [11, 12] },
        { key: '1:1', name: '期中复习', fileIds: [13] },
      ],
    },
    { subjectId: 2, subject: '足球', clusters: [{ key: '2:0', name: '体育理论', fileIds: [21] }] },
  ],
  labels: { 'cluster:1:0': '极限与导数', 'cluster:1:1': '期中复习', 'cluster:2:0': '体育理论', 'folder:1': '高数', 'folder:2': '足球' },
};

function renderGraph(currentId = 1) {
  // currentId=1：局部子图 = 该文件夹 + 它的父级 + 自己的文件
  return render(
    <MemoryRouter>
      <KnowledgeGraph currentId={currentId} />
    </MemoryRouter>
  );
}

describe('知识图谱视图（渲染层）', () => {
  beforeEach(() => {
    __resetFolderTreeStore();
    __resetKgSemanticsCache(); // 分类缓存与档位记忆都是模块级的，用例之间必须清掉
    getFolderTreeMock.mockReset();
    getFolderTreeMock.mockResolvedValue({ tree, files: [] });
    getKgTaxonomyMock.mockReset();
    getKgTaxonomyMock.mockResolvedValue(taxonomy);
    // jsdom 不加载 index.css，手写一份簇色变量，断言「节点颜色来自 --kg-cN」。
    document.documentElement.style.setProperty('--kg-c1', 'rgb(1, 2, 3)');
    document.documentElement.style.setProperty('--kg-c2', 'rgb(4, 5, 6)');
  });

  test('内容视图按「学科 → 内容细分 → 文件」组织，标签用分类名', async () => {
    const { container } = renderGraph();
    // 等分类名上屏：内容档要先等分类数据到齐（只看 circle 会命中目录图的那一帧）
    await waitFor(() =>
      expect([...container.querySelectorAll('text')].map((t) => t.textContent)).toContain('极限与导数')
    );
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts.some((t) => t.includes('高数'))).toBe(true);

    // 同一内容细分用同色（分类节点实心填充、其下文件同色描边）
    const tinted = [...container.querySelectorAll('circle')].filter((c) =>
      /rgb\(1, 2, 3\)|rgb\(4, 5, 6\)/.test(`${c.getAttribute('fill')} ${c.getAttribute('stroke')}`)
    );
    expect(tinted.length).toBeGreaterThan(0);
    // 图例已移除：画布上不该再出现 foreignObject
    expect(container.querySelector('foreignObject')).toBeNull();
  });

  test('切到目录视图：回到文件夹层级（分类节点消失）', async () => {
    const { container } = renderGraph();
    await waitFor(() =>
      expect([...container.querySelectorAll('text')].map((t) => t.textContent)).toContain('极限与导数')
    );

    fireEvent.click(screen.getByRole('button', { name: '目录视图：只看文件夹层级' }));
    await waitFor(() =>
      expect([...container.querySelectorAll('text')].map((t) => t.textContent)).not.toContain('极限与导数')
    );
    // 目录层级边仍在：这一档只换组织方式，不能把整张图关掉
    expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  test('分类数据为空时给出提示，而不是空白', async () => {
    getKgTaxonomyMock.mockResolvedValue({ enabled: true, groups: [], labels: {}, files: 0 });
    __resetKgSemanticsCache();
    renderGraph();
    expect(await screen.findByText(/内容索引里还没有可用资料/)).toBeTruthy();
  });

  test('分类接口失败时提示可切目录视图', async () => {
    getKgTaxonomyMock.mockRejectedValue(new Error('offline'));
    __resetKgSemanticsCache();
    renderGraph();
    expect(await screen.findByText(/内容索引读取失败/)).toBeTruthy();
  });
});

describe('内容分类建图（纯函数）', () => {
  const nodes = [
    { id: 'f0', name: '首页', type: 'folder', isRoot: true },
    { id: 'f1', name: '高数', type: 'folder' },
    { id: 'f2', name: '足球', type: 'folder' },
    { id: 'file11', name: 'a.pdf', type: 'file', meta: { folder_id: 1 } },
    { id: 'file12', name: 'b.pdf', type: 'file', meta: { folder_id: 1 } },
    { id: 'file13', name: 'c.pdf', type: 'file', meta: { folder_id: 1 } },
    { id: 'file21', name: 'd.pdf', type: 'file', meta: { folder_id: 2 } },
  ];
  const parentOf = new Map([[1, null], [2, null]]);

  test('学科节点挂根目录，细分挂学科，文件挂细分', () => {
    const { nodes: out, links } = buildTopicGraph(nodes, taxonomy, { parentOf });
    const ids = out.map((n) => n.id);
    expect(ids).toContain('f1'); // 学科节点复用目录节点（可点击进入）
    expect(ids).toContain('k:1:0'); // 细分节点
    expect(ids).toContain('file11');
    // 根 → 学科 → 细分 → 文件
    expect(links).toContainEqual({ source: 'f0', target: 'f1' });
    expect(links).toContainEqual({ source: 'f1', target: 'k:1:0' });
    expect(links).toContainEqual({ source: 'k:1:0', target: 'file11' });
    // 目录层级边不该出现：文件不再挂在文件夹下
    expect(links.some((l) => l.source === 'f1' && l.target === 'file11')).toBe(false);
  });

  test('只画当前范围内的文件；不在范围里的分类不产生节点', () => {
    const onlyHighMath = nodes.filter((n) => n.id !== 'file21' && n.id !== 'f2');
    const { nodes: out } = buildTopicGraph(onlyHighMath, taxonomy, { parentOf });
    const ids = out.map((n) => n.id);
    expect(ids).not.toContain('file21');
    expect(ids.some((id) => id.startsWith('k:2:'))).toBe(false);
  });

  test('未被索引的文件不进图（画了只会变成游离点）', () => {
    const withScanner = [...nodes, { id: 'file99', name: '扫描件.pdf', type: 'file', meta: { folder_id: 1 } }];
    const { nodes: out } = buildTopicGraph(withScanner, taxonomy, { parentOf });
    expect(out.map((n) => n.id)).not.toContain('file99');
  });

  test('只有一个文件的细分不建节点，但文件不能丢：直接挂到学科下', () => {
    const { nodes: out, links } = buildTopicGraph(nodes, taxonomy, { parentOf });
    // 「期中复习」只有一个文件（13）→ 不建 k:1:1，文件直接挂学科
    expect(out.map((n) => n.id)).not.toContain('k:1:1');
    expect(links).toContainEqual({ source: 'f1', target: 'file13' });
    // 足球的细分也只有一个文件 → 同样不建节点，文件挂学科
    expect(out.map((n) => n.id)).not.toContain('k:2:0');
    expect(links).toContainEqual({ source: 'f2', target: 'file21' });
    expect(out.map((n) => n.id)).toContain('f2');
    // 关键：已建索引的文件一个都不该消失
    for (const id of ['file11', 'file12', 'file13', 'file21']) {
      expect(out.map((n) => n.id)).toContain(id);
    }
  });

  test('学科不在当前范围时，它的细分挂到根目录（局部视图仍然可见）', () => {
    const noFolderNodes = nodes.filter((n) => !String(n.id).match(/^f\d+$/) || n.id === 'f0');
    const { nodes: out, links } = buildTopicGraph(noFolderNodes, taxonomy, { parentOf });
    expect(out.map((n) => n.id)).toContain('k:1:0');
    expect(links).toContainEqual({ source: 'f0', target: 'k:1:0' });
  });

  test('labelOfNode 从后端 labels 里取学科与细分的可读名字', () => {
    expect(labelOfNode('f1', taxonomy.labels)).toBe('高数');
    expect(labelOfNode('k:1:0', taxonomy.labels)).toBe('极限与导数');
    expect(labelOfNode('k:9:9', taxonomy.labels)).toBeNull();
    expect(labelOfNode('file11', taxonomy.labels)).toBeNull();
  });
});
