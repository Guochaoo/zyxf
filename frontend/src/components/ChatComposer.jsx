import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowUp, ArrowUpRight, Settings, Square, Trash2 } from 'lucide-react';
import { chatStream } from '../api.js';
import { EASE_COLLAPSE, ICON_BUTTON_CLASS } from './ui.js';
import PanelHeader from './PanelHeader.jsx';
import { openFolderOrFile, storageGet, storageSet, storageRemove } from '../ui.js';
import { useClickOutside } from '../hooks/useClickOutside.js';

/* ─────────────────────────────────────────────────────────
 * CHAT — interactive panel with a header, replies, and composer.
 * 头部：智能对话标签 + 清空会话（垃圾桶）+ 设置（API Key / 地址 / 模型，
 * 存 localStorage，请求时随 body 下发给后端覆盖服务端 env 配置）。
 * 回复经 SSE 流式渲染，检索推荐的文件以【文件N】引用映射为卡片。
 * ───────────────────────────────────────────────────────── */

const SUGGESTIONS = ['高数往年题在哪', '有没有物理复习资料', '线代课件推荐一下'];
const LLM_KEY = 'zyxf_llm';

// 收起状态跨页面导航保留（右栏组件会随路由卸载重建），与知识图谱一致。
let chatCollapsedPersistent = false;

let nextId = 1;

const fmtTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const loadLlmCfg = () => {
  let raw = null;
  try {
    raw = JSON.parse(storageGet(LLM_KEY) ?? 'null');
  } catch {
    /* 存储值损坏时按未配置处理 */
  }
  if (raw && typeof raw === 'object') {
    return {
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      model: typeof raw.model === 'string' ? raw.model : '',
    };
  }
  return { apiKey: '', baseUrl: '', model: '' };
};

// 像素网格波浪（Drive 变体）：3×3 格子按斜向相位依次点亮
const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3), c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

function PixelGrid({ active }) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {CHEVRON.map((delay, i) => (
        <span
          key={i}
          className="size-[4px] rounded-[1px] bg-black"
          style={
            active
              ? { opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }
              : { opacity: 1 }
          }
        />
      ))}
    </span>
  );
}

// 从发送时刻起实时计时；resolving 结束（消息完成）时定格，不再消失
function Elapsed({ start, resolving }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!resolving) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [resolving, start]);
  const sec = Math.max(0, now - (start || now)) / 1000;
  const text = sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(1)}s`;
  return <span className="font-mono text-[12px] text-black tabular-nums">{text}</span>;
}

function Section({ sub, body, resolving, start, children }) {
  return (
    <div
      className="flex w-full flex-col gap-1.5"
      style={{ animation: 'fade-up 400ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
        <PixelGrid active={!!resolving} />
        <span className={resolving ? 'shimmer-label' : 'text-black'}>{sub}</span>
        <Elapsed start={start} resolving={!!resolving} />
      </div>
      <div className="chat-md text-[13px] leading-normal text-ink">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
      {children}
    </div>
  );
}

// 检索/推荐文件 → 小胶囊：彩色类型徽章 + 文件名 + 外链图标，整颗可点击打开/预览
const EXT_TONE = {
  pdf: 'bg-red',
  csv: 'bg-green', xls: 'bg-green', xlsx: 'bg-green',
  doc: 'bg-orange', docx: 'bg-orange', ppt: 'bg-orange', pptx: 'bg-orange',
  txt: 'bg-orange', md: 'bg-orange',
};
const DEFAULT_TONE = 'bg-brand-500';

function FileChip({ item }) {
  const navigate = useNavigate();

  const open = () => openFolderOrFile(item, navigate);

  const badge = item.type === 'folder' ? 'DIR' : (item.ext || '').toUpperCase().slice(0, 4);
  const tone =
    item.type === 'folder' ? 'bg-[#808080]' : EXT_TONE[(item.ext || '').toLowerCase()] || DEFAULT_TONE;

  return (
    <button
      type="button"
      onClick={open}
      title={item.name}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn transition-colors duration-300 hover:bg-hover"
    >
      <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] ${tone} text-[7px] font-bold text-white`}>
        {badge}
      </span>
      <span className="min-w-0 truncate">{item.name}</span>
      <ArrowUpRight className="shrink-0" size={9} strokeWidth={2.5} />
    </button>
  );
}

export default function ChatComposer() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(chatCollapsedPersistent);
  const [llmCfg, setLlmCfg] = useState(loadLlmCfg);
  const [cfgDraft, setCfgDraft] = useState(loadLlmCfg);
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
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  // 最近一次收起时的完整高度（px 数值）：展开动画的目标值——卡片本体跟着容器
  // 一起长高（而不是瞬间弹到全高再揭示内容），结束后无缝交还给 flex 布局。
  const fullHRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => clearTimeout(snapTimer.current), []);

  // 设置浮层打开时，点击浮层与设置按钮之外的空白处收起。
  useClickOutside(settingsOpen, () => setSettingsOpen(false), settingsRef, settingsBtnRef);

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

  const send = async (text) => {
    const question = (text ?? draft).trim();
    if (!question || busy) return;

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

    // 三项齐全才随请求下发，否则交给服务端 env 配置
    const llm =
      llmCfg.apiKey && llmCfg.baseUrl && llmCfg.model
        ? { apiKey: llmCfg.apiKey, baseUrl: llmCfg.baseUrl, model: llmCfg.model }
        : undefined;

    const patchAi = (patch) =>
      setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, ...patch } : m)));

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await chatStream(history, {
        signal: abort.signal,
        llm,
        onDelta: (t) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, text: m.text + t } : m))
          ),
        onFiles: (files) => patchAi({ files }),
      });
      patchAi({ streaming: false });
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId ? { ...m, streaming: false, text: m.text || '已停止生成。' } : m
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

  const openSettings = () => {
    setCfgDraft(llmCfg);
    setSettingsOpen((v) => !v);
  };

  const saveSettings = () => {
    const next = {
      apiKey: cfgDraft.apiKey.trim(),
      baseUrl: cfgDraft.baseUrl.trim(),
      model: cfgDraft.model.trim(),
    };
    setLlmCfg(next);
    storageSet(LLM_KEY, JSON.stringify(next));
    setSettingsOpen(false);
  };

  const clearSettings = () => {
    const empty = { apiKey: '', baseUrl: '', model: '' };
    setLlmCfg(empty);
    setCfgDraft(empty);
    storageRemove(LLM_KEY);
  };

  const canSend = draft.trim().length > 0 && !busy;

  return (
    <div
      className={`relative flex w-full flex-col overflow-hidden rounded-[14px] bg-white ${
        collapsed || snapping ? '' : 'min-h-[288px] max-w-95 flex-1'
      }`}
    >
      {/* header — 智能对话标签 + 清空会话 + 设置 + 收起（样式对齐知识图谱卡片头部） */}
      <PanelHeader
        title="智能对话"
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        expandTitle="展开对话"
        collapseTitle="收起对话"
      >
        <button
          type="button"
          aria-label="清空会话历史"
          title="清空会话历史"
          disabled={busy || messages.length === 0}
          onClick={() => setMessages([])}
          className={ICON_BUTTON_CLASS}
        >
          <Trash2 className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          ref={settingsBtnRef}
          aria-label="AI 设置"
          title="AI 设置（API Key / 地址 / 模型）"
          aria-expanded={settingsOpen}
          onClick={openSettings}
          className={ICON_BUTTON_CLASS}
        >
          <Settings className="h-[15px] w-[15px]" />
        </button>
      </PanelHeader>

      {/* 设置浮层：客户端 LLM 配置（留空项回退服务器 env 配置）。
          悬浮在对话区上方（不挤占布局），常驻挂载以保留淡入/淡出过渡；
          点击浮层与设置按钮之外的空白处收起；visibility 随过渡翻转，
          收起后表单不可聚焦。 */}
      <div
        ref={settingsRef}
        className="absolute inset-x-2 top-[40px] z-10 max-h-[calc(100%-52px)] overflow-y-auto rounded-[10px] bg-white p-2.5 shadow-[0_4px_10px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.12)]"
        style={{
          visibility: settingsOpen ? 'visible' : 'hidden',
          opacity: settingsOpen ? 1 : 0,
          transform: settingsOpen ? 'translateY(0)' : 'translateY(-4px)',
          transitionProperty: 'visibility, opacity, transform',
          transitionDuration: '240ms',
          transitionTimingFunction: EASE_COLLAPSE,
        }}
      >
        <div className="flex flex-col gap-1.5">
          {[
            { key: 'apiKey', label: 'API Key', placeholder: 'sk-…', type: 'password' },
            { key: 'baseUrl', label: 'API 地址', placeholder: 'https://open.bigmodel.cn/api/paas/v4', type: 'text' },
            { key: 'model', label: '模型', placeholder: 'glm-4.6 / deepseek-chat …', type: 'text' },
          ].map(({ key, label, placeholder, type }) => (
            <label key={key} className="flex items-center gap-2 text-[11px] text-ink-2">
              <span className="w-12 shrink-0">{label}</span>
              <input
                type={type}
                value={cfgDraft[key]}
                onChange={(e) => setCfgDraft((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={placeholder}
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-field px-2 py-1 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
              />
            </label>
          ))}
          <p className="text-[11px] leading-relaxed text-ink-3">
            三项都填写后使用本浏览器配置；留空任意项则使用服务器配置。配置仅保存在本地浏览器。
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={clearSettings}
              className="rounded-[6px] px-2 py-[3px] text-[12px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              恢复默认设置
            </button>
            <button
              type="button"
              onClick={saveSettings}
              className="rounded-[6px] bg-field px-2 py-[3px] text-[12px] text-ink transition-colors duration-100 hover:bg-hover"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {/* 主体：height 像素过渡收起/展开；动画期间锁定高度、隐藏列表滚动条 */}
      <div
        ref={bodyRef}
        className={`min-h-0 shrink overflow-hidden transition-[height] duration-[360ms] ${
          snapH == null ? 'grow' : ''
        }`}
        style={{
          height: snapH ?? (collapsed ? '0px' : undefined),
          transitionTimingFunction: EASE_COLLAPSE,
        }}
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
            <p className="w-full text-center text-[12.5px] text-ink-2">问我资料在哪，我来帮你找：</p>
            <div className="flex flex-wrap gap-1.5 pl-4">
              {SUGGESTIONS.map((s) => (
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
              sub={m.error ? '出错' : m.streaming ? (m.text ? '生成中' : '检索中') : '完成'}
              body={m.text || '正在检索资料库…'}
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
              if (event.key === 'Enter') send();
            }}
            placeholder="输入问题…"
            aria-label="Chat prompt"
            className="chat-prompt min-h-4.5 bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-end">
            {busy ? (
              <button
                type="button"
                aria-label="停止生成"
                title="停止生成"
                onClick={stop}
                className="flex size-7 items-center justify-center rounded-[8px] bg-field text-ink transition-[background-color,transform] duration-200 hover:bg-hover active:scale-[0.96]"
              >
                <Square size={11} fill="currentColor" strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
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
