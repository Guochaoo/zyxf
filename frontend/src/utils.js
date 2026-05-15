export function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
const OFFICE_EXT = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'];

// Download a file as Blob and trigger a save dialog with the original filename.
// Works around OSS's force-download header on un-filed domains by going through
// fetch + Blob URL, which lets us set the filename via <a download>.
export async function downloadFileById(file, getFileUrl) {
  const meta = await getFileUrl(file.id);
  const resp = await fetch(meta.url);
  if (!resp.ok) throw new Error(`下载失败 (${resp.status})`);
  const blob = await resp.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function getPreviewKind(ext) {
  ext = (ext || '').toLowerCase().replace(/^\./, '');
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (OFFICE_EXT.includes(ext)) return 'office';
  if (['txt', 'md', 'json', 'csv', 'log'].includes(ext)) return 'text';
  return 'unknown';
}
