import "@testing-library/jest-dom";

// Vitest 1.x's jsdom environment only copies a window property onto the test
// global if that key is either absent from Node's own `global` or explicitly
// allow-listed. Node 22+ ships an experimental global `localStorage`
// (unusable without `--localstorage-file`, and always `undefined` here),
// which shadows jsdom's real, working `window.localStorage` and leaves it
// undefined in tests. Replace it with a small in-memory Storage polyfill so
// any code under test that reads/writes localStorage behaves as it would in
// a real browser.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
