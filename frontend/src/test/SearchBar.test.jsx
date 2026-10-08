import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const searchMock = vi.fn();
// AI 搜索：chatStream 由各用例注入实现；getChatStatus 默认「服务端已配置」，
// 免得走「未配置 + 自带 Key」的登录拦截分支。
const chatStreamMock = vi.fn();
const getChatStatusMock = vi.fn();
vi.mock('../api.js', () => ({
  search: (...a) => searchMock(...a),
  getFileUrl: vi.fn(),
  getChatStatus: (...a) => getChatStatusMock(...a),
  chatStream: (...a) => chatStreamMock(...a),
  default: { get: vi.fn(), post: vi.fn() },
}));

const { default: SearchBar } = await import('../components/SearchBar.jsx');
const { __resetResourceStore } = await import('../data/resource.js');

// 落点探针：AI 卡出错态的齿轮要能进设置（真实路由 /settings/ai）。
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

function renderBar() {
  return render(
    <MemoryRouter>
      <SearchBar />
      <LocationProbe />
    </MemoryRouter>
  );
}

const input = () => screen.getByPlaceholderText('搜索文字');

describe('SearchBar 失败路径', () => {
  beforeEach(() => {
    searchMock.mockReset();
    chatStreamMock.mockReset();
    getChatStatusMock.mockReset();
    getChatStatusMock.mockResolvedValue({ enabled: true });
    localStorage.clear();
    // IMPROVE-56 审计跟进：resource store 是模块级缓存，不重置的话从第 2 个用例起测的是「陈旧缓存 + 后台刷新」而非全新挂载。
    __resetResourceStore();
  });

  test('查询失败时清掉上一次的结果并显示错误与重试（不再静默展示旧结果）', async () => {
    searchMock.mockResolvedValueOnce({ folders: [{ id: 1, name: '高等数学' }], files: [] });
    renderBar();

    fireEvent.change(input(), { target: { value: 'gaoshu' } });
    await waitFor(() => expect(screen.getByText('高等数学')).toBeInTheDocument());

    // 第二次查询失败：旧结果必须消失，否则用户以为这是新关键词的命中
    searchMock.mockRejectedValueOnce({ response: { data: { error: '服务不可用' } } });
    fireEvent.change(input(), { target: { value: 'gaoshu2' } });

    await waitFor(() => expect(screen.getByText('服务不可用')).toBeInTheDocument());
    expect(screen.queryByText('高等数学')).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  test('点重试会用当前关键词重新请求', async () => {
    searchMock.mockRejectedValueOnce(new Error('network down'));
    renderBar();

    fireEvent.change(input(), { target: { value: 'abc' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument());

    searchMock.mockResolvedValueOnce({ folders: [], files: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    // IMPROVE-54：search 现在带 { signal } 配置（数据层的 AbortController 取消）。
    await waitFor(() => expect(searchMock).toHaveBeenLastCalledWith('abc', expect.anything()));
    await waitFor(() => expect(screen.getByText('无匹配结果')).toBeInTheDocument());
  });

  test('请求在途/完成后清除按钮仍可点（aria-label 不被 loading 覆盖）', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    renderBar();
    fireEvent.change(input(), { target: { value: 'x' } });

    // 输入框右侧的按钮始终是「清除搜索」，loading 只改变图标
    await waitFor(() => expect(searchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /清除/ })).toBeInTheDocument();
  });

  test('渲染搜索命中结果且不再展示底部条数统计栏', async () => {
    searchMock.mockResolvedValueOnce({ folders: [], files: [{ id: 1, name: 'a.pdf', ext: 'pdf' }] });
    renderBar();
    fireEvent.change(input(), { target: { value: 'a' } });

    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument());
    expect(screen.queryByText(/个结果/)).toBeNull();
  });
});

// AI 搜索：原右栏「智能对话」卡片迁入候选框顶部——入口 → 查找中（流光泛光）→ 结果卡。
describe('SearchBar · AI 搜索卡', () => {
  const AI_HIT = {
    id: 7,
    name: '高等数学期末版.pdf',
    type: 'file',
    ext: 'pdf',
    folder_path: '高等数学',
  };
  const entry = () => screen.findByText('AI 搜索更多结果');

  // 一次成功的检索：真实后端会先流式吐正文、再给 files 事件（命中条目）。
  // 前端已经不订阅正文（onDelta 不传），所以这里用可选调用模拟「上游仍会发」。
  const mockAiReply = () =>
    chatStreamMock.mockImplementation(async (_messages, opts = {}) => {
      opts.onDelta?.('推荐这份【文件1】');
      opts.onFiles?.([AI_HIT]);
    });

  // 悬挂的流：用于观察「查找中」这一态（中止时按 BUG-61 的约定 reject）
  const mockAiPending = () =>
    chatStreamMock.mockImplementation(
      (_messages, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );

  test('有输入就出现 AI 入口（不必等本地搜索返回）', async () => {
    searchMock.mockReturnValue(new Promise(() => {})); // 本地搜索一直挂着
    renderBar();
    fireEvent.change(input(), { target: { value: '高数' } });

    expect(await entry()).toBeInTheDocument();
  });

  // 泛光层是 inset:-2px 的外溢元素：包裹层底边不留内边距的话，滚动容器会多出 2px
  // 可滚动区 → 凭空冒出滚动条（实测把整行压窄 10px）。左右同理，给泛光留外溢空间。
  test('AI 卡包裹层四周留够内边距（泛光外溢不撑出滚动条）', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    renderBar();
    fireEvent.change(input(), { target: { value: '高数' } });
    await entry();

    const wrap = document.querySelector('.rb-search-dropdown .rb-ai-card').parentElement;
    for (const cls of ['px-2', 'pt-2', 'pb-2']) {
      expect(wrap.className.split(/\s+/)).toContain(cls);
    }
  });

  test('点入口按当前关键词发起一次检索，完成后只落固定说明行与命中条目', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    let seenMessages = null;
    chatStreamMock.mockImplementation(async (messages, opts = {}) => {
      seenMessages = messages;
      opts.onDelta?.('推荐这份【文件1】');
      opts.onFiles?.([AI_HIT]);
    });
    renderBar();

    fireEvent.change(input(), { target: { value: '高数' } });
    fireEvent.click(await entry());

    expect(await screen.findByText('AI 搜索')).toBeInTheDocument();
    expect(screen.getByText('基于你的描述，你可能想找以下资料')).toBeInTheDocument();
    expect(screen.getByText('高等数学期末版.pdf')).toBeInTheDocument();
    // LLM 的正文（markdown，且与清单重复）一律不渲染
    expect(screen.queryByText(/推荐这份/)).toBeNull();
    // 候选框是 portal 到 body 的，泛光要按文档查
    expect(document.querySelector('.rb-ai-card')).toBeTruthy();
    expect(document.querySelector('.rb-ai-card__halo')).toBeNull(); // 完成态不再泛光
    expect(seenMessages).toEqual([{ role: 'user', content: '高数' }]);
  });

  test('查找中显示状态文案与流光泛光', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    mockAiPending();
    renderBar();

    fireEvent.change(input(), { target: { value: '高数' } });
    fireEvent.click(await entry());

    expect(await screen.findByText('AI 搜索正在查找…')).toBeInTheDocument();
    expect(document.querySelector('.rb-ai-card__halo')).toBeTruthy();
  });

  test('点 AI 命中条目与普通结果同一条打开路径（清空关键词、收起候选框）', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    mockAiReply();
    renderBar();

    fireEvent.change(input(), { target: { value: '高数' } });
    fireEvent.click(await entry());
    fireEvent.click(await screen.findByRole('button', { name: /高等数学期末版\.pdf/ }));

    expect(input()).toHaveValue('');
    await waitFor(() => expect(screen.queryByText('AI 搜索')).toBeNull());
  });

  test('关键词一变，上一轮结果作废、回到入口态', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    mockAiReply();
    renderBar();

    fireEvent.change(input(), { target: { value: '高数' } });
    fireEvent.click(await entry());
    expect(await screen.findByText('AI 搜索')).toBeInTheDocument();

    fireEvent.change(input(), { target: { value: '大物' } });
    expect(await entry()).toBeInTheDocument();
    expect(screen.queryByText('AI 搜索')).toBeNull();
  });

  test('失败时给出错误、重试与 AI 搜索配置入口', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    chatStreamMock.mockRejectedValue(new Error('AI 功能未配置'));
    renderBar();

    fireEvent.change(input(), { target: { value: '高数' } });
    fireEvent.click(await entry());

    expect(await screen.findByText('AI 功能未配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();

    // 齿轮进设置弹窗的「AI 搜索配置」板块，并先收起候选框
    fireEvent.click(screen.getByRole('button', { name: 'AI 搜索配置' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings/ai');
    expect(screen.queryByText('AI 功能未配置')).toBeNull();
  });
});
