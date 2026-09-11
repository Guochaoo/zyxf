import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh.js';
import en from './en.js';
import { storageGet } from '../ui.js';

export const LOCALE_KEY = 'zyxf_lang';

// 初始语言：localStorage 优先，否则默认中文。
const initialLocale = (() => {
  const s = storageGet(LOCALE_KEY);
  return s === 'en' ? 'en' : 'zh';
})();

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: initialLocale,
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

// 同步 <html lang>，便于无障碍/翻译工具识别当前语言。
export function syncHtmlLang(locale) {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

export { i18n };
export default i18n;
