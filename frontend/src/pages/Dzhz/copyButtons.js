/*
 * /dzhz 的「复制」按钮 —— 原页由 React 绑定，这里给静态 DOM 补上同样的行为。
 * 只处理「代码块 + 复制按钮」这一种结构（开发者体验区的两条命令）。
 */

const RESET_MS = 1500;

export default function initCopyButtons(root) {
  const handlers = [];
  root.querySelectorAll('code + button').forEach((button) => {
    const code = button.previousElementSibling;
    if (!code) return;
    const onClick = async () => {
      const text = code.textContent.replace(/^\$\s*/, '');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      const original = button.textContent;
      button.textContent = button.dataset.copiedLabel || original;
      setTimeout(() => {
        button.textContent = original;
      }, RESET_MS);
    };
    button.addEventListener('click', onClick);
    handlers.push([button, onClick]);
  });

  return () => {
    handlers.forEach(([button, onClick]) => button.removeEventListener('click', onClick));
  };
}
