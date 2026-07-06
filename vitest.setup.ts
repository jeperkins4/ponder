import "@testing-library/jest-dom";
import "dotenv/config";

// SAFETY GUARD: several test files run destructive setup (blanket deleteMany
// on Project/Story/WorkUnit), so tests must only ever touch a test database.
// `npm test` guarantees that via `dotenv -e .env.test`, but a bare
// `npx vitest run` skips the wrapper: dotenv/config then falls back to .env
// and the DEV database — which is exactly how the dev data was wiped on
// 2026-07-05. Refuse to run unless DATABASE_URL points at a *_test database.
// (dotenv/config never overrides an already-set DATABASE_URL, so the
// npm-script wrapper still wins when present.)
if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL does not look like a test database " +
      `(expected it to contain "_test", got: ${process.env.DATABASE_URL ?? "unset"}). ` +
      "Run tests via `npm test` / `npm run test:ci`, which load .env.test — " +
      "never bare `npx vitest`."
  );
}

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
