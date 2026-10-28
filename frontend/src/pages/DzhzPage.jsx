import { useEffect, useRef } from 'react';
import initHeroBackground from './Dzhz/heroBackground.js';
import initHeroScroll from './Dzhz/heroScroll.js';
import initHeaderScroll from './Dzhz/headerScroll.js';
import html from './Dzhz/content.html?raw';
import './Dzhz/dzhz.css';

/* ============================================================
 * 岱宗盒子（/dzhz）—— 临时 1:1 复刻 deepseek.com/harness 的落地页。
 *
 * 为什么是 dangerouslySetInnerHTML：
 *   原页是 Next.js 的 SSR 产物，整页 2300+ 个节点、42 条 CSS 关键帧、一堆
 *   CSS Modules 哈希类名。逐节点改写成 JSX 只会引入静默的版式漂移，而这里的
 *   目标就是「先一模一样」。所以 content.html 保存原样 DOM，base.css 保存原样样式，
 *   React 只负责挂载、启动 WebGL 背景、按可见性开关四段演示动画。
 *
 * ⚠️ 待办（版权）：可见文案、DeepSeek 商标/logo、产品截图（feat-*.webp、二维码）
 *   仍属原站，上线前必须替换为自有内容。替换范围 = content.html + base.css 的图片。
 * ============================================================ */

/* 四段「假直播」演示：原页用 IntersectionObserver 控制 running，
 * 让不可见的动画暂停（它们的 play-state 默认是 paused）。 */
const DEMO_FIGURES = 'figure[class*="Preview_frame"]';

export default function DzhzPage() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    // Hero 的 WebGL 流体背景：原页把着色器内联在 JS 里，这里逐字移植。
    const stopBackground = initHeroBackground(root.querySelector('canvas'));
    // 顶部栏滚动过渡：收窄成毛玻璃胶囊，语言切换换成 GitHub + 下载。
    const stopHeader = initHeaderScroll(root);
    // Hero 的滚动视差：预览窗口后仰 + 背景模糊。
    const stopHeroScroll = initHeroScroll(root);
    // 开发者体验区的两条命令补上复制行为。

    const observers = [];
    root.querySelectorAll(DEMO_FIGURES).forEach((figure) => {
      // data-ready 决定插件/轨迹预览显示 CSS 动画还是 webp 静帧；
      // data-running 决定关键帧跑不跑。两者分开，避免离屏的预览一直吃 CPU。
      figure.dataset.ready = 'true';
      const observer = new IntersectionObserver(
        ([entry]) => {
          figure.dataset.running = entry.isIntersecting ? 'true' : 'false';
        },
        { threshold: 0.001 }
      );
      observer.observe(figure);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
      stopHeroScroll();
      stopHeader();
      stopBackground();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="dzhz-page"
      // 构建期固定的复刻 HTML，不含任何用户输入。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
