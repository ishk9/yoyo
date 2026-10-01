import type { Capture, SnapshotRecord } from './snapshot'

const LABELS_KEY = 'yoyo:labels'
let dbp: Promise<IDBDatabase> | undefined

function db() {
  if (!dbp) {
    const req = indexedDB.open('yoyo', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('snaps', { keyPath: 'id' }).createIndex('route', 'route')
    dbp = done(req)
  }
  return dbp
}

function done<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode: IDBTransactionMode) {
  return (await db()).transaction('snaps', mode).objectStore('snaps')
}

/** Newest first. */
export async function list(route: string): Promise<SnapshotRecord[]> {
  const all = await done((await tx('readonly')).index('route').getAll(route))
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

/** Saves, labels A, B, C… (never reused per route), evicts oldest beyond max. */
export async function save(cap: Capture, max = 10): Promise<SnapshotRecord> {
  const rec: SnapshotRecord = { ...cap, id: crypto.randomUUID(), label: nextLabel(cap.route) }
  const store = await tx('readwrite')
  await done(store.put(rec))
  const all = await done(store.index('route').getAll(cap.route))
  all.sort((a, b) => a.createdAt - b.createdAt)
  await Promise.all(all.slice(0, Math.max(0, all.length - max)).map((r) => done(store.delete(r.id))))
  return rec
}

export async function remove(id: string) {
  await done((await tx('readwrite')).delete(id))
}

export async function rename(id: string, label: string) {
  const store = await tx('readwrite')
  const rec = await done(store.get(id))
  if (rec) await done(store.put({ ...rec, label }))
}

// Counter per route lives in localStorage so deleting B never hands B out again.
function nextLabel(route: string) {
  const counts = JSON.parse(localStorage.getItem(LABELS_KEY) || '{}')
  const n: number = counts[route] ?? 0
  counts[route] = n + 1
  localStorage.setItem(LABELS_KEY, JSON.stringify(counts))
  let label = ''
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) label = String.fromCharCode(65 + (i % 26)) + label
  return label
}
