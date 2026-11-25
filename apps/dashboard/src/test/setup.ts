import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

const resizeHost = window as unknown as { ResizeObserver?: typeof ResizeObserver };
if (!resizeHost.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  resizeHost.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '';
});
