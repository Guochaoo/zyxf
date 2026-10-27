/*
 * /dzhz Hero 的滚动视差 —— 复刻原页 useScroll + useSpring 的两条运动曲线：
 *   1. 预览窗口：perspective(1600px) rotateX(0→5deg) scale(1→0.985)，
 *      进度按 hero 高度归一化，0.65 之后到顶；
 *   2. 背景（radial-gradient + WebGL canvas）：随滚动最多 blur 20px，
 *      同时进场时还有一段 1.8s 的 20px → 0 的"对焦"动画。
 *
 * 原页用 framer-motion 的 spring（stiffness 160 / damping 28 / mass .6）。这里用
 * 指数平滑逼近同样的观感，避免为一条曲线引入 motion 的运行时。
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

export default function initHeroScroll(root) {
  const hero = root.querySelector('main > section');
  const surface = root.querySelector('[class*="HarnessHero_previewSurface"]');
  const background = hero?.querySelector(
    ':scope > .absolute.inset-0.z-0.overflow-hidden'
  );
  if (!hero || (!surface && !background)) return () => {};

  let target = 0;
  let current = 0;
  let introBlur = 20;
  let raf = 0;
  const start = performance.now();

  const progress = () => {
    const height = hero.offsetHeight || 1;
    return clamp(window.scrollY / height, 0, 1);
  };

  const render = () => {
    if (surface) {
      const s = clamp(current / 0.65, 0, 1);
      surface.style.transform =
        s < 0.001
          ? 'none'
          : `perspective(1600px) rotateX(${5 * s}deg) scale(${1 - 0.015 * s})`;
    }
    if (background) {
      const blur = Math.max(introBlur, 20 * Math.min(1, current / 0.6));
      background.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
    }
  };

  const tick = (now) => {
    raf = 0;
    const t = clamp((now - start) / 1800, 0, 1);
    introBlur = 20 * (1 - easeOut(t));
    current += (target - current) * 0.16;
    if (Math.abs(target - current) < 0.0005) current = target;
    render();
    if (t < 1 || current !== target) raf = requestAnimationFrame(tick);
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    target = progress();
    kick();
  };

  target = progress();
  current = target;
  kick();
  window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    window.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}
