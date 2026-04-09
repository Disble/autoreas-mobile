import { renderHook } from "@testing-library/react-native";
import { useSQLiteUnavailableMessage } from "../../../../src/features/setup/use-sqlite-unavailable-message";

describe("useSQLiteUnavailableMessage", () => {
  it("returns the fallback copy for unsupported runtimes", () => {
    const { result } = renderHook(() => useSQLiteUnavailableMessage());

    expect(result.current.message).toMatch(/Expo SQLite no esta disponible/i);
  });
});
