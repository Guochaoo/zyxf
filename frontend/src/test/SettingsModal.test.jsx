import { useState } from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal.jsx';

// 组件是「受控」的：板块与手机端层级都来自外层路由（App 里是 /settings 与 /settings/:section）。
// 测试里用一个很小的宿主复刻这层状态，于是点条目 = 进二级、点返回 = 回列表，与线上行为一致。
// 直接渲染弹窗即可（它用 createPortal，查询走 document.body）。
function renderModal({ onClose = () => {}, initialSection = 'ai', initialPanelOpen = false } = {}) {
  function Harness() {
    const [section, setSection] = useState(initialSection);
    const [panelOpen, setPanelOpen] = useState(initialPanelOpen);
    return (
      <SettingsModal
        open
        section={section}
        panelOpen={panelOpen}
        onSectionChange={(id) => {
          setSection(id);
          setPanelOpen(true);
        }}
        onBack={() => setPanelOpen(false)}
        onClose={onClose}
      />
    );
  }
  return render(<Harness />);
}

// jsdom 没有 matchMedia：默认按「非手机」渲染（即桌面端左右分栏）。
// 需要验证手机端两级结构时，用下面的 mockMobile() 让 max-width:640px 匹配。
const realMatchMedia = window.matchMedia;
function mockMobile() {
  window.matchMedia = (query) => ({
    matches: query.includes('max-width: 640px'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

// 进入「外观」板块（语言下拉所在处）。
async function goToAppearance() {
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  await waitFor(() => expect(screen.getByText('字体和语言')).toBeInTheDocument());
}

const langRow = () => screen.getByRole('button', { name: /语言/ });
const langMenu = () => document.querySelector('.settings-lang-menu');

beforeEach(() => {
  localStorage.clear();
});

describe('SettingsModal 语言下拉：点击空白收起', () => {
  test('点击行展开菜单，再点弹窗内空白处收起', async () => {
    renderModal();
    await goToAppearance();

    expect(langMenu()).toBeNull();
    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();

    // 点击弹窗内的非交互空白（板块标题）——mousedown 在容器外即收起
    fireEvent.mouseDown(screen.getByText('字体和语言'));
    await waitFor(() => expect(langMenu()).toBeNull());
  });

  test('点击遮罩（弹窗卡片之外）同样收起菜单', async () => {
    renderModal();
    await goToAppearance();
    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();

    fireEvent.mouseDown(document.querySelector('.settings-backdrop'));
    await waitFor(() => expect(langMenu()).toBeNull());
  });

  test('点击行自身不会因外部监听而立刻收起（仍可切换）', async () => {
    renderModal();
    await goToAppearance();

    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();
    // 再点一次行：由行自身的切换逻辑收起，而非外部监听误触发
    fireEvent.click(langRow());
    await waitFor(() => expect(langMenu()).toBeNull());

    fireEvent.click(langRow());
    expect(langMenu()).not.toBeNull();
  });

  test('选择语言后菜单收起且应用生效', async () => {
    renderModal();
    await goToAppearance();
    fireEvent.click(langRow());

    fireEvent.click(screen.getByRole('option', { name: 'English' }));

    await waitFor(() => expect(langMenu()).toBeNull());
    expect(localStorage.getItem('zyxf_lang')).toBe('en');
    // 复位，避免影响其他用例（i18n 由 setup 的 beforeEach 兜底）
    localStorage.setItem('zyxf_lang', 'zh');
  });
});

// 智能对话配置：来源二选一（服务器 / 自定义），只有自定义才显示字段。
// 字段顺序：API 地址 → API 协议 → API Key → 模型；只有地址带通用格式占位提示。
describe('SettingsModal 智能对话配置：配置来源与字段', () => {
  const radio = (name) => screen.getByRole('radio', { name });
  const savedCfg = () => {
    const raw = localStorage.getItem('zyxf_llm');
    return raw ? JSON.parse(raw) : null;
  };
  const urlInput = () => screen.getByLabelText('API 地址');
  const keyInput = () => screen.getByLabelText('API Key');
  const modelInput = () => screen.getByLabelText('模型');
  // 协议是自绘下拉（原生 select 的 option 列表跟不上主题与风格）：触发器 + Level 3 浮层
  const protocolTrigger = () => screen.getByRole('button', { name: 'API 协议' });
  const protocolValue = () => protocolTrigger().textContent.trim();
  const pickProtocol = (name) => {
    fireEvent.click(protocolTrigger());
    fireEvent.click(screen.getByRole('option', { name }));
  };
  const customMode = () => fireEvent.click(radio('使用自定义配置'));

  test('本地无配置时默认选中「使用服务器配置」，且不显示自定义字段', () => {
    renderModal();

    expect(radio('使用服务器配置')).toBeChecked();
    expect(radio('使用自定义配置')).not.toBeChecked();
    expect(screen.queryByLabelText('API Key')).toBeNull();
    expect(screen.queryByRole('button', { name: 'API 协议' })).toBeNull();
  });

  test('字段自上而下为 地址 → 协议 → Key → 模型', () => {
    renderModal();
    customMode();

    const labels = [...document.querySelectorAll('.settings-field-label')].map((el) => el.textContent);
    expect(labels).toEqual(['API 地址', 'API 协议', 'API Key', '模型']);
  });

  // 占位文字只在地址上保留一个通用格式示例，其余字段一律不给（免得被误当成已填的值）
  test('只有地址有通用格式占位提示，Key 与模型没有', () => {
    renderModal();
    customMode();

    expect(urlInput()).toHaveAttribute('placeholder', 'https://api.example.com/v1');
    expect(keyInput()).not.toHaveAttribute('placeholder');
    expect(modelInput()).not.toHaveAttribute('placeholder');
    // 不应再出现具体厂商（智谱）的地址示例
    expect(document.querySelector('[placeholder*="bigmodel"]')).toBeNull();
  });

  test('选「使用自定义配置」填完保存后写入本地存储（默认协议 OpenAI Chat Completions）', async () => {
    renderModal();
    customMode();

    expect(protocolValue()).toBe('OpenAI Chat Completions');
    fireEvent.change(urlInput(), { target: { value: 'https://llm.test/v1' } });
    fireEvent.change(keyInput(), { target: { value: 'sk-test' } });
    fireEvent.change(modelInput(), { target: { value: 'glm-4.6' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(savedCfg()).toEqual({
        apiKey: 'sk-test',
        baseUrl: 'https://llm.test/v1',
        model: 'glm-4.6',
        protocol: 'openai-completions',
      })
    );
  });

  test('协议下拉提供三种协议（官方叫法，不带「兼容」），选 Anthropic Messages 后保存生效', async () => {
    renderModal();
    customMode();

    fireEvent.click(protocolTrigger());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'OpenAI Chat Completions',
      'OpenAI Responses',
      'Anthropic Messages',
    ]);
    // 选中项有 --selected，且菜单是自绘浮层（非原生 select）
    expect(document.querySelector('.settings-popover.settings-select-menu')).not.toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Responses' }));
    expect(document.querySelector('.settings-popover.settings-select-menu')).toBeNull(); // 选完收起
    expect(protocolValue()).toBe('OpenAI Responses');

    fireEvent.change(urlInput(), { target: { value: 'https://api.anthropic.com/v1' } });
    fireEvent.change(keyInput(), { target: { value: 'sk-ant' } });
    fireEvent.change(modelInput(), { target: { value: 'claude-sonnet-4-5' } });
    pickProtocol('Anthropic Messages');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(savedCfg().protocol).toBe('anthropic-messages'));
  });

  test('点击下拉以外的区域收起浮层', async () => {
    renderModal();
    customMode();

    fireEvent.click(protocolTrigger());
    expect(document.querySelector('.settings-select-menu')).not.toBeNull();

    fireEvent.mouseDown(screen.getByText('使用服务器配置'));
    await waitFor(() => expect(document.querySelector('.settings-select-menu')).toBeNull());
  });

  // 下拉字段不能包在 <label> 里：label 会把点击转发给控件，导致「API 协议」整行都可点（区域过大）
  test('点「API 协议」标签本身不会展开下拉，只有触发器可点', () => {
    renderModal();
    customMode();

    fireEvent.click(screen.getByText('API 协议'));
    expect(document.querySelector('.settings-select-menu')).toBeNull();
  });

  test('已有完整本地配置时默认进入「使用自定义配置」并回填（含协议）', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6', protocol: 'anthropic-messages' })
    );
    renderModal();

    expect(radio('使用自定义配置')).toBeChecked();
    expect(keyInput().value).toBe('sk-old');
    expect(protocolValue()).toBe('Anthropic Messages');
  });

  // 旧存储没有 protocol 字段：读出来按 openai-completions，不能因为缺字段就判定「未配置」
  test('旧存储（无 protocol 字段）仍视为已配置，协议回落到 OpenAI Chat Completions', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6' })
    );
    renderModal();

    expect(radio('使用自定义配置')).toBeChecked();
    expect(protocolValue()).toBe('OpenAI Chat Completions');
  });

  // 更早的版本存的是 openai / anthropic，读到要映射到规范名（否则下拉会显示成第一个选项、保存后把用户选择改掉）
  test('旧存储里的旧协议名（openai / anthropic）映射到规范名', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'k', baseUrl: 'https://llm.old/v1', model: 'm', protocol: 'anthropic' })
    );
    renderModal();

    expect(protocolValue()).toBe('Anthropic Messages');
  });

  test('切回「使用服务器配置」并保存会清掉本地配置，且字段随之隐藏', async () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6' })
    );
    renderModal();
    expect(keyInput()).toBeInTheDocument();

    fireEvent.click(radio('使用服务器配置'));
    expect(screen.queryByLabelText('API Key')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(savedCfg()).toBeNull());
  });

  test('「恢复默认设置」回到服务器配置并清掉本地配置', async () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6' })
    );
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '恢复默认设置' }));

    await waitFor(() => expect(savedCfg()).toBeNull());
    expect(radio('使用服务器配置')).toBeChecked();
    expect(screen.queryByLabelText('API Key')).toBeNull();
  });

  // 三项（地址 / Key / 模型）都填完才生效：**只有点过「保存」才开始校验**，
  // 一开始（含刚切到自定义配置时）不标红、不提示。
  describe('保存前校验：三项必须填完', () => {
    const invalidLabels = () =>
      [...document.querySelectorAll('.settings-field--invalid .settings-field-label')].map((el) => el.textContent);

    test('刚切到自定义配置时不标红、不提示', () => {
      renderModal();
      customMode();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(invalidLabels()).toEqual([]);
      expect(urlInput()).not.toHaveAttribute('aria-invalid');
      expect(keyInput()).not.toHaveAttribute('aria-invalid');
      expect(modelInput()).not.toHaveAttribute('aria-invalid');
    });

    test('只填部分时点保存不写存储，此时才提示并标红缺的字段', () => {
      renderModal();
      customMode();

      fireEvent.change(urlInput(), { target: { value: 'https://llm.test/v1' } });
      // 填了一项也还不标红（还没提交过）
      expect(screen.queryByRole('alert')).toBeNull();
      expect(invalidLabels()).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      expect(savedCfg()).toBeNull(); // 没保存
      expect(screen.getByRole('alert')).toHaveTextContent('三项没填完');
      expect(keyInput()).toHaveAttribute('aria-invalid', 'true');
      expect(modelInput()).toHaveAttribute('aria-invalid', 'true');
      expect(urlInput()).not.toHaveAttribute('aria-invalid');
      expect(invalidLabels()).toEqual(['API Key', '模型']);
    });

    test('点过保存后标红随填写实时收敛，三项补齐即自动消失，随后可保存', async () => {
      renderModal();
      customMode();

      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      expect(savedCfg()).toBeNull();
      expect(invalidLabels()).toEqual(['API 地址', 'API Key', '模型']);

      // 补上地址：它不再标红，但还缺两项，提示仍在
      fireEvent.change(urlInput(), { target: { value: 'https://llm.test/v1' } });
      expect(invalidLabels()).toEqual(['API Key', '模型']);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // 补上 Key：只剩模型标红
      fireEvent.change(keyInput(), { target: { value: 'sk-test' } });
      expect(invalidLabels()).toEqual(['模型']);

      // 补上模型：标红与提示一起自动消失（不必再点一次保存）
      fireEvent.change(modelInput(), { target: { value: 'glm-4.6' } });
      expect(invalidLabels()).toEqual([]);
      expect(screen.queryByRole('alert')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() =>
        expect(savedCfg()).toMatchObject({ apiKey: 'sk-test', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    test('只有空白字符不算已填', () => {
      renderModal();
      customMode();

      fireEvent.change(urlInput(), { target: { value: 'https://llm.test/v1' } });
      fireEvent.change(keyInput(), { target: { value: '   ' } });
      fireEvent.change(modelInput(), { target: { value: 'glm-4.6' } });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      expect(savedCfg()).toBeNull();
      expect(keyInput()).toHaveAttribute('aria-invalid', 'true');
    });

    test('切回「使用服务器配置」会撤掉上一次的校验痕迹', () => {
      renderModal();
      customMode();

      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fireEvent.click(radio('使用服务器配置'));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    test('选「使用服务器配置」时不受校验影响，保存即清掉本地配置', async () => {
      localStorage.setItem(
        'zyxf_llm',
        JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6' })
      );
      renderModal();

      fireEvent.click(radio('使用服务器配置'));
      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(savedCfg()).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});


// 手机端是两级结构（仿原生 App 设置页）：一级是设置列表，点进某个板块才显示其内容。
describe('SettingsModal 手机端：两级结构', () => {
  const row = (name) => screen.getByRole('button', { name });

  test('一级只显示设置列表；点行进二级显示该板块内容，返回后回到列表', () => {
    mockMobile();
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-1', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    renderModal();

    // 一级：居中标题是「设置」，三个列表行都在，板块内容与底部操作条都不渲染
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(row('智能对话配置')).toBeInTheDocument();
    expect(row('账户信息')).toBeInTheDocument();
    expect(row('外观')).toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();

    // 进二级：内容出现、列表收起、左上角按钮变成「返回」
    fireEvent.click(row('智能对话配置'));
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '账户信息' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();

    // 返回一级
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByLabelText('API Key')).toBeNull();
    expect(row('账户信息')).toBeInTheDocument();
    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  test('二级页面的标题跟随所选板块，内容整页展示不再往下拆', () => {
    mockMobile();
    renderModal();

    fireEvent.click(row('外观'));
    expect(screen.queryByText('设置')).toBeNull();
    expect(screen.getAllByText('外观').length).toBeGreaterThan(0);
    expect(screen.getByText('界面主题')).toBeInTheDocument();
    expect(screen.getByText('字体和语言')).toBeInTheDocument();
  });

  test('桌面端（不匹配手机断点）仍是左右分栏，不出现返回按钮', () => {
    renderModal();

    fireEvent.click(row('外观'));
    expect(screen.getByText('字体和语言')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  // 桌面端左栏顶部新增「设置」标题；手机端仍用顶部条的居中标题，两者互斥渲染（同一个词只出现一次）
  test('桌面端左栏有「设置」标题，手机端顶部标题不渲染', () => {
    renderModal();

    expect(document.querySelector('.settings-sidebar-title')).toHaveTextContent('设置');
    expect(document.querySelector('.settings-mobile-title')).toBeNull();
  });

  test('手机端一级用顶部条标题，不渲染桌面端左栏标题', () => {
    mockMobile();
    renderModal();

    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(document.querySelector('.settings-sidebar-title')).toBeNull();
  });
});
