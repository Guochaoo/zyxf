/*
 * /dzhz Hero 的滚动视差 —— 只保留预览窗口的后仰：
 * perspective(1600px) rotateX(0→5deg) scale(1→0.985)，进度按 hero 高度归一化。
 *
 * 原页的「背景随滚动 blur 20px + 进场对焦」是绑定在 WebGL 流体上的；流体已移除，
 * Hero 现在是静态 radial-gradient + 页面色遮罩，这两条运动曲线也就没有意义了，
 * 一并删掉，滚动时只剩一个很小的 rAF 平滑。
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export default function initHeroScroll(root) {
  const hero = root.querySelector('main > section');
  // Hero 预览已从「DeepSeek 桌面窗口」换成手机界面（.dz-app-stage），后仰挂在它身上。
  const surface = root.querySelector('[data-dz-preview]');
  if (!hero || !surface) return () => {};

  let target = 0;
  let current = 0;
  let raf = 0;

  const progress = () => {
    const height = hero.offsetHeight || 1;
    return clamp(window.scrollY / height, 0, 1);
  };

  const render = () => {
    const s = clamp(current / 0.65, 0, 1);
    surface.style.transform =
      s < 0.001
        ? 'none'
        : `perspective(1600px) rotateX(${5 * s}deg) scale(${1 - 0.015 * s})`;
  };

  const tick = () => {
    raf = 0;
    current += (target - current) * 0.16;
    if (Math.abs(target - current) < 0.0005) current = target;
    render();
    if (current !== target) raf = requestAnimationFrame(tick);
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
