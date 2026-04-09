import { withExclusiveWrite } from "../../src/infrastructure/db/client";

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(
    (client: { __state?: { animes: Record<string, unknown>[] } }) => ({
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          client.__state?.animes.push(value);
        },
      }),
      select: () => ({
        from: () => client.__state?.animes ?? [],
      }),
    }),
  ),
}));

jest.mock("drizzle-orm/expo-sqlite/migrator", () => ({
  migrate: jest.fn(),
}));

jest.mock("../../src/infrastructure/db/migrations/migrations", () => ({
  __esModule: true,
  default: {
    journal: { entries: [] },
    migrations: {},
  },
}));

describe("db client tracer helpers", () => {
  it("devuelve el resultado del callback exclusivo", async () => {
    const rawDb = {
      __state: { animes: [] as Record<string, unknown>[] },
      withExclusiveTransactionAsync: jest.fn(
        async (task: (tx: unknown) => Promise<void>) => {
          await task(rawDb);
        },
      ),
    };

    const result = await withExclusiveWrite(rawDb as never, async () => "ok");

    expect(result).toBe("ok");
    expect(rawDb.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("serializa writes concurrentes sobre la misma db", async () => {
    const executionOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const rawDb = {
      withExclusiveTransactionAsync: jest.fn(
        async (task: (tx: unknown) => Promise<void>) => {
          executionOrder.push("start");
          await task(rawDb);
          executionOrder.push("end");
        },
      ),
    };

    const firstWrite = withExclusiveWrite(rawDb as never, async () => {
      executionOrder.push("task-1");
      await firstDone;
      executionOrder.push("task-1-done");
      return "first";
    });

    const secondWrite = withExclusiveWrite(rawDb as never, async () => {
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
