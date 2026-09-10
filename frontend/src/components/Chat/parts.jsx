import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowUpRight } from 'lucide-react';
import { openFolderOrFile } from '../../ui.js';

// ChatComposer 的展示组件（IMPROVE-01：从 20KB+ 的单文件里迁出无状态展示）。
// 均无数据请求，仅接收 props；流式状态由父组件通过 resolving/start 传入。

// 像素网格波浪（Drive 变体）：3×3 格子按斜向相位依次点亮
const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3), c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export function PixelGrid({ active }) {
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
export function Elapsed({ start, resolving }) {
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

export function Section({ sub, body, resolving, start, children }) {
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

export function FileChip({ item }) {
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
