import axios from 'axios';

export const TOKEN_KEY = 'zyxf_token';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Expired/invalid token: drop it so the user can log back in, and let the
    // AuthProvider clear the UI state.
    if (err.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(err);
  }
);

export default api;

// ---- helpers ----

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
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

export async function getStats(range = 30) {
  const { data } = await api.get('/stats', { params: { range } });
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
