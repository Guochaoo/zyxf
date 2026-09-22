import { useMemo, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth.jsx';
import { LogoIcon } from '../components/icons';

/* ─────────────────────────────────────────────────────────
 * Projects / Case Studies — About page rebuilt in this style.
 * Page background stays as the app theme (#F8F8F8); cards carry
 * their own surfaces. Images live in public/images/.
 * ───────────────────────────────────────────────────────── */

const EASE = [0.22, 1, 0.36, 1];

/* Non-translatable base per case study: (id, image).
 * Title/category come from the about.caseStudies dictionary (language-reactive).
 * Images are pre-resized WebP (see frontend/scripts/optimize-assets.py): the
 * cards render ~600 CSS px wide, so shipping the 2134px camera originals cost
 * ~3x the bytes the layout could use. */
const CASE_BASE = [
  {
    id: 'fina',
    image: '/images/final-lecture.webp',
  },
  {
    id: 'fresh',
    image: '/images/freshman-guide.webp',
  },
  {
    id: 'peer',
    image: '/images/peer-support.webp',
  },
  {
    id: 'lib',
    image: '/images/resource-sharing.webp',
  },
];

/* Case study card — image + info plate */
function CaseCard({ study, index, isAdmin }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: index * 0.1, ease: EASE }}
      className="relative aspect-[4/3] overflow-hidden bg-black"
    >
      {/* background image — first card is the LCP candidate, rest load lazily */}
      <img
        src={study.image}
        alt={study.title}
        width={1200}
        height={900}
        loading={index === 0 ? 'eager' : 'lazy'}
        fetchPriority={index === 0 ? 'high' : 'auto'}
        decoding="async"
        className="absolute h-full w-full object-cover"
      />

      {/* plus button — admin only */}
      {isAdmin && (
        <div className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center border border-white/30 text-xs text-white">
          +
        </div>
      )}
      {/* info plate */}
      <div className="absolute bottom-0 left-0 z-20 bg-surface px-4 pb-3 pt-2.5" style={{ maxWidth: '70%' }}>
        <div className="text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight text-ink">
          {study.title}
        </div>
        <div className="mt-1.5">
          <span className="text-[12px] text-ink-2">{study.category}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function AboutPage() {
  const { isAdmin } = useAuth();
  const { t } = useTranslation();
  const headerRef = useRef(null);
  const headerInView = useInView(headerRef, { once: true, margin: '-60px' });

  /* Case studies: merge language-reactive title/category with static image/id */
  const caseStudies = useMemo(() => {
    const titles = t('about.caseStudies', { returnObjects: true, defaultValue: [] });
    return CASE_BASE.map((base, i) => ({
      ...base,
      title: titles[i]?.title ?? '',
      category: titles[i]?.category ?? '',
    }));
  }, [t]);

  /* Marquee logos from dictionary */
  const marqueeLogos = useMemo(() => t('about.marquee', { returnObjects: true, defaultValue: [] }), [t]);

  return (
    <section
      className="relative bg-page text-ink"
      style={{ fontFamily: "'OPPOSans', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      {/* marquee keyframes */}
      <style>{`
        @keyframes marqueeProjects {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .marquee-projects {
          animation: marqueeProjects 28s linear infinite;
        }
        .marquee-projects:hover {
          animation-play-state: paused;
        }
        /* 「加入我们」CTA 的斜切扫过：与给定的 ::after + skewX(-45deg) scale(0→1) 等价。
           底色用 --surface（亮色 = 纯白、暗色 = 面板色，避免暗色下白底压浅色字），
           直角沿用关于页语言；宿主必须是层叠上下文（relative + z-index: 1），
           否则 z-index: -1 的伪元素会被自己的黑底盖住。
           横向外扩必须 ≥ 高度的一半：skewX(-45deg) 把上下边各平移 ±H/2，只扩 20%
           时 H/W 超过 0.4 的按钮就会在左上 / 右下各漏出一个露黑的小三角。 */
        .about-cta {
          position: relative;
          z-index: 1;
          overflow: hidden;
        }
        .about-cta::after {
          content: '';
          position: absolute;
          z-index: -1;
          left: -50%;
          right: -50%;
          top: 0;
          bottom: 0;
          background: var(--surface);
          transform: skewX(-45deg) scale(0, 1);
          transition: transform 0.5s;
        }
        .about-cta:hover,
        .about-cta:focus-visible {
          color: var(--ink);
        }
        .about-cta:hover::after,
        .about-cta:focus-visible::after {
          transform: skewX(-45deg) scale(1, 1);
        }
      `}</style>

      {/* Top area — header */}
      <div className="relative px-6 pb-10 pt-12 sm:px-10 lg:px-16 lg:pt-[60px]">
        <div ref={headerRef} className="relative mx-auto max-w-7xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={headerInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <span className="mb-5 inline-block bg-ink px-4 py-1.5 text-[13px] font-medium tracking-wide text-page">
              {t('about.tag')}
            </span>
            <div className="text-[clamp(1.8rem,3.2vw,2.8rem)] font-light leading-[1.25] tracking-tight">
              <span className="text-ink">{t('about.title')}</span>
              <br />
              <span className="text-[clamp(1.1rem,1.8vw,1.5rem)] text-ink-3">{t('about.sub')}</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Case study cards — 2x2 grid */}
      <div className="mx-auto max-w-7xl px-6 pb-16 sm:px-10 lg:px-16">
        <div className="grid gap-4 md:grid-cols-2">
          {caseStudies.map((study, i) => (
            <CaseCard key={study.id} study={study} index={i} isAdmin={isAdmin} />
          ))}
        </div>
      </div>

      {/* Footer area — CTA + marquee */}
      <div className="mx-auto max-w-7xl px-6 pb-6 sm:px-10 lg:px-16">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between">
          {/* left — pitch + CTA */}
          <div className="max-w-md">
            {isAdmin && (
              <div className="mb-4 flex h-7 w-7 items-center justify-center border border-line-strong text-xs text-ink">
                +
              </div>
            )}
            <p className="text-[14px] leading-[1.7] text-ink-2">
              {t('about.pitch')}
            </p>
            {/* 「加入我们」CTA：hover 时斜切白色扫过（扫满后文字转深色）。尺寸与原来的
                标签块完全一致；右侧原本紧贴的箭头方块按需求去掉。 */}
            <button
              type="button"
              className="about-cta mt-6 inline-flex items-center bg-ink px-[13px] py-[9px] text-base font-medium text-page"
            >
              {t('about.joinUs')}
            </button>
          </div>

          {/* right — logo marquee */}
          <div className="mt-8 flex-1 overflow-hidden border-t border-line md:ml-12 md:mt-0 md:border-t-0">
            <div className="overflow-hidden py-5">
              <div className="marquee-projects flex w-max">
                {[...marqueeLogos, ...marqueeLogos].map((logo, i) => (
                  <div key={i} className="flex shrink-0 items-center gap-2.5 px-8">
                    <span className="text-ink">
                      <LogoIcon type={logo.icon} />
                    </span>
                    <span className="whitespace-nowrap text-sm font-medium tracking-wide text-ink">
                      {logo.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* bottom spacer */}
      <div className="h-12" />
    </section>
  );
}
