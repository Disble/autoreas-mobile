import { render } from "@testing-library/react-native";
import React from "react";
import { SQLiteUnavailableScreen } from "../../src/components/sqlite-unavailable-screen";

describe("sqlite unavailable fallback", () => {
  it("renders a clear fallback instead of crashing the route", () => {
    const view = render(<SQLiteUnavailableScreen />);

    expect(view.getByText("SQLite no disponible")).toBeOnTheScreen();
    expect(
      view.getByText(/development build o recompila la app nativa/i),
    ).toBeOnTheScreen();
  });
});
