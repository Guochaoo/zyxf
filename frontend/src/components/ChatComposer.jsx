import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Settings, Square, Trash2 } from 'lucide-react';
import { chatStream, getChatStatus } from '../api.js';
import { EASE_COLLAPSE, ICON_BUTTON_CLASS } from './ui.js';
import PanelHeader from './PanelHeader.jsx';
import { loadLlmCfg, subscribeLlmCfg } from '../llmConfig.js';
import { useAuth } from '../auth.jsx';
// 展示组件已迁至 ./Chat/parts.jsx（IMPROVE-01）。
import { FileChip, Section } from './Chat/parts.jsx';

/* ─────────────────────────────────────────────────────────
 * CHAT — interactive panel with a header, replies, and composer.
 * 头部：智能对话标签 + 清空会话 + 设置（齿轮）。齿轮不再就地展开表单，
 * 而是交给上层打开全局设置弹窗（大模型配置项已在弹窗里有完整实现），
 * 避免同一份 localStorage 配置在两处维护。
 * 回复经 SSE 流式渲染，检索推荐的文件以【文件N】引用映射为卡片。
 * ───────────────────────────────────────────────────────── */

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建），与知识图谱一致。
let chatCollapsedPersistent = false;

let nextId = 1;

const fmtTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};


export default function ChatComposer({ onOpenSettings }) {
  const { t } = useTranslation();
  // useAuth() 在无 Provider 的测试环境下返回 null —— 用可选链保持组件可独立渲染。
  const user = useAuth()?.user;
  const suggestions = useMemo(() => t('chat.suggestions', { returnObjects: true }), [t]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(chatCollapsedPersistent);
  const [llmCfg, setLlmCfg] = useState(loadLlmCfg);
  // 服务端是否已配置 AI：null=未知（保持「发送用户配置」的既有行为）。
  // 已知为 true 时不再上传用户自带 Key。
  const [serverAiEnabled, setServerAiEnabled] = useState(null);
  useEffect(() => {
    let alive = true;
    getChatStatus()
      .then((s) => alive && setServerAiEnabled(!!s?.enabled))
      .catch(() => alive && setServerAiEnabled(false));
    return () => {
      alive = false;
    };
  }, []);
  // IMPROVE-10：服务端未配置 AI + 自带 Key 时后端要求登录，前端提前禁用输入并说明原因。
  const hasClientCfg = Boolean(llmCfg.apiKey && llmCfg.baseUrl && llmCfg.model);
  const loginRequired = serverAiEnabled === false && !user && hasClientCfg;

  // 折叠动画：snapH 以像素高度驱动过渡（fr/auto 高度无法从当前值平滑过渡），
  // innerH 把内层冻结在固定高度——内容不重排，由外层容器从下往上裁剪（同知识图谱）；
  // 消息列表始终 overflow-y-auto + scrollbar-gutter: stable，滚动条槽位恒定，
  // 动画前后宽度不变，文字不再重排，也没有无→有的滚动条翻转。
  const [snapH, setSnapH] = useState(null);
  const [innerH, setInnerH] = useState(null);
  const [snapping, setSnapping] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const bodyRef = useRef(null);
  const snapTimer = useRef(null);
  const snapSeq = useRef(0);
  // 最近一次收起时的完整高度（px 数值）：展开动画的目标值——卡片本体跟着容器
  // 一起长高（而不是瞬间弹到全高再揭示内容），结束后无缝交还给 flex 布局。
  const fullHRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // BUG-61：卸载时中止在途流式请求并清计时器（否则 SSE 继续消费、对已卸载组件 setState）。
  useEffect(
    () => () => {
      clearTimeout(snapTimer.current);
      abortRef.current?.abort();
    },
    []
  );

  // BUG-58：设置弹窗保存后常驻右栏要立刻用新配置（原先只在挂载时读一次）。
  useEffect(() => subscribeLlmCfg(() => setLlmCfg(loadLlmCfg())), []);

  // 动画结束（360ms 过渡 + 余量）后回到自然布局（高度交还给 flex）
  const endSnap = () => {
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      setSnapH(null);
      setInnerH(null);
      setSnapping(false);
    }, 500);
  };

  const toggleCollapsed = () => {
    clearTimeout(snapTimer.current);
    const wasSnapping = snapping;
    setSnapping(true);
    const seq = ++snapSeq.current;
    if (!collapsed) {
      // 收起：先冻结当前实际高度，下一帧外层过渡到 0，内层保持冻结（内容不动、被裁剪）
      const h = bodyRef.current?.getBoundingClientRect().height;
      if (!wasSnapping && h) fullHRef.current = h;
      const frozen = h ? `${h}px` : '0px';
      setSnapH(frozen);
      setInnerH(frozen);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (snapSeq.current !== seq) return;
          chatCollapsedPersistent = true;
          setCollapsed(true);
          setSnapH('0px');
        });
      });
    } else {
      // 展开：用收起时记录的完整高度做目标，卡片本体（仍处收缩态）跟着容器
      // 一起平滑长高，而不是瞬间弹满再揭示内容。
      const target = fullHRef.current;
      if (target == null) {
        // 没有可参考高度（理论不可达）：直接展开，不做动画
        chatCollapsedPersistent = false;
        setCollapsed(false);
        endSnap();
        return;
      }
      chatCollapsedPersistent = false;
      setCollapsed(false);
      setInnerH(snapH ?? '0px');
      if (snapH == null) setSnapH('0px');
      requestAnimationFrame(() => {
        if (snapSeq.current !== seq) return;
        setSnapH(`${target}px`);
        setInnerH(`${target}px`);
      });
    }
    endSnap();
  };

  const stop = () => abortRef.current?.abort();

  // BUG-61：清空时同时中止在途请求（否则流式回答会继续写进已清空的会话）。
  const clearConversation = () => {
    abortRef.current?.abort();
    setMessages([]);
  };

  const send = async (text) => {
    const question = (text ?? draft).trim();
    if (!question || busy || loginRequired) return;

    const history = [
      ...messages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      })),
      { role: 'user', content: question },
    ].slice(-8);

    const aiId = nextId++;
    setMessages((prev) => [
      ...prev,
      { id: nextId++, role: 'user', text: question, time: fmtTime() },
      { id: aiId, role: 'ai', text: '', files: null, streaming: true, time: fmtTime(), start: Date.now() },
    ]);
    setDraft('');
    setBusy(true);

    // 服务端已配置 AI 时不再上传用户自带 Key（后端本就忽略它，避免密钥无谓外传）。
    // serverAiEnabled 为 null（状态未知）时保持既有行为：带上用户配置。
    const llm =
      serverAiEnabled !== true && llmCfg.apiKey && llmCfg.baseUrl && llmCfg.model
        ? { apiKey: llmCfg.apiKey, baseUrl: llmCfg.baseUrl, model: llmCfg.model }
        : undefined;

    const patchAi = (patch) =>
      setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, ...patch } : m)));

    const abort = new AbortController();
    abortRef.current = abort;
    // BUG-61：signal 只能停止读取，已 resolve 的 reader 回调仍会各触发一次，
    // 所以要自己判「这轮是否还有效」，否则「已停止生成。」后面会被追加半截文本。
    const live = () => abortRef.current === abort && !abort.signal.aborted;
    try {
      await chatStream(history, {
        signal: abort.signal,
        llm,
        onDelta: (t) => {
          if (!live()) return;
          setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, text: m.text + t } : m)));
        },
        onFiles: (files) => {
          if (!live()) return;
          patchAi({ files });
        },
      });
      if (live()) patchAi({ streaming: false });
    } catch (err) {
      // 仍然处理本次请求的失败（用户点「停止」也走这里，要落「已停止生成。」）；
      // 只有 abortRef 已被清空/换人（卸载、发起了下一轮）才彻底丢弃。
      if (abortRef.current !== abort) return;
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId ? { ...m, streaming: false, text: m.text || t('chat.stopped') } : m
          )
        );
      } else {
        patchAi({ streaming: false, error: true, text: err.message });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const openSettings = () => onOpenSettings?.();

  const canSend = draft.trim().length > 0 && !busy && !loginRequired;

  return (
    <div
      className={`relative flex w-full flex-col overflow-hidden rounded-[14px] bg-surface ${
        collapsed || snapping ? '' : 'min-h-[288px] max-w-95 flex-1'
      }`}
    >
      {/* header — 智能对话标签 + 清空会话 + 设置 + 收起（样式对齐知识图谱卡片头部） */}
      <PanelHeader
        title={t('chat.title')}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        expandTitle={t('chat.expand')}
        collapseTitle={t('chat.collapse')}
      >
        <button
          type="button"
          aria-label={t('chat.clear')}
          title={t('chat.clear')}
          // BUG-61：流式期间也保持可点（点击会先中止在途请求）。
          disabled={messages.length === 0}
          onClick={clearConversation}
          className={ICON_BUTTON_CLASS}
        >
          <Trash2 className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          aria-label={t('chat.settingsAria')}
          title={t('chat.settingsTitle')}
          onClick={openSettings}
          className={ICON_BUTTON_CLASS}
        >
          <Settings className="h-[15px] w-[15px]" />
        </button>
      </PanelHeader>

      {/* 主体：height 像素过渡收起/展开；动画期间锁定高度、隐藏列表滚动条 */}
      {/* 收起/动画期间设 inert：内容只是被 height:0 + overflow:hidden 裁掉，控件仍在
          Tab 顺序里——键盘用户会聚焦到看不见的输入框，盲打回车真的会把问题发出去。 */}
      <div
        ref={bodyRef}
        className={`min-h-0 shrink overflow-hidden transition-[height] duration-[360ms] ${
          snapH == null ? 'grow' : ''
        }`}
        style={{
          height: snapH ?? (collapsed ? '0px' : undefined),
          transitionTimingFunction: EASE_COLLAPSE,
        }}
        inert={collapsed || snapping ? '' : undefined}
      >
        <div
          className={`flex min-h-0 flex-col overflow-hidden ${snapping ? '' : 'h-full'}`}
          style={{ height: snapping ? innerH : undefined }}
        >

      {/* conversation — fixed region so the card never changes shape */}
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pt-2.5 pb-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-start justify-center gap-2 py-4">
            <p className="w-full text-center text-[12.5px] text-ink-2">
              {loginRequired ? t('chat.loginRequired') : t('chat.askHint')}
            </p>
            {!loginRequired && (
              <div className="flex flex-wrap gap-1.5 pl-4">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full bg-field px-2.5 py-1 text-[12px] text-ink-2 transition-colors duration-100 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end pl-14">
              <div className="rounded-xl bg-field px-3 py-1.5 text-[13px] leading-[1.4] text-ink">
                {m.text}
              </div>
            </div>
          ) : (
            <Section
              key={m.id}
              sub={m.error ? t('chat.status.error') : m.streaming ? (m.text ? t('chat.status.generating') : t('chat.status.searching')) : t('chat.status.done')}
              body={m.text || t('chat.status.searchingLibrary')}
              resolving={m.streaming}
              start={m.start}
            >
              {m.files?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {m.files.map((f) => (
                    <FileChip key={`${f.type}-${f.id}`} item={f} />
                  ))}
                </div>
              )}
            </Section>
          )
        )}
      </div>

      {/* composer */}
      <div className="mt-auto shrink-0 p-1.5">
        <div
          role="presentation"
          onClick={() => inputRef.current?.focus()}
          className="flex cursor-text flex-col gap-2 rounded-[10px] bg-field p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.035)] transition-[box-shadow] duration-150 focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.025)]"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // 中文输入法用回车选词：合成期间必须忽略，否则半截问题会被直接发出。
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) send();
            }}
            placeholder={t('chat.promptPlaceholder')}
            disabled={loginRequired}
            aria-label={t('chat.promptAria')}
            className="chat-prompt min-h-4.5 bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-end">
            {busy ? (
              <button
                type="button"
                aria-label={t('chat.stopAria')}
                title={t('chat.stopAria')}
                onClick={stop}
                className="flex size-7 items-center justify-center rounded-[8px] bg-field text-ink transition-[background-color,transform] duration-200 hover:bg-hover active:scale-[0.96]"
              >
                <Square size={11} fill="currentColor" strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                aria-label={t('chat.sendAria')}
                disabled={!canSend}
                onClick={() => send()}
                className="flex size-7 items-center justify-center rounded-[8px]
                  transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
                style={{
                  background: canSend ? 'var(--ink)' : 'var(--line-strong)',
                  color: canSend ? 'var(--surface)' : 'var(--ink-2)',
                }}
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
