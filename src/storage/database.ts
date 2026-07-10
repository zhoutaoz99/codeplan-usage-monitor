import type { QuotaSnapshot } from "../shared/schema";

const DATABASE_NAME = "codeplan-usage-history";
const VERSION = 2;
const RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const QUARTER_HOURLY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const HOURLY_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("rawSnapshots")) {
        const store = db.createObjectStore("rawSnapshots", { keyPath: "id" });
        store.createIndex("fetchedAt", "fetchedAt");
      }
      if (!db.objectStoreNames.contains("quarterHourlySnapshots")) db.createObjectStore("quarterHourlySnapshots", { keyPath: "id" });
      if (!db.objectStoreNames.contains("hourlySnapshots")) db.createObjectStore("hourlySnapshots", { keyPath: "id" });
      if (!db.objectStoreNames.contains("dailySnapshots")) db.createObjectStore("dailySnapshots", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地历史数据库"));
  });
}

function requestDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 写入失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 事务已中止"));
  });
}

function bucketId(snapshot: QuotaSnapshot, bucket: "quarterHour" | "hour" | "day"): string {
  const date = new Date(snapshot.fetchedAt);
  const key = bucket === "quarterHour"
    ? `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${date.getUTCHours()}-${Math.floor(date.getUTCMinutes() / 15)}`
    : bucket === "hour"
    ? `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${date.getUTCHours()}`
    : `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  return `${snapshot.provider}:${snapshot.quotaKey}:${key}`;
}

export async function saveHistory(snapshots: QuotaSnapshot[]): Promise<void> {
  if (!snapshots.length) return;
  const db = await openDatabase();
  const transaction = db.transaction(["rawSnapshots", "quarterHourlySnapshots", "hourlySnapshots", "dailySnapshots"], "readwrite");
  const raw = transaction.objectStore("rawSnapshots");
  const quarterHourly = transaction.objectStore("quarterHourlySnapshots");
  const hourly = transaction.objectStore("hourlySnapshots");
  const daily = transaction.objectStore("dailySnapshots");
  for (const snapshot of snapshots) {
    raw.put(snapshot);
    quarterHourly.put({ ...snapshot, id: bucketId(snapshot, "quarterHour") });
    hourly.put({ ...snapshot, id: bucketId(snapshot, "hour") });
    daily.put({ ...snapshot, id: bucketId(snapshot, "day") });
  }
  await requestDone(transaction);
  db.close();
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error("无法读取历史数据"));
  });
}

export async function getHistory(provider: string, quotaKey: string, days = 30): Promise<QuotaSnapshot[]> {
  const db = await openDatabase();
  const since = Date.now() - days * 24 * 60 * 60 * 1_000;
  const storeName = days <= 7 ? "rawSnapshots" : days <= 30 ? "quarterHourlySnapshots" : days <= 180 ? "hourlySnapshots" : "dailySnapshots";
  const transaction = db.transaction(storeName, "readonly");
  const rows = await getAll<QuotaSnapshot>(transaction.objectStore(storeName));
  db.close();
  return rows
    .filter((snapshot) => snapshot.provider === provider && snapshot.quotaKey === quotaKey && Date.parse(snapshot.fetchedAt) >= since)
    .sort((left, right) => Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt));
}

export async function pruneHistory(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["rawSnapshots", "quarterHourlySnapshots", "hourlySnapshots"], "readwrite");
  const index = transaction.objectStore("rawSnapshots").index("fetchedAt");
  const range = IDBKeyRange.upperBound(new Date(Date.now() - RAW_RETENTION_MS).toISOString(), true);
  const request = index.openCursor(range);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  for (const [storeName, retention] of [["quarterHourlySnapshots", QUARTER_HOURLY_RETENTION_MS], ["hourlySnapshots", HOURLY_RETENTION_MS]] as const) {
    const aggregateStore = transaction.objectStore(storeName);
    const aggregateRequest = aggregateStore.openCursor();
    aggregateRequest.onsuccess = () => {
      const cursor = aggregateRequest.result;
      if (!cursor) return;
      const snapshot = cursor.value as QuotaSnapshot;
      if (Date.parse(snapshot.fetchedAt) < Date.now() - retention) cursor.delete();
      cursor.continue();
    };
  }
  await requestDone(transaction);
  db.close();
}

export async function clearHistory(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["rawSnapshots", "quarterHourlySnapshots", "hourlySnapshots", "dailySnapshots"], "readwrite");
  transaction.objectStore("rawSnapshots").clear();
  transaction.objectStore("quarterHourlySnapshots").clear();
  transaction.objectStore("hourlySnapshots").clear();
  transaction.objectStore("dailySnapshots").clear();
  await requestDone(transaction);
  db.close();
}
