import OfficeViewer from './OfficeViewer.jsx';
import PreviewUnavailable from './PreviewUnavailable.jsx';
import UnknownViewer from './UnknownViewer.jsx';

/**
 * PreviewBody — routes to the correct viewer. Only two preview layers:
 *   1. WebOffice (IMM GenerateWebofficeToken + JS-SDK) for previewable types;
 *   2. "预览服务出错" hint + download button when the preview service fails.
 * Types that never preview (archives, unknown) keep the plain download prompt.
 */
export default function PreviewBody({ kind, signedUrl, wbToken, fileId, name, onDownload }) {
  // Layer 1 — WebOffice interactive preview.
  if (kind === 'office' && wbToken?.url && wbToken?.token) {
    return <OfficeViewer wbToken={wbToken} fileId={fileId} name={name} />;
  }

  // Layer 2 — preview service unavailable: tell the user, offer download.
  if (kind === 'office') {
    return <PreviewUnavailable onDownload={onDownload} />;
  }

  // Never-previewable types (archives etc.) — plain download prompt.
  return <UnknownViewer onDownload={onDownload} />;
}
