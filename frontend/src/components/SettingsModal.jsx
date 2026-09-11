import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown, CircleUserRound, Monitor, Moon, Palette, Search, Sun, X } from 'lucide-react';
import { loadLlmCfg, saveLlmCfg, clearLlmCfg } from '../llmConfig.js';
import { useAuth } from '../auth.jsx';
import useTheme from '../hooks/useTheme.js';
import useLocale from '../hooks/useLocale.js';
import { useClickOutside } from '../hooks/useClickOutside.js';
import './SettingsModal.css';

// 配置来源由「存储里是否已有一份三项齐全的配置」推导：ChatComposer 也只在三项
// 齐全时才下发用户配置（否则回落到服务端），两边口径必须一致。
const EMPTY_CFG = { apiKey: '', baseUrl: '', model: '' };
const modeOf = (cfg) => (cfg.apiKey && cfg.baseUrl && cfg.model ? 'custom' : 'server');

// 账户信息当前 user 对象里可展示的字段（后端 JWT 仅含 id/username/role）。
function AccountInfo({ t }) {
  const { user } = useAuth();
  if (!user) {
    return (
      <div className="settings-empty">
        <CircleUserRound size={26} strokeWidth={1.4} aria-hidden="true" />
        <p className="settings-empty-title">{t('settings.account.notLogin')}</p>
        <p className="settings-empty-sub">{t('settings.account.notLoginSub')}</p>
      </div>
    );
  }
  const role = user.role === 'admin' ? t('app.account.admin') : t('app.account.normalUser');
  return (
    <dl className="settings-rows">
      <div className="settings-row">
        <dt>{t('settings.account.username')}</dt>
        <dd>{user.username}</dd>
      </div>
      <div className="settings-row">
        <dt>{t('settings.account.role')}</dt>
        <dd>{role}</dd>
      </div>
      <div className="settings-row">
        <dt>{t('settings.account.id')}</dt>
        <dd>{user.id}</dd>
      </div>
    </dl>
  );
}

export default function SettingsModal({ open, onClose }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const [section, setSection] = useState('ai');
  const [langOpen, setLangOpen] = useState(false);
  // 语言下拉：点击「行 + 菜单」以外任意处收起（含弹窗内空白）。ref 挂在整个
  // .settings-lang 容器上，故点击触发按钮本身仍走它自己的切换逻辑，不会被重复收起。
  const langRef = useRef(null);
  useClickOutside(langOpen, () => setLangOpen(false), langRef);
  // 智能对话配置草稿与已提交值分离：保存前不覆盖已生效配置。
  const [llmCfg, setLlmCfg] = useState(loadLlmCfg);
  const [cfgDraft, setCfgDraft] = useState(loadLlmCfg);
  const [cfgMode, setCfgMode] = useState(() => modeOf(loadLlmCfg()));
  const [query, setQuery] = useState('');

  // 语言响应式的常量数组（切换语言时随 t 刷新）。
  const themeOptions = useMemo(
    () => [
      { id: 'light', label: t('settings.appearance.light'), icon: Sun },
      { id: 'system', label: t('settings.appearance.system'), icon: Monitor },
      { id: 'dark', label: t('settings.appearance.dark'), icon: Moon },
    ],
    [t]
  );

  const navItems = useMemo(
    () => [
      { id: 'ai', label: t('settings.nav.ai'), icon: Bot },
      { id: 'account', label: t('settings.nav.account'), icon: CircleUserRound },
      { id: 'appearance', label: t('settings.nav.appearance'), icon: Palette },
    ],
    [t]
  );

  // 语言下拉选项：母语名展示、不随界面语言翻译。
  const langOptions = useMemo(
    () => [
      { value: 'zh', label: t('settings.langOptions.zh') },
      { value: 'en', label: t('settings.langOptions.en') },
    ],
    [t]
  );

  const llmFields = useMemo(
    () => [
      { key: 'apiKey', label: t('settings.ai.apiKey'), placeholder: 'sk-…', type: 'password' },
      { key: 'baseUrl', label: t('settings.ai.baseUrl'), placeholder: 'https://open.bigmodel.cn/api/paas/v4', type: 'text' },
      { key: 'model', label: t('settings.ai.model'), placeholder: 'glm-4.6 / deepseek-chat …', type: 'text' },
    ],
    [t]
  );

  // 每次打开时，将已提交配置载入草稿、重置到首个板块、清空搜索、收起语言下拉。
  useEffect(() => {
    if (open) {
      setLlmCfg(loadLlmCfg());
      setCfgDraft(loadLlmCfg());
      setCfgMode(modeOf(loadLlmCfg()));
      setQuery('');
      setLangOpen(false);
    }
  }, [open]);

  // 打开时锁定页面滚动，配合遮罩阻断背景操作。
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const saveAi = () => {
    // 选「使用服务器配置」= 主动放弃自带配置：清掉存储，聊天侧随即回落到服务端。
    if (cfgMode === 'server') {
      setLlmCfg(EMPTY_CFG);
      clearLlmCfg();
      return;
    }
    setLlmCfg(saveLlmCfg(cfgDraft));
  };

  const clearAi = () => {
    setCfgMode('server');
    setLlmCfg(EMPTY_CFG);
    setCfgDraft(EMPTY_CFG);
    clearLlmCfg();
  };

  const currentLabel = navItems.find((n) => n.id === section)?.label ?? '';

  return createPortal(
    <div
      className="settings-backdrop rb-frost-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      onClick={onClose}
    >
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="settings-layout">
          {/* 左栏：关闭 / 搜索 / 垂直导航 */}
          <aside className="settings-sidebar">
            <div className="settings-sidebar-top">
              <button type="button" className="settings-close" aria-label={t('settings.close')} title={t('settings.close')} onClick={onClose}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            <div className="settings-search">
              <Search size={15} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                className="settings-search-input"
              />
            </div>
            <nav className="settings-nav" aria-label={t('settings.navAria')}>
              {navItems.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item ${section === id ? 'settings-nav-item--active' : ''}`}
                  onClick={() => setSection(id)}
                >
                  <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* 右栏：标题 + 内容 */}
          <div className="settings-content">
            <h2 className="settings-content-title">{currentLabel}</h2>
            <div className="settings-content-body">
              {section === 'ai' && (
                <div className="settings-section">
                  {/* 配置来源：二选一。选「服务器配置」时整块隐藏，避免看起来像已生效的输入。 */}
                  <div className="settings-modes" role="radiogroup" aria-label={t('settings.ai.modeAria')}>
                    {[
                      { id: 'server', label: t('settings.ai.modeServer') },
                      { id: 'custom', label: t('settings.ai.modeCustom') },
                    ].map(({ id, label }) => (
                      <label key={id} className={`settings-mode ${cfgMode === id ? 'settings-mode--active' : ''}`}>
                        <input
                          type="radio"
                          name="llm-cfg-mode"
                          className="settings-mode-input"
                          value={id}
                          checked={cfgMode === id}
                          onChange={() => setCfgMode(id)}
                        />
                        <span className="settings-mode-label">{label}</span>
                      </label>
                    ))}
                  </div>

                  {cfgMode === 'custom' && (
                    /* 字段放在浅底色块里：站点用色块 + 留白分隔，不靠描边（DESIGN.md §2 无界理念） */
                    <div className="settings-form">
                      {llmFields.map(({ key, label, placeholder, type }) => (
                        <label key={key} className="settings-field">
                          <span className="settings-field-label">{label}</span>
                          <input
                            type={type}
                            value={cfgDraft[key]}
                            onChange={(e) => setCfgDraft((d) => ({ ...d, [key]: e.target.value }))}
                            placeholder={placeholder}
                            className="settings-input"
                            spellCheck={false}
                            autoComplete={key === 'apiKey' ? 'off' : undefined}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="settings-hint">
                    {t(cfgMode === 'custom' ? 'settings.ai.hint' : 'settings.ai.hintServer')}
                  </p>
                </div>
              )}

              {section === 'account' && (
                <div className="settings-section">
                  <AccountInfo t={t} />
                </div>
              )}

              {section === 'appearance' && (
                <div className="settings-section">
                  <div className="settings-appearance">
                    <p className="settings-group-title">{t('settings.appearance.themeTitle')}</p>
                    <div className="settings-theme-cards">
                      {themeOptions.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          className={`settings-theme-card ${theme === id ? 'settings-theme-card--active' : ''}`}
                          onClick={() => setTheme(id)}
                        >
                          <span className={`settings-theme-swatch settings-theme-swatch--${id}`} aria-hidden="true">
                            <span className="settings-theme-swatch-brand">{t('settings.appearance.brand')}</span>
                          </span>
                          <span className="settings-theme-card-label">
                            <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                            <span>{label}</span>
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="settings-group-title settings-lang-group-title">{t('settings.appearance.langGroupTitle')}</div>
                    <div className="settings-lang" ref={langRef}>
                      <button
                        type="button"
                        className="settings-lang-row"
                        aria-expanded={langOpen}
                        onClick={() => setLangOpen((v) => !v)}
                      >
                        <span className="settings-lang-label">{t('settings.language')}</span>
                        <span className="settings-lang-value">
                          {langOptions.find((o) => o.value === locale)?.label}
                          <ChevronDown
                            size={16}
                            strokeWidth={1.8}
                            aria-hidden="true"
                            style={{ transform: langOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}
                          />
                        </span>
                      </button>
                      {langOpen && (
                        <div className="settings-lang-menu" role="listbox" aria-label={t('settings.appearance.selectLang')}>
                          {langOptions.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              role="option"
                              aria-selected={locale === o.value}
                              className={`settings-lang-option ${locale === o.value ? 'settings-lang-option--selected' : ''}`}
                              onClick={() => {
                                setLocale(o.value);
                                setLangOpen(false);
                              }}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* 按钮复用站点 CTA：深色 rb-btn-dark / 次级 rb-btn-ghost（与浏览页工具栏同款）。
                放在滚动区之外，固定在右栏右下角。 */}
            {section === 'ai' && (
              <div className="settings-actions">
                <button type="button" onClick={clearAi} className="rb-btn-ghost h-[34px] px-3 text-sm">
                  {t('settings.ai.restore')}
                </button>
                <button type="button" onClick={saveAi} className="rb-btn-dark h-[34px] px-4 text-sm">
                  {t('settings.ai.save')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
