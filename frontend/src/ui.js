// 前端共享的全局工具：导航辅助、安全存储、通用 UI 常量。
// 仅供各组件 import，不承载业务状态。

// 认证 token 的 localStorage key —— 单一来源，避免 api.js 与 ui.js 互相 import。
export const TOKEN_KEY = 'zyxf_token';

/**
 * 打开文件的预览：跳转到文件所在文件夹并携带 previewFile state。
 * SearchBar / ChatComposer / KnowledgeGraph / FolderTree 共用（原四处重复）。
 */
export function openFilePreview(file, navigate) {
  const target = file.folder_id ? `/folder/${file.folder_id}` : '/';
  navigate(target, { state: { previewFile: file } });
}

// 文件夹链接目标（root → '/'）。DashboardPage / openFolderOrFile 共用。
export const folderTarget = (folderId) => (folderId ? `/folder/${folderId}` : '/');

// 打开文件夹或文件：文件夹直接进入，文件走预览跳转。
// SearchBar / ChatComposer 共用（KnowledgeGraph 的 root 特判保留自处）。
export function openFolderOrFile(item, navigate) {
  if (item.type === 'folder') {
    navigate(folderTarget(item.id));
  } else {
    openFilePreview(item, navigate);
  }
}

// ---- 安全 localStorage（隐私模式 / 被禁用的存储下不抛错）----
// 与 NoticeModal / ChatComposer 现有的 try/catch 行为保持一致。

export function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — ignore */
  }
}

// 微信/飞书等浏览器在禁用 storage 时访问 TOKEN_KEY 会抛 SecurityError；
// 统一走 storageGet 避免登录态读写中断整个应用。
export function getToken() {
  return storageGet(TOKEN_KEY);
}

export function setToken(token) {
  storageSet(TOKEN_KEY, token);
}

export function clearToken() {
  storageRemove(TOKEN_KEY);
}

// 界面主题的 localStorage key：light / dark / system（默认 system）。
export const THEME_KEY = 'zyxf_theme';

export function getTheme() {
  return storageGet(THEME_KEY);
}

export function setTheme(value) {
  storageSet(THEME_KEY, value);
}
