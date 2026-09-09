import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  BookOpenCheck,
  Copyright,
  ExternalLink,
  GraduationCap,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { storageGet, storageSet } from '../ui.js';
import './NoticeModal.css';

/**
 * NoticeModal — 首次访问弹出的「使用须知」
 *
 * - localStorage 记录同意状态（key 见 STORAGE_KEY），每位访客仅首次展示；
 *   升级条款内容时递增版本号即可强制重新展示。
 * - 遮罩复用菜单打开时的 rb-frost-backdrop 磨砂样式；不同意则无法进入站点，
 *   无关闭按钮、点击遮罩/ESC 均无效。
 */

// 条款内容有实质变更时递增版本号，让已同意的访客重新看到更新后的须知。
const STORAGE_KEY = 'usage-notice-v2-agreed';

// 字典 notice.items 的 icon 字符串键 → lucide 组件映射。
const NOTICE_ICONS = {
  book: BookOpenCheck,
  shield: ShieldAlert,
  copyright: Copyright,
  alert: TriangleAlert,
  grad: GraduationCap,
  lock: LockKeyhole,
  external: ExternalLink,
  refresh: RefreshCw,
};

function readAgreed() {
  return storageGet(STORAGE_KEY) === '1';
}

export default function NoticeModal() {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(readAgreed);
  const noticeItems = useMemo(() => t('notice.items', { returnObjects: true }), [t]);

  // 同意前锁定页面滚动，配合全屏遮罩阻断一切站点操作。
  useEffect(() => {
    if (agreed) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [agreed]);

  if (agreed) return null;

  const agree = () => {
    // 隐私模式下存储失败也放行（storageSet 内部吞掉异常），避免每次访问都被拦截。
    storageSet(STORAGE_KEY, '1');
    setAgreed(true);
  };

  return createPortal(
    <div className="notice-backdrop rb-frost-backdrop" role="dialog" aria-modal="true" aria-label={t('notice.title')}>
      <div className="notice-card">
        <div className="notice-head">
          <h2 className="notice-title">{t('notice.title')}</h2>
        </div>

        <ul className="notice-list">
          {(noticeItems || []).map(({ icon, title, text }) => {
            const Icon = NOTICE_ICONS[icon] || BookOpenCheck;
            return (
              <li key={title} className="notice-item">
                <span className="notice-chip">
                  <Icon size={15} />
                </span>
                <p className="notice-item-text">
                  <strong className="notice-item-title">{title}：</strong>
                  {text}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="px-6 pb-5 pt-4">
          <button type="button" onClick={agree} className="notice-agree">
            <BadgeCheck size={16} />
            {t('notice.agree')}
          </button>
          <p className="notice-caption">{t('notice.caption')}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
