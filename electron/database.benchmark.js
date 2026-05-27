import { getDatabase, saveAppState } from "./database.js";
import { performance } from "node:perf_hooks";

const BENCHMARK_STATE_KEY = "__benchmark__";

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[index];
}

function summarize(label, values) {
  return {
    label,
    count: values.length,
    minMs: Math.min(...values).toFixed(3),
    p50Ms: percentile(values, 50).toFixed(3),
    p95Ms: percentile(values, 95).toFixed(3),
    maxMs: Math.max(...values).toFixed(3),
  };
}

function makeFakeState(entryCount) {
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: i + 1,
    dateAdded: "2026-05-25",
    firstName: `First${i}`,
    lastName: `Last${i}`,
    provider: `Provider ${i % 10}`,
    tier: (i % 3) + 1,
    reason: "Testing query/storage speed with a realistic reason field.",
    availableDays: ["M", "W", "F"],
    availableTimes: ["8:00 AM-10:00 AM", "1:00 PM-3:00 PM"],
    status: "WAITLISTED",
  }));

  const openings = Array.from(
    { length: Math.floor(entryCount / 2) },
    (_, i) => ({
      id: i + 1,
      provider: `Provider ${i % 10}`,
      date: "2026-05-25",
      startTime: "09:00",
      endTime: "10:00",
    }),
  );

  return {
    version: CURRENT_VERSION,
    providers: Array.from({ length: 10 }, (_, i) => ({
      name: `Provider ${i}`,
      color: "#999999",
    })),
    entries,
    openings,
    scheduledRecords: [],
    removedRecords: [],
  };
}

function timeOperation(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function getAppStateRowByKey(database, key) {
  return database.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
}

function writeBenchmarkStateTransaction(database, state) {
  const normalized = normalizeAppState(state);

  if (!normalized) {
    throw new TypeError("Invalid benchmark app state.");
  }

  const value = JSON.stringify(normalized);

  database.exec("BEGIN IMMEDIATE TRANSACTION;");

  try {
    database
      .prepare(
        `
        INSERT INTO app_state (key, value, updated_at)
        VALUES (?, json(?), CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = json(excluded.value),
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(BENCHMARK_STATE_KEY, value);

    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback failure and throw the original error.
    }

    throw error;
  }

  return normalized;
}

function readBenchmarkState(database) {
  const row = getAppStateRowByKey(database, BENCHMARK_STATE_KEY);

  if (!row?.value) return null;

  return normalizeAppState(JSON.parse(row.value));
}

function restoreBenchmarkRow(database, previousBenchmarkRow) {
  database.exec("BEGIN IMMEDIATE TRANSACTION;");

  try {
    if (previousBenchmarkRow?.value) {
      database
        .prepare(
          `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (?, json(?), CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET
            value = json(excluded.value),
            updated_at = CURRENT_TIMESTAMP
        `,
        )
        .run(BENCHMARK_STATE_KEY, previousBenchmarkRow.value);
    } else {
      database
        .prepare("DELETE FROM app_state WHERE key = ?")
        .run(BENCHMARK_STATE_KEY);
    }

    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback failure and throw the original error.
    }

    throw error;
  }
}

export function benchmarkAppStateStorage() {
  const database = getDatabase();
  const previousBenchmarkRow = getAppStateRowByKey(
    database,
    BENCHMARK_STATE_KEY,
  );

  const sizes = [100, 500, 1000, 2500, 5000, 10000];
  const results = [];

  try {
    for (const size of sizes) {
      const state = makeFakeState(size);
      const jsonSizeKb =
        Buffer.byteLength(JSON.stringify(state), "utf8") / 1024;

      const writeTimes = [];
      const readTimes = [];

      // Warm up prepared statements, JSON parser, and SQLite page cache.
      writeBenchmarkStateTransaction(database, state);
      readBenchmarkState(database);

      for (let i = 0; i < 20; i++) {
        const nextState = {
          ...state,
          entries: state.entries.map((entry, index) =>
            index === 0 ? { ...entry, reason: `Changed ${i}` } : entry,
          ),
        };

        writeTimes.push(
          timeOperation(() =>
            writeBenchmarkStateTransaction(database, nextState),
          ),
        );
      }

      for (let i = 0; i < 100; i++) {
        readTimes.push(timeOperation(() => readBenchmarkState(database)));
      }

      results.push({
        entryCount: size,
        jsonSizeKb: jsonSizeKb.toFixed(1),
        write: summarize("benchmark write", writeTimes),
        read: summarize("benchmark read", readTimes),
      });
    }
  } finally {
    restoreBenchmarkRow(database, previousBenchmarkRow);
  }

  console.table(
    results.flatMap((row) => [
      {
        entries: row.entryCount,
        jsonKb: row.jsonSizeKb,
        op: "read benchmark row",
        p50Ms: row.read.p50Ms,
        p95Ms: row.read.p95Ms,
        maxMs: row.read.maxMs,
      },
      {
        entries: row.entryCount,
        jsonKb: row.jsonSizeKb,
        op: "write benchmark row",
        p50Ms: row.write.p50Ms,
        p95Ms: row.write.p95Ms,
        maxMs: row.write.maxMs,
      },
    ]),
  );

  return results;
}

export function benchmarkRawCurrentRowQuery() {
  const database = getDatabase();
  const query = database.prepare("SELECT value FROM app_state WHERE key = ?");
  const times = [];

  for (let i = 0; i < 1000; i++) {
    times.push(
      timeOperation(() => {
        query.get(APP_STATE_KEY);
      }),
    );
  }

  const summary = summarize("raw SELECT app_state", times);

  console.table([summary]);

  return summary;
}

export function benchmarkRealChangedSaveWithBackup() {
  const currentState = readStoredAppState();

  if (!currentState) {
    console.log("No real app state found to benchmark.");
    return null;
  }

  const originalState = currentState;
  const jsonSizeKb =
    Buffer.byteLength(JSON.stringify(originalState), "utf8") / 1024;

  const times = [];

  try {
    for (let i = 0; i < 20; i++) {
      const testState = {
        ...originalState,
        removedRecords: [
          ...originalState.removedRecords,
          {
            id: -1000000 - i,
            dateRemoved: new Date().toISOString(),
            firstName: "Benchmark",
            lastName: "Record",
            provider: "Benchmark",
            tier: 1,
            reason: `Temporary benchmark save ${i}`,
            availableDays: [],
            availableTimes: [],
            status: "REMOVED",
          },
        ],
      };

      times.push(
        timeOperation(() => {
          saveAppState(testState);
        }),
      );
    }
  } finally {
    saveAppState(originalState);
  }

  const summary = {
    jsonSizeKb: jsonSizeKb.toFixed(1),
    ...summarize("real changed saveAppState with backup", times),
  };

  console.table([summary]);

  return summary;
}
