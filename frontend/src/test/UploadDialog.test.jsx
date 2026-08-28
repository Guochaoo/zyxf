import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the api so we can simulate upload progress and drive the buggy code path.
// uploadFile is a controllable mock: its onProgress callback pushes updates.
const uploadFile = vi.fn();
const getFileUrl = vi.fn();

vi.mock('../api.js', () => {
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    default: api,
    TOKEN_KEY: 'zyxf_token',
    login: vi.fn(),
    uploadFile: (...args) => uploadFile(...args),
    getFileUrl: (...args) => getFileUrl(...args),
  };
});

const { default: UploadDialog } = await import('../components/UploadDialog.jsx');

function makeFile(name = 'a.pdf') {
  return new File(['x'.repeat(4)], name, { type: 'application/pdf' });
}

// Add a file to the queue by dispatching a change on the hidden file input.
function addFile(file) {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('UploadDialog BUG-01 (progress bar never moves)', () => {
  beforeEach(() => {
    uploadFile.mockReset();
  });

  test('progress reaches 100 after a completed upload', async () => {
    // Simulate the real uploader firing progress up to 100 then resolving.
    uploadFile.mockImplementation(async ({ onProgress }) => {
      onProgress?.(0);
      onProgress?.(50);
      onProgress?.(100);
    });

    const { container } = render(
      <UploadDialog folderId={1} onClose={() => {}} onDone={() => {}} />
    );
    addFile(makeFile());
    expect(screen.getByText('a.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));

    // BUG-01 regression: the first setFiles replaces the item object reference,
    // so the compare must use the stable item.file; otherwise progress stays 0.
    await waitFor(() => {
      const bar = container.querySelector('.h-full');
      expect(bar).toBeTruthy();
      expect(bar.style.width).toBe('100%');
    });
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  test('reflects an intermediate progress value rather than freezing at 0', async () => {
    // A pending (never-resolving) upload so the item stays in 'uploading' and
    // the bar shows whatever progress onProgress last reported.
    let resolveUpload;
    uploadFile.mockImplementation(async ({ onProgress }) => {
      onProgress?.(0);
      onProgress?.(50);
      await new Promise((r) => {
        resolveUpload = r;
      });
    });

    const { container } = render(
      <UploadDialog folderId={1} onClose={() => {}} onDone={() => {}} />
    );
    addFile(makeFile('b.pdf'));
    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));

    await waitFor(() => {
      const bar = container.querySelector('.h-full');
      expect(bar.style.width).toBe('50%');
    });

    resolveUpload();
  });
});

describe('UploadDialog BUG-17 (icon-only buttons)', () => {
  test('the close (X) button has an accessible name and type="button"', () => {
    render(<UploadDialog folderId={1} onClose={() => {}} onDone={() => {}} />);
    // Both the icon X button and the text "关闭" button carry the same name;
    // select the icon button (the one with an explicit aria-label + type="button").
    const iconBtn = screen
      .getAllByRole('button', { name: '关闭' })
      .find((b) => b.getAttribute('type') === 'button');
    expect(iconBtn).toBeTruthy();
    expect(iconBtn).toHaveAttribute('aria-label', '关闭');
  });
});
