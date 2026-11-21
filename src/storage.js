// Saved-data wrapper (every access may throw in private modes) and best-time records.
// Saves go through the platform storage facade: localStorage on the web, the portal's save API elsewhere.
import { storage } from './platform/index.js';
export const store = {
  get(k, d) { try { const v = storage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { storage.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
};

// best record per stage id (the daily stage uses its dated id): { t: seconds, s: [split1, split2] }
export const bestKey = (id) => `dustline.best.${id}`;
export function getBest(id) { const b = store.get(bestKey(id), null); return b && typeof b.t === 'number' ? b : null; }
export function setBest(id, rec) { store.set(bestKey(id), rec); }
