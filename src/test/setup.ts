// Node has no localStorage; give the store's persistence an in-memory one.
const items = new Map<string, string>()
globalThis.localStorage ??= {
  get length() {
    return items.size
  },
  clear: () => items.clear(),
  getItem: (key) => items.get(key) ?? null,
  key: (i) => [...items.keys()][i] ?? null,
  removeItem: (key) => void items.delete(key),
  setItem: (key, value) => void items.set(key, String(value)),
}
