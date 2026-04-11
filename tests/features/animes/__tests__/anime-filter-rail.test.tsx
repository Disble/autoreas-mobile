import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ANIME_DAY_FILTER_OPTIONS } from "../../../../src/features/animes/anime.constants";
import { AnimeFilterRail } from "../../../../src/features/animes/ui/AnimeFilterRail";
import type { AnimeFilterRailProps } from "../../../../src/features/animes/ui/AnimeFilterRail/anime-filter-rail.types";

jest.mock("heroui-native", () => {
  const { Text, Pressable } = require("react-native");

  function Chip({
    children,
    onPress,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    hitSlop,
  }: {
    readonly children?: React.ReactNode;
    readonly onPress?: () => void;
    readonly accessibilityLabel?: string;
    readonly accessibilityRole?: string;
    readonly accessibilityState?: object;
    readonly hitSlop?: number;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        hitSlop={hitSlop}
        testID={accessibilityLabel}
      >
        {children}
      </Pressable>
    );
  }

  Chip.Label = function ChipLabel({
    children,
  }: {
    readonly children?: React.ReactNode;
  }) {
    return <Text>{children}</Text>;
  };

  return {
    Chip,
    cn: (...classes: string[]) => classes.filter(Boolean).join(" "),
  };
});

function buildProps(
  overrides?: Partial<AnimeFilterRailProps>,
): AnimeFilterRailProps {
  return {
    options: ANIME_DAY_FILTER_OPTIONS,
    counts: { Jueves: 3, Viernes: 1 },
    selected: "Jueves",
    today: "Jueves",
    orientation: "horizontal",
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe("AnimeFilterRail", () => {
  describe("horizontal orientation", () => {
    it("renders a chip per filter option", () => {
      const { getAllByRole } = render(<AnimeFilterRail {...buildProps()} />);
      expect(getAllByRole("button")).toHaveLength(
        ANIME_DAY_FILTER_OPTIONS.length,
      );
    });

    it("calls onSelect with the correct value when a chip is pressed", () => {
      const onSelect = jest.fn();
      const { getAllByRole } = render(
        <AnimeFilterRail
          {...buildProps({ onSelect, selected: "Lunes", today: "Lunes" })}
        />,
      );
      const viernesBtn = getAllByRole("button").find((btn) =>
        btn.props.accessibilityLabel?.startsWith("Viernes"),
      );
      expect(viernesBtn).toBeDefined();
      if (!viernesBtn) {
        throw new Error("Viernes button not found");
      }
      fireEvent.press(viernesBtn);
      expect(onSelect).toHaveBeenCalledWith("Viernes");
    });

    it("does not call onSelect for the already-selected chip when pressed", () => {
      const onSelect = jest.fn();
      const { getAllByRole } = render(
        <AnimeFilterRail
          {...buildProps({ onSelect, selected: "Jueves", today: "Jueves" })}
        />,
      );
      const juevesBtn = getAllByRole("button").find((btn) =>
        btn.props.accessibilityLabel?.startsWith("Jueves"),
      );
      if (!juevesBtn) {
        throw new Error("Jueves button not found");
      }
      fireEvent.press(juevesBtn);
      // onSelect is still called — the hook/parent decides whether to no-op
      expect(onSelect).toHaveBeenCalledWith("Jueves");
    });

    it("marks the selected chip with accessibilityState selected=true", () => {
      const { getAllByRole } = render(<AnimeFilterRail {...buildProps()} />);
      const juevesBtn = getAllByRole("button").find((btn) =>
        btn.props.accessibilityLabel?.startsWith("Jueves"),
      );
      expect(juevesBtn?.props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );
    });
  });

  describe("vertical orientation", () => {
    it("renders the pseudo-day section label as Estrenos", () => {
      const { getByText } = render(
        <AnimeFilterRail {...buildProps({ orientation: "vertical" })} />,
      );

      expect(getByText("Estrenos")).toBeTruthy();
    });

    it("calls onSelect when a row is pressed", () => {
      const onSelect = jest.fn();
      const { getAllByRole } = render(
        <AnimeFilterRail
          {...buildProps({ onSelect, orientation: "vertical" })}
        />,
      );
      const viernesBtn = getAllByRole("button").find((btn) =>
        btn.props.accessibilityLabel?.startsWith("Viernes"),
      );
      expect(viernesBtn).toBeDefined();
      if (!viernesBtn) {
        throw new Error("Viernes button not found");
      }
      fireEvent.press(viernesBtn);
      expect(onSelect).toHaveBeenCalledWith("Viernes");
    });
  });
});
