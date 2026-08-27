import { useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { useAuth } from '../auth.jsx';
import { ArrowUpRight } from 'lucide-react';
import { LogoIcon } from '../components/icons';

/* ─────────────────────────────────────────────────────────
 * Projects / Case Studies — About page rebuilt in this style.
 * Page background stays as the app theme (#F8F8F8); cards carry
 * their own surfaces. Images live in public/images/.
 * ───────────────────────────────────────────────────────── */

const EASE = [0.22, 1, 0.36, 1];

/* Magnetic square positions per case study: (x%, y%, size px) */
const CASE_STUDIES = [
  {
    id: 'fina',
    title: '期末讲座',
    category: '学业支持 · 期末辅导',
    image: '/images/final-lecture.jpeg',
  },
  {
    id: 'fresh',
    title: '新生导航',
    category: '入学指导 · 校园适应',
    image: '/images/freshman-guide.jpeg',
  },
  {
    id: 'peer',
    title: '朋辈互助',
    category: '学习互助 · 经验分享',
    image: '/images/peer-support.jpeg',
  },
  {
    id: 'lib',
    title: '资料共建',
    category: '资料库建设 · 知识沉淀',
    image: '/images/resource-sharing.png',
  },
];

/* Marquee logos: (name, icon key) */
const MARQUEE_LOGOS = [
  { name: '期末复习', icon: 'code' },
  { name: '新生导航', icon: 'dots' },
  { name: '朋辈互助', icon: 'circle-ring' },
  { name: '资料共建', icon: 'arrow' },
  { name: '答疑辅导', icon: 'wave-circle' },
  { name: '专题分享', icon: 'lines' },
  { name: '经验交流', icon: 'bolt' },
  { name: '学业支持', icon: 'plus' },
];

/* Case study card — pixel-dissolve hover + info plate */
function CaseCard({ study, index, isAdmin }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: index * 0.1, ease: EASE }}
      className="group relative aspect-[4/3] overflow-hidden bg-black"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* background image */}
      <img src={study.image} alt={study.title} className="absolute h-full w-full object-cover" />

      {/* pixel-block dissolve overlay — 12×8 grid, diagonal stagger */}
      <div className="absolute inset-0 z-[4]">
        {Array.from({ length: 96 }).map((_, i) => {
          const row = Math.floor(i / 12);
          const col = i % 12;
          const delayIn = (row + col) * 0.018;
          const delayOut = (8 - row + (12 - col)) * 0.012;
          return (
            <div
              key={i}
              className="absolute scale-0 bg-black/80 opacity-0 transition-[opacity,transform] duration-250 ease-out group-hover:scale-100 group-hover:opacity-100"
              style={{
                width: `${100 / 12}%`,
                height: `${100 / 8}%`,
                left: `${col * (100 / 12)}%`,
                top: `${row * (100 / 8)}%`,
                transitionDelay: `${hovered ? delayIn : delayOut}s`,
              }}
            />
          );
        })}
      </div>

      {/* plus button — admin only */}
      {isAdmin && (
        <div className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center border border-white/30 text-xs text-white">
          +
        </div>
      )}
      {/* info plate */}
      <div className="absolute bottom-0 left-0 z-20 bg-white px-4 pb-3 pt-2.5" style={{ maxWidth: '70%' }}>
        <div className="text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight text-black">
          {study.title}
        </div>
        <div className="mt-1.5">
          <span className="text-[12px] text-black/60">{study.category}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function AboutPage() {
  const { isAdmin } = useAuth();
  const headerRef = useRef(null);
  const headerInView = useInView(headerRef, { once: true, margin: '-60px' });

  return (
    <section
      className="relative text-black"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
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
      `}</style>

      {/* Top area — header */}
      <div className="relative px-6 pb-10 pt-12 sm:px-10 lg:px-16 lg:pt-[60px]">
        <div ref={headerRef} className="relative mx-auto max-w-7xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={headerInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <span className="mb-5 inline-block bg-black px-4 py-1.5 text-[13px] font-medium tracking-wide text-white">
              仲英学辅
            </span>
            <div className="text-[clamp(1.8rem,3.2vw,2.8rem)] font-light leading-[1.25] tracking-tight">
              <span className="text-black">我们做了什么</span>
              <br />
              <span className="text-[clamp(1.1rem,1.8vw,1.5rem)] text-black/40">资料 · 讲座 · 答疑</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Case study cards — 2x2 grid */}
      <div className="mx-auto max-w-7xl px-6 pb-16 sm:px-10 lg:px-16">
        <div className="grid gap-4 md:grid-cols-2">
          {CASE_STUDIES.map((study, i) => (
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
              <div className="mb-4 flex h-7 w-7 items-center justify-center border border-black/20 text-xs text-black">
                +
              </div>
            )}
            <p className="text-[14px] leading-[1.7] text-black/60">
              仲英书院学业辅导中心面向书院同学开展学业支持工作，把课程资料、朋辈经验和辅导方法沉淀为可持续的学习支持体系，让每一位同学都能获得更清晰、更持久的学习帮助。
            </p>
            <button type="button" className="group mt-6 flex items-start">
              <span className="inline-flex items-center gap-[10px] border border-black/20 bg-black px-3 py-2 text-base font-medium text-white transition-colors duration-200 group-hover:bg-black/85">
                加入我们
              </span>
              <span className="flex h-6 w-6 items-center justify-center bg-black text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-y-[18px]">
                <ArrowUpRight size={16} strokeWidth={2} />
              </span>
            </button>
          </div>

          {/* right — logo marquee */}
          <div className="mt-8 flex-1 overflow-hidden border-t border-black/10 md:ml-12 md:mt-0 md:border-t-0">
            <div className="overflow-hidden py-5">
              <div className="marquee-projects flex w-max">
                {[...MARQUEE_LOGOS, ...MARQUEE_LOGOS].map((logo, i) => (
                  <div key={i} className="flex shrink-0 items-center gap-2.5 px-8">
                    <span className="text-black">
                      <LogoIcon type={logo.icon} />
                    </span>
                    <span className="whitespace-nowrap text-sm font-medium tracking-wide text-black/80">
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
