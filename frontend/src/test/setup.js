import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
// 初始化 i18next，让测试组件里的 useTranslation 不再抛 NO_I18NEXT_INSTANCE。
// 测试默认使用 zh 语言（与字典默认一致），断言的可见文案即为中文。
import i18n from '../i18n/index.js';

// jsdom has no ResizeObserver; several components (nav indicator,
// GlideList/Silk/Dashboard) instantiate one during effects.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;

// jsdom has no matchMedia; liveline reads it during mount effects.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Ensure english locale is reset to zh between tests (components may switch it).
beforeEach(() => {
  if (i18n.language !== 'zh') i18n.changeLanguage('zh');
});

// Unmount renders between tests (RTL only auto-registers this with globals).
afterEach(() => cleanup());
