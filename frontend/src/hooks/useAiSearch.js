import { useCallback, useEffect, useRef, useState } from 'react';
import { chatStream, getChatStatus } from '../api.js';
import { loadLlmCfg, subscribeLlmCfg } from '../llmConfig.js';
import { useAuth } from '../auth.jsx';

/* ─────────────────────────────────────────────────────────
 * AI 搜索：搜索候选框顶部的一次性检索（原右栏「智能对话」卡片迁入）。
 * 状态机 idle → loading →（流式增量写进 text）→ done / error。
 * 与旧卡片同口径：服务端已配置 LLM 时不下发用户自带 Key；服务端未配置 +
 * 未登录 + 存了自带 Key 时后端要求登录，这里提前拦下（IMPROVE-10）。
 * ───────────────────────────────────────────────────────── */

// 流式增量先缓冲、50ms 批量落地（IMPROVE-52）：逐 token setState 会让文本区
// 每个 token 重渲染一次，长回答的开销近似 O(n²)。
const FLUSH_MS = 50;

export function useAiSearch() {
  // useAuth() 在无 Provider 的测试环境下返回 null——用可选链保持组件可独立渲染。
  const user = useAuth()?.user;
  const [status, setStatus] = useState('idle');
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [llmCfg, setLlmCfg] = useState(loadLlmCfg);
  // 服务端是否已配置 AI：null = 未知（保持「下发用户配置」的既有行为）。
  const [serverAiEnabled, setServerAiEnabled] = useState(null);
  const abortRef = useRef(null);
  const flushTimer = useRef(null);
  const pending = useRef('');

  useEffect(() => {
    let alive = true;
    getChatStatus()
      .then((s) => alive && setServerAiEnabled(!!s?.enabled))
      .catch(() => alive && setServerAiEnabled(false));
    return () => {
      alive = false;
    };
  }, []);

  // BUG-58：设置弹窗保存后，常驻的搜索框要立刻改用新配置（原先只在挂载时读一次）。
  useEffect(() => subscribeLlmCfg(() => setLlmCfg(loadLlmCfg())), []);

  const hasClientCfg = Boolean(llmCfg.apiKey && llmCfg.baseUrl && llmCfg.model);
  const loginRequired = serverAiEnabled === false && !user && hasClientCfg;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    pending.current = '';
  }, []);

  /** 回到入口态（关键词变了、候选框重开、用户清空搜索时调用）。 */
  const reset = useCallback(() => {
    stop();
    setStatus('idle');
    setText('');
    setItems(null);
    setError('');
  }, [stop]);

  // BUG-61：卸载时中止在途流，否则 SSE 继续消费、对已卸载组件 setState。
  useEffect(() => () => stop(), [stop]);

  const run = useCallback(
    async (query) => {
      const question = (query || '').trim();
      if (!question || loginRequired) return;
      stop();
      const abort = new AbortController();
      abortRef.current = abort;
      setStatus('loading');
      setText('');
      setItems(null);
      setError('');

      // 服务端已配置时不下发用户自带 Key（后端本就忽略它，避免密钥无谓外传）。
      // serverAiEnabled 为 null（状态未知）时保持既有行为：带上用户配置。
      const llm =
        serverAiEnabled !== true && hasClientCfg
          ? {
              apiKey: llmCfg.apiKey,
              baseUrl: llmCfg.baseUrl,
              model: llmCfg.model,
              protocol: llmCfg.protocol,
            }
          : undefined;

      // 中止后已 resolve 的 reader 回调仍会各触发一次，所以要自己判「这轮是否还有效」。
      const live = () => abortRef.current === abort && !abort.signal.aborted;
      const flush = () => {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
        const chunk = pending.current;
        pending.current = '';
        // flush 判 abortRef.current === abort（而非 live()）：中止时也要先把缓冲落进
        // 已有文本，否则会吃掉最后半句话。
        if (!chunk || abortRef.current !== abort) return;
        setText((prev) => prev + chunk);
      };

      try {
        await chatStream([{ role: 'user', content: question }], {
          signal: abort.signal,
          llm,
          onDelta: (delta) => {
            if (!live()) return;
            pending.current += delta;
            if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
          },
          onFiles: (files) => {
            if (live()) setItems(files);
          },
        });
        flush();
        if (live()) setStatus('done');
      } catch (err) {
        // 只有 abortRef 已被清空/换人（reset、发起了下一轮、卸载）才彻底丢弃。
        if (abortRef.current !== abort) return;
        flush();
        // 关键词被改动引起的中止不算失败：状态已由 reset 接管，别再落一条错误。
        if (err.name !== 'AbortError') {
          setError(err.message);
          setStatus('error');
        }
      } finally {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
        pending.current = '';
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [hasClientCfg, llmCfg, loginRequired, serverAiEnabled, stop]
  );

  return { status, text, items, error, loginRequired, run, reset };
}
