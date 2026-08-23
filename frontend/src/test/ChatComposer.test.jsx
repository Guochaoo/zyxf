import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatComposer from '../components/ChatComposer.jsx';

// chatStream 由各用例注入实现
const chatStreamMock = vi.fn();
vi.mock('../api.js', () => ({
  getFileUrl: vi.fn(),
  chatStream: (...args) => chatStreamMock(...args),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ChatComposer />
    </MemoryRouter>
  );
}

function typeAndSend(text) {
  fireEvent.change(screen.getByLabelText('Chat prompt'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  chatStreamMock.mockReset();
  localStorage.clear();
});

describe('ChatComposer', () => {
  test('renders the 智能对话 label and welcome state', () => {
    renderPanel();
    expect(screen.getByText('智能对话')).toBeInTheDocument();
    expect(screen.getByText('问我资料在哪，我来帮你找：')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高数往年题在哪' })).toBeInTheDocument();
    // 垃圾桶在空会话时禁用
    expect(screen.getByRole('button', { name: '清空会话历史' })).toBeDisabled();
  });

  test('streams a reply with the Section style and file cards', async () => {
    chatStreamMock.mockImplementation(async (messages, { onDelta, onFiles }) => {
      expect(messages.at(-1)).toEqual({ role: 'user', content: '高数往年题在哪' });
      onDelta('推荐');
      onDelta('【文件1】');
      onFiles([{ id: 1, name: '高等数学期末版.pdf', type: 'file', folder_path: '高等数学', ext: 'pdf' }]);
    });

    renderPanel();
    typeAndSend('高数往年题在哪');

    await waitFor(() => expect(screen.getByText('推荐【文件1】')).toBeInTheDocument());
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('高等数学期末版.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  test('shows the error message when the API fails', async () => {
    chatStreamMock.mockRejectedValue(new Error('AI 功能未配置'));

    renderPanel();
    typeAndSend('你好');

    await waitFor(() => expect(screen.getByText('AI 功能未配置')).toBeInTheDocument());
    expect(screen.getByText('出错')).toBeInTheDocument();
  });

  test('trash button clears the conversation', async () => {
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();
    typeAndSend('hi');
    await waitFor(() =>
      expect(screen.queryByText('问我资料在哪，我来帮你找：')).not.toBeInTheDocument()
    );

    const trash = screen.getByRole('button', { name: '清空会话历史' });
    await waitFor(() => expect(trash).not.toBeDisabled());
    fireEvent.click(trash);
    expect(screen.getByText('问我资料在哪，我来帮你找：')).toBeInTheDocument();
  });

  test('settings panel saves config locally and sends it with chat requests', async () => {
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'test-key' } });
    fireEvent.change(
      screen.getByPlaceholderText('https://open.bigmodel.cn/api/paas/v4'),
      { target: { value: 'https://llm.test/v1' } }
    );
    fireEvent.change(screen.getByPlaceholderText('glm-4.6 / deepseek-chat …'), {
      target: { value: 'glm-4.6' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(JSON.parse(localStorage.getItem('zyxf_llm'))).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      model: 'glm-4.6',
    });

    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    const opts = chatStreamMock.mock.calls[0][1];
    expect(opts.llm).toEqual({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' });
  });

  test('clearing local config removes storage and stops sending llm', async () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'k', baseUrl: 'https://x.test', model: 'm' })
    );
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '清除本机配置' }));
    expect(localStorage.getItem('zyxf_llm')).toBeNull();

    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    expect(chatStreamMock.mock.calls[0][1].llm).toBeUndefined();
  });
});
