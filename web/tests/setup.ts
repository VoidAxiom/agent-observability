// Vitest global setup. jsdom env provides window/document, but Node 26's
// experimental localStorage warning means jsdom may not wire window.localStorage
// reliably. Install a minimal in-memory shim if missing so theme tests can run.

function installLocalStorageShim(): void {
  if (typeof window === "undefined") return;
  if (window.localStorage && typeof window.localStorage.setItem === "function") {
    return;
  }
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
}

installLocalStorageShim();

export {};
