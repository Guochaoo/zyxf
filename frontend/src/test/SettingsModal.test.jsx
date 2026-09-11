import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal.jsx';

// 语言下拉：点击「行 + 菜单」以外的任意处（含弹窗内空白与遮罩）应收起。
// 这里直接渲染弹窗（它用 createPortal，查询走 document.body）。

function renderModal() {
  return render(<SettingsModal open onClose={() => {}} />);
}

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
  const protocolSelect = () => screen.getByRole('combobox', { name: 'API 协议' });
  const customMode = () => fireEvent.click(radio('使用自定义配置'));

  test('本地无配置时默认选中「使用服务器配置」，且不显示自定义字段', () => {
    renderModal();

    expect(radio('使用服务器配置')).toBeChecked();
    expect(radio('使用自定义配置')).not.toBeChecked();
    expect(screen.queryByLabelText('API Key')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
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

  test('选「使用自定义配置」填完保存后写入本地存储（默认协议 OpenAI 兼容）', async () => {
    renderModal();
    customMode();

    expect(protocolSelect().value).toBe('openai-completions');
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

  test('协议下拉提供三种协议，选 Anthropic Messages 后保存生效', async () => {
    renderModal();
    customMode();

    const options = [...protocolSelect().options].map((o) => o.value);
    expect(options).toEqual(['openai-completions', 'openai-responses', 'anthropic-messages']);

    fireEvent.change(urlInput(), { target: { value: 'https://api.anthropic.com/v1' } });
    fireEvent.change(keyInput(), { target: { value: 'sk-ant' } });
    fireEvent.change(modelInput(), { target: { value: 'claude-sonnet-4-5' } });
    fireEvent.change(protocolSelect(), { target: { value: 'anthropic-messages' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(savedCfg().protocol).toBe('anthropic-messages'));
  });

  test('已有完整本地配置时默认进入「使用自定义配置」并回填（含协议）', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6', protocol: 'anthropic-messages' })
    );
    renderModal();

    expect(radio('使用自定义配置')).toBeChecked();
    expect(keyInput().value).toBe('sk-old');
    expect(protocolSelect().value).toBe('anthropic-messages');
  });

  // 旧存储没有 protocol 字段：读出来按 openai-completions，不能因为缺字段就判定「未配置」
  test('旧存储（无 protocol 字段）仍视为已配置，协议回落到 openai-completions', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-old', baseUrl: 'https://llm.old/v1', model: 'glm-4.6' })
    );
    renderModal();

    expect(radio('使用自定义配置')).toBeChecked();
    expect(protocolSelect().value).toBe('openai-completions');
  });

  // 更早的版本存的是 openai / anthropic，读到要映射到规范名（否则下拉会显示成第一个选项、保存后把用户选择改掉）
  test('旧存储里的旧协议名（openai / anthropic）映射到规范名', () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'k', baseUrl: 'https://llm.old/v1', model: 'm', protocol: 'anthropic' })
    );
    renderModal();

    expect(protocolSelect().value).toBe('anthropic-messages');
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
});
