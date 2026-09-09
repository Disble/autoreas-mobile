import { drizzle } from "drizzle-orm/expo-sqlite";
import {
  clearBridgeConfig,
  withLocalWrite,
} from "../../src/infrastructure/db/client";
import { bridgeConfig } from "../../src/infrastructure/db/schema";
import * as nativeRuntime from "../../src/infrastructure/db/native-runtime/native-runtime.helpers";

/**
 * Split from `db.test.ts` (CLAUDE.md #5, the 500-line rule): this file owns the deferred
 * write-door behavior (`withLocalWrite`, `clearBridgeConfig`, write serialization); the sibling
 * file owns `openAppDatabaseSync` and every migration/legacy-repair scenario.
 */

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(
    (client: {
      __state?: {
        animes: Record<string, unknown>[];
        deletes?: unknown[];
      };
    }) => ({
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          client.__state?.animes.push(value);
        },
      }),
      delete: async (table: unknown) => {
        client.__state?.deletes?.push(table);
      },
      select: () => ({
        from: () => client.__state?.animes ?? [],
      }),
    }),
  ),
}));

jest.mock("../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
  getDrizzleFactory: jest.fn(),
  getDrizzleMigrator: jest.fn(),
  getOpenDatabaseSync: jest.fn(),
}));

describe("db client write-door helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("devuelve el resultado del callback diferido", async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
    };

    const result = await withLocalWrite(rawDb as never, async () => "ok");

    expect(result).toBe("ok");
    expect(rawDb.execAsync).toHaveBeenCalledWith("BEGIN IMMEDIATE");
    expect(rawDb.execAsync).toHaveBeenCalledWith("COMMIT");
  });

  it("clearBridgeConfig usa el write diferido y borra bridge_config sin runAsync directo", async () => {
    const rawDb = {
      __state: {
        animes: [] as Record<string, unknown>[],
        deletes: [] as unknown[],
      },
      runAsync: jest.fn(),
      execAsync: jest.fn().mockResolvedValue(undefined),
    };

    await clearBridgeConfig(rawDb as never);

    expect(rawDb.execAsync).toHaveBeenCalledWith("BEGIN IMMEDIATE");
    expect(rawDb.execAsync).toHaveBeenCalledWith("COMMIT");
    expect(rawDb.__state.deletes).toEqual([bridgeConfig]);
    expect(rawDb.runAsync).not.toHaveBeenCalled();
  });

  it("serializa writes diferidos concurrentes sobre la misma db", async () => {
    const executionOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const rawDb = {
      execAsync: jest.fn(async (sql: string) => {
        if (sql === "BEGIN IMMEDIATE") executionOrder.push("start");
        if (sql === "COMMIT") executionOrder.push("end");
      }),
    };

    const firstWrite = withLocalWrite(rawDb as never, async () => {
      executionOrder.push("task-1");
      await firstDone;
      executionOrder.push("task-1-done");
      return "first";
    });

    const secondWrite = withLocalWrite(rawDb as never, async () => {
      executionOrder.push("task-2");
      return "second";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executionOrder).toEqual(["start", "task-1"]);

    releaseFirst();

    await expect(firstWrite).resolves.toBe("first");
    await expect(secondWrite).resolves.toBe("second");
    expect(executionOrder).toEqual([
      "start",
      "task-1",
      "task-1-done",
      "end",
      "start",
      "task-2",
      "end",
    ]);
  });
});
