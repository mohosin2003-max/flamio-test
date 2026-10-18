/**
 * Offline attendance queue. An action is NEVER shown as confirmed until the
 * server acknowledges it. Server timestamps remain authoritative: the queue
 * only stores *intent* (with a local "requestedAt" kept for display), and the
 * server records its own time when the action finally syncs.
 *
 * Storage is pluggable: IndexedDB in the browser, in-memory for tests.
 */

export type QueueState = "pending" | "syncing" | "confirmed" | "failed";
export type QueueKind = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface QueuedAction {
  id: string; // idempotency key
  kind: QueueKind;
  requestedAt: string; // device time, display only
  state: QueueState;
  attempts: number;
  error?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}

export interface QueueStorage {
  all(): Promise<QueuedAction[]>;
  put(item: QueuedAction): Promise<void>;
  remove(id: string): Promise<void>;
}

export const MAX_ATTEMPTS = 3;

export function memoryStorage(): QueueStorage {
  const map = new Map<string, QueuedAction>();
  return {
    all: async () => [...map.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    put: async (item) => { map.set(item.id, { ...item }); },
    remove: async (id) => { map.delete(id); },
  };
}

/** Errors that will never succeed on retry (validation / conflict). */
export function isPermanentError(message: string): boolean {
  return /already|no open|not found|outside|geofence|qr|expired|disabled|only staff|invalid|end your active break|clock in before/i.test(message);
}

export async function enqueue(storage: QueueStorage, kind: QueueKind, id: string, now: Date, payload?: Record<string, unknown>) {
  const items = await storage.all();
  // Conflict guard: never queue the same kind twice while one is unresolved.
  if (items.some((i) => i.kind === kind && (i.state === "pending" || i.state === "syncing"))) {
    throw new Error("This action is already waiting to sync.");
  }
  // QR tokens expire in 60 s, so QR-verified punches cannot be queued.
  if (payload && "qrToken" in payload) throw new Error("QR clock-in needs a live connection.");
  const item: QueuedAction = { id, kind, requestedAt: now.toISOString(), state: "pending", attempts: 0, payload };
  await storage.put(item);
  return item;
}

/**
 * Sends pending actions in order. Stops at the first transient failure so a
 * later action (e.g. clock-out) never overtakes an earlier one (clock-in).
 */
export async function flush(storage: QueueStorage, send: (item: QueuedAction) => Promise<void>) {
  for (const item of await storage.all()) {
    if (item.state === "confirmed" || item.state === "failed") continue;
    await storage.put({ ...item, state: "syncing" });
    try {
      await send(item);
      await storage.put({ ...item, state: "confirmed", attempts: item.attempts + 1, error: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      const attempts = item.attempts + 1;
      const permanent = isPermanentError(message) || attempts >= MAX_ATTEMPTS;
      await storage.put({ ...item, state: permanent ? "failed" : "pending", attempts, error: message });
      if (!permanent) return;
    }
  }
}

/* ----------------------------- IndexedDB -------------------------------- */

export function indexedDbStorage(dbName = "flamio-attendance", store = "queue"): QueueStorage {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    all: async () => ((await run("readonly", (s) => s.getAll())) as QueuedAction[]).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    put: async (item) => { await run("readwrite", (s) => s.put(item)); },
    remove: async (id) => { await run("readwrite", (s) => s.delete(id)); },
  };
}

/* ------------------------- Error classification ------------------------- */

/** Auth / permission failures: never retried, never queued. */
export function isAuthError(message: string): boolean {
  return /unauthori[sz]ed|forbidden|permission|not allowed|sign in|jwt|session expired|only the owner/i.test(message);
}

/**
 * True only for genuine connectivity failures (request never reached the
 * server). Server-side validation or auth errors are NOT transient.
 */
export function isTransientNetworkError(err: unknown, online = true): boolean {
  if (!online) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (isAuthError(message) || isPermanentError(message)) return false;
  return /failed to fetch|networkerror|network request failed|load failed|network error|err_internet_disconnected|timed? ?out|econnreset|offline/i.test(message);
}

/** Drop confirmed items so the queue only shows outstanding work. */
export async function clearConfirmed(storage: QueueStorage) {
  for (const item of await storage.all()) if (item.state === "confirmed") await storage.remove(item.id);
}

/** Retry a failed item manually (resets attempts, keeps original order). */
export async function retryFailed(storage: QueueStorage, id: string) {
  const item = (await storage.all()).find((i) => i.id === id);
  if (item && item.state === "failed") await storage.put({ ...item, state: "pending", attempts: 0, error: undefined });
}

/**
 * Browser storage: IndexedDB when available (survives reloads), else an
 * in-memory queue that is LOST on reload — callers must disclose this.
 */
export async function browserQueueStorage(): Promise<{ storage: QueueStorage; persistent: boolean }> {
  if (typeof indexedDB === "undefined") return { storage: memoryStorage(), persistent: false };
  const storage = indexedDbStorage();
  try { await storage.all(); return { storage, persistent: true }; }
  catch { return { storage: memoryStorage(), persistent: false }; }
}
