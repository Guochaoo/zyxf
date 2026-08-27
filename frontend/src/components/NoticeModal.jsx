import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

const NOTICE_ITEMS = [
  {
    icon: BookOpenCheck,
    title: '资料来源',
    text: '本站收录的资料均由各个学业辅导组织制作或提供，本网站仅作汇总与索引，便于同学查阅复习；本站对内容本身不作任何背书。',
  },
  {
    icon: ShieldAlert,
    title: '文件安全',
    text: '本站不对资料的完整性、安全性与准确性作担保。请下载后自行查杀病毒、核验文件；因下载或内容使用造成的任何损失，本站概不负责。',
  },
  {
    icon: Copyright,
    title: '版权与侵权',
    text: '资料著作权归原作者及提供组织所有，仅供个人学习复习，未经许可请勿商用或二次传播；如发现涉嫌侵权内容，欢迎通过站内联系方式告知，我们将及时处理。',
  },
  {
    icon: TriangleAlert,
    title: '内容时效',
    text: '资料可能存在错漏、滞后或与教学大纲不一致之处，仅供参考；请以任课教师讲授与官方教材为准。',
  },
  {
    icon: GraduationCap,
    title: '学术诚信',
    text: '请遵守所在学校学术规范，合理正当使用本站资料；本站不支持任何学术不端行为，相关后果由使用者自行承担。',
  },
  {
    icon: LockKeyhole,
    title: '隐私保护',
    text: '本站不在站内公开展示或收集你的隐私信息；请妥善保护个人身份与联系方式，勿在公开区域泄露。',
  },
  {
    icon: ExternalLink,
    title: '第三方服务',
    text: '站内链接可能指向微信、Bilibili 等第三方平台，离开本站后相关服务由其提供方负责，并适用对方服务条款与隐私政策。',
  },
  {
    icon: RefreshCw,
    title: '服务与条款变更',
    text: '资源可能因维护、内容或政策调整随时变更或下架，恕不提前通知；本站亦可能更新本须知，更新后继续使用即视为接受。',
  },
];

function readAgreed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function NoticeModal() {
  const [agreed, setAgreed] = useState(readAgreed);

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
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* 隐私模式下存储失败也放行，避免每次访问都被拦截 */
    }
    setAgreed(true);
  };

  return createPortal(
    <div className="notice-backdrop rb-frost-backdrop" role="dialog" aria-modal="true" aria-label="使用须知">
      <div className="notice-card">
        <div className="notice-head">
          <h2 className="notice-title">使用须知</h2>
        </div>

        <ul className="notice-list">
          {NOTICE_ITEMS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="notice-item">
              <span className="notice-chip">
                <Icon size={15} />
              </span>
              <p className="notice-item-text">
                <strong className="notice-item-title">{title}：</strong>
                {text}
              </p>
            </li>
          ))}
        </ul>

        <div className="px-6 pb-5 pt-4">
          <button type="button" onClick={agree} className="notice-agree">
            <BadgeCheck size={16} />
            我已阅读并同意以上全部说明
          </button>
          <p className="notice-caption">点击同意后方可浏览与使用本站</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
