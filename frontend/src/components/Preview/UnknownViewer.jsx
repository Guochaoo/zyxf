/** Fallback for file types with no preview support (archives, etc.). */
export default function UnknownViewer({ signedUrl }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
      <div className="text-lg">📎</div>
      <div className="text-sm text-center">该文件类型暂不支持在线预览</div>
      {signedUrl && (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-brand-600 hover:underline"
        >
          下载文件
        </a>
      )}
    </div>
  );
}
