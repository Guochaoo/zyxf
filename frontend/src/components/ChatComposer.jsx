import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Settings, Trash2 } from 'lucide-react';
import { chatStream, getFileUrl } from '../api.js';
import { downloadFileById } from '../utils.js';
import FileIcon from './FileIcon.jsx';

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
  try {
    const raw = JSON.parse(localStorage.getItem(LLM_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
        model: typeof raw.model === 'string' ? raw.model : '',
      };
    }
  } catch {
    /* fallthrough */
  }
  return { apiKey: '', baseUrl: '', model: '' };
};

const HEADER_BTN_CLASS =
  'flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2 disabled:opacity-40 disabled:hover:bg-transparent';

function Section({ label, sub, time, body, resolving, children }) {
  return (
    <div
      className="flex w-full flex-col gap-1.5 transition-[opacity,filter,transform] duration-400"
      style={{
        opacity: resolving ? 0.55 : 1,
        filter: resolving ? 'blur(0.5px)' : 'blur(0)',
        transform: resolving ? 'scale(0.985)' : 'scale(1)',
        transformOrigin: 'top left',
        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        animation: 'fade-up 400ms cubic-bezier(0.23,1,0.32,1) both',
      }}
    >
      <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-ink-2">{sub}</span>
        <span className="text-ink">for {time}</span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-normal text-ink">{body}</p>
      {children}
    </div>
  );
}

function FileRow({ item }) {
  const navigate = useNavigate();

  const open = () => {
    if (item.type === 'folder') {
      navigate(`/folder/${item.id}`);
    } else {
      const targetPath = item.folder_id ? `/folder/${item.folder_id}` : '/';
      navigate(targetPath, { state: { previewFile: item } });
    }
  };

  const download = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await downloadFileById(item, getFileUrl);
    } catch (err) {
      alert(err.message || '下载失败');
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-[8px] transition-colors duration-100 hover:bg-hover">
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left"
      >
        {item.type === 'folder' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
        ) : (
          <FileIcon type="file" ext={item.ext} className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-ink">{item.name}</span>
          {item.type === 'file' && item.folder_path && (
            <span className="block truncate text-[11px] text-ink-3">{item.folder_path}</span>
          )}
        </span>
      </button>
      {item.type === 'file' && (
        <button
          type="button"
          onClick={download}
          aria-label={`下载 ${item.name}`}
          title="下载"
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-field hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </button>
      )}
    </div>
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
  // snapping 期间临时把消息列表设为 overflow-y-hidden，避免滚动条闪现。
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

  useEffect(() => () => clearTimeout(snapTimer.current), []);

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
      { id: aiId, role: 'ai', text: '', files: null, streaming: true, time: fmtTime() },
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
    localStorage.setItem(LLM_KEY, JSON.stringify(next));
    setSettingsOpen(false);
  };

  const clearSettings = () => {
    const empty = { apiKey: '', baseUrl: '', model: '' };
    setLlmCfg(empty);
    setCfgDraft(empty);
    localStorage.removeItem(LLM_KEY);
  };

  const canSend = draft.trim().length > 0 && !busy;

  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-[14px] bg-white ${
        collapsed || snapping ? '' : 'min-h-[288px] max-w-95 flex-1'
      }`}
    >
      {/* header — 智能对话标签 + 清空会话 + 设置 + 收起（样式对齐知识图谱卡片头部） */}
      <div className="flex shrink-0 items-center justify-between gap-1 bg-[#EFEFEF] p-1.5">
        <span className="shrink-0 px-2 py-[3px] text-[13px] font-medium text-ink">
          智能对话
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {!collapsed && (
            <>
              <button
                type="button"
                aria-label="清空会话历史"
                title="清空会话历史"
                disabled={busy || messages.length === 0}
                onClick={() => setMessages([])}
                className={HEADER_BTN_CLASS}
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
              <button
                type="button"
                aria-label="AI 设置"
                title="AI 设置（API Key / 地址 / 模型）"
                aria-expanded={settingsOpen}
                onClick={openSettings}
                className={HEADER_BTN_CLASS}
              >
                <Settings className="h-[15px] w-[15px]" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? '展开对话' : '收起对话'}
            aria-label={collapsed ? '展开对话' : '收起对话'}
            aria-expanded={!collapsed}
            className={HEADER_BTN_CLASS}
          >
            {collapsed ? (
              <ChevronDown className="h-[15px] w-[15px]" />
            ) : (
              <ChevronUp className="h-[15px] w-[15px]" />
            )}
          </button>
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
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          className={`flex min-h-0 flex-col overflow-hidden ${snapping ? '' : 'h-full'}`}
          style={{ height: snapping ? innerH : undefined }}
        >
      {/* 设置面板：客户端 LLM 配置（留空项回退服务器 env 配置） */}
      {settingsOpen && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-line p-2.5">
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
              清除本机配置
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
      )}

      {/* conversation — fixed region so the card never changes shape */}
      <div
        ref={listRef}
        className={`flex min-h-0 flex-1 flex-col gap-2.5 px-3 pt-2.5 pb-1 ${
          snapping ? 'overflow-y-hidden' : 'overflow-y-auto'
        }`}
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
              label="资料查询"
              sub={m.error ? '出错' : m.streaming ? (m.text ? '生成中' : '检索中') : '完成'}
              time={m.time}
              body={m.text || '正在检索资料库…'}
              resolving={m.streaming}
            >
              {m.files?.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {m.files.map((f) => (
                    <FileRow key={`${f.type}-${f.id}`} item={f} />
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
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
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
