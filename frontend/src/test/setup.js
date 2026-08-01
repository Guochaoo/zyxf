import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver; several components (nav indicator, glass
// surfaces) instantiate one during effects.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;

// Unmount renders between tests (RTL only auto-registers this with globals).
afterEach(() => cleanup());
