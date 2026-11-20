// localStorage wrapper (every access may throw in private modes) and best-time records.
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
};

// best record per stage id (the daily stage uses its dated id): { t: seconds, s: [split1, split2] }
export const bestKey = (id) => `dustline.best.${id}`;
export function getBest(id) { const b = store.get(bestKey(id), null); return b && typeof b.t === 'number' ? b : null; }
export function setBest(id, rec) { store.set(bestKey(id), rec); }
