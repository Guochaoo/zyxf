import axios from 'axios';
import { getToken, clearToken, TOKEN_KEY } from './ui.js';

export { TOKEN_KEY };

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Expired/invalid token: drop it so the user can log back in, and let the
    // AuthProvider clear the UI state.
    if (err.response?.status === 401 && getToken()) {
      clearToken();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(err);
  }
);

export default api;

// ---- helpers ----

/**
 * AI 聊天（SSE 流式）。axios 不支持流式响应，用原生 fetch 逐行解析。
 * 事件回调：onDelta（文本增量）、onFiles（引用的文件列表）。
 * llm 为可选的客户端配置 { apiKey, baseUrl, model }（前端设置面板，自带 Key）。
 * 用 AbortSignal 中止；非 2xx 抛 Error（message 为后端中文提示）。
 */
export async function chatStream(messages, { onDelta, onFiles, signal, llm } = {}) {
  const token = getToken();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, ...(llm ? { llm } : {}) }),
    signal,
  });

  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'delta') onDelta?.(event.text);
      else if (event.type === 'files') onFiles?.(event.files);
      else if (event.type === 'error') throw new Error(event.message || 'AI 服务出错');
    }
  }
}

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  return data;
}

// 注册发码：向邮箱发送 6 位验证码（服务端有 60s 冷却与频次限额）。
export async function requestRegisterCode(email) {
  const { data } = await api.post('/auth/register/code', { email });
  return data;
}

// 注册成功即自动登录：响应与 login 同构 { token, user }。
export async function register({ username, email, password, code }) {
  const { data } = await api.post('/auth/register', { username, email, password, code });
  return data;
}

export async function listFolder(id = 0, sort = 'name', order = 'asc') {
  const { data } = await api.get(`/folders/${id}/contents`, { params: { sort, order } });
  return data;
}

export async function getFolderTree() {
  const { data } = await api.get('/folders/tree');
  return data;
}

export async function createFolder(name, parent_id) {
  const { data } = await api.post('/folders', { name, parent_id });
  return data;
}

export async function deleteFolder(id) {
  const { data } = await api.delete(`/folders/${id}`);
  return data;
}

export async function deleteFile(id) {
  const { data } = await api.delete(`/files/${id}`);
  return data;
}

export async function moveFile(id, folderId) {
  const { data } = await api.patch(`/files/${id}`, { folder_id: folderId ?? null });
  return data;
}

export async function renameFile(id, name) {
  const { data } = await api.patch(`/files/${id}`, { name });
  return data;
}

export async function moveFolder(id, parentId) {
  const { data } = await api.patch(`/folders/${id}`, { parent_id: parentId ?? null });
  return data;
}

export async function renameFolder(id, name) {
  const { data } = await api.patch(`/folders/${id}`, { name });
  return data;
}

// order: [{type:'file'|'folder', id}, ...]
export async function reorderItems(parentFolderId, order) {
  const { data } = await api.post('/folders/reorder', {
    parent_folder_id: parentFolderId ?? null,
    order,
  });
  return data;
}

export async function getFileUrl(id, { download = false } = {}) {
  const { data } = await api.get(`/files/${id}/url`, { params: download ? { download: 1 } : {} });
  return data;
}

// WebOffice preview credentials (IMM GenerateWebofficeToken) for the official
// WebOffice JS-SDK. Works for browser-uploaded files, mobile WebViews included.
export async function getWebofficeToken(id) {
  const { data } = await api.get(`/files/${id}/weboffice-token`);
  return data;
}

// Rotate the WebOffice access token (30-min lifetime) using the refresh token
// (1-day lifetime). Called by the JS-SDK's refreshToken callback.
export async function refreshWebofficeToken(id, accessToken, refreshToken) {
  const { data } = await api.post(`/files/${id}/weboffice-refresh`, {
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return data;
}

export async function getStats(range = 30) {
  const { data } = await api.get('/stats', { params: { range } });
  return data;
}

// Trailing-year daily activity for the dashboard heatmap — independent of
// getStats' range switch.
export async function getHeatmap() {
  const { data } = await api.get('/stats/heatmap');
  return data;
}

// Sync the local library with the shared OSS bucket (multi-deployment support).
// Rate-limited server-side to 5/min per IP.
export async function syncOss() {
  const { data } = await api.post('/sync');
  return data;
}

export async function search(q) {
  const { data } = await api.get('/search', { params: { q } });
  return data;
}

// Direct-to-OSS upload using a presigned PostObject policy.
export async function uploadFile({ file, folderId, onProgress }) {
  const { data: policy } = await api.post('/files/upload-url', {
    filename: file.name,
    folder_id: folderId || null,
  });

  const form = new FormData();
  form.append('key', policy.key);
  form.append('policy', policy.policy);
  form.append('OSSAccessKeyId', policy.OSSAccessKeyId);
  form.append('success_action_status', policy.success_action_status);
  form.append('signature', policy.signature);
  form.append('file', file);

  await axios.post(policy.host, form, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });

  try {
    const { data } = await api.post('/files', {
      name: file.name,
      oss_key: policy.key,
      size: file.size,
      mime_type: file.type,
      folder_id: folderId || null,
    });
    return data;
  } catch (e) {
    // Attempt to clean up the orphaned OSS object so it doesn't waste storage.
    api.post('/files/cleanup-upload', { oss_key: policy.key }).catch(() => {});
    throw e;
  }
}
