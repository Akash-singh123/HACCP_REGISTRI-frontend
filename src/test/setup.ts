import '@testing-library/jest-dom/vitest';
// IndexedDB non esiste in jsdom: la coda offline va testata con un polyfill.
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
