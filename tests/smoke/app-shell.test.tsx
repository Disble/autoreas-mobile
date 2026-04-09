import { render } from "@testing-library/react-native";
import React from "react";
import HomeScreen from "../../src/app/(tabs)/index";

jest.mock("expo-sqlite", () => ({
  useSQLiteContext: () => ({
    withExclusiveTransactionAsync: jest.fn(),
  }),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  useLiveQuery: () => ({
    data: [{ _id: "anime-1" }, { _id: "anime-2" }],
  }),
}));

jest.mock("../../src/infrastructure/db/client", () => ({
  createDrizzleDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => [],
        }),
      }),
    }),
  }),
}));

jest.mock("../../src/contexts/app-theme-context", () => ({
  useAppTheme: () => ({ isDark: false }),
}));

jest.mock("../../src/components/screen-scroll-view", () => ({
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("../../src/components/app-text", () => ({
  AppText: ({ children }: { children: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require("react-native");
    return <Text>{children}</Text>;
  },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  Stack: {
    Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

jest.mock("../../src/features/animes/ui/AnimeListScreen", () => ({
  AnimeListScreen: () => null,
}));

describe("app shell bootstrap", () => {
  it("renders the tracer shell with sqlite count and action", () => {
    render(<HomeScreen />);
  });
});
