import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { LOCALE_KEY, syncHtmlLang } from '../i18n/index.js';
import { storageSet } from '../ui.js';

/**
 * 界面语言状态管理（简体中文 / English）。
 *
 * - locale：当前语言，取值 'zh' | 'en'（持久化到 localStorage `zyxf_lang`）。
 * - setLocale：切换语言，调用 i18n.changeLanguage + 持久化 + 同步 <html lang> 与 document.title。
 */
export default function useLocale() {
  const { i18n: i18nInstance, t } = useTranslation();
  const [locale, setLocaleState] = useState(i18nInstance.language === 'en' ? 'en' : 'zh');

  const setLocale = useCallback((value) => {
    if (value === 'zh') {
      i18n.changeLanguage('zh');
      storageSet(LOCALE_KEY, 'zh');
      syncHtmlLang('zh');
      setLocaleState('zh');
    } else if (value === 'en') {
      i18n.changeLanguage('en');
      storageSet(LOCALE_KEY, 'en');
      syncHtmlLang('en');
      setLocaleState('en');
    }
  }, []);

  // document.title 随语言联动（App.jsx 的 title 也调用 t() 保持同步）。
  const title = useMemo(() => t('app.title'), [t]);

  return { locale, setLocale, title };
}
