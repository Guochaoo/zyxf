import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// 图谱的数据来源（模块级共享 store）：这里给固定树，避免真实网络请求。
const getFolderTreeMock = vi.fn();
vi.mock('../api.js', () => ({
  getFolderTree: (...a) => getFolderTreeMock(...a),
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

describe('知识图谱语义视图（渲染层）', () => {
  beforeEach(() => {
    __resetFolderTreeStore();
    getFolderTreeMock.mockReset();
    getFolderTreeMock.mockResolvedValue({ tree, files: [] });
    // jsdom 不加载 index.css，手写一份簇色变量，断言「节点颜色来自 --kg-cN」。
    document.documentElement.style.setProperty('--kg-c1', 'rgb(1, 2, 3)');
    document.documentElement.style.setProperty('--kg-c2', 'rgb(4, 5, 6)');
  });

  test('语义视图画出簇图例、语义边（虚线）并按簇上色', async () => {
    const { container } = renderGraph();
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

  test('关掉语义视图后不再画语义边与图例，目录边仍在', async () => {
    const { container } = renderGraph();
    await waitFor(() => expect(container.querySelector('foreignObject')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '切换到目录视图（按文件夹层级）' }));
    await waitFor(() => expect(container.querySelector('foreignObject')).toBeNull());

    const dashed = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '3 3'
    );
    expect(dashed).toHaveLength(0);
    // 目录层级边必须还在：这个开关只关语义层，不能把整张图关掉
    expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  test('同一主题的资料连成弱边/主题边，纯日期名靠同目录兜底', () => {
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
