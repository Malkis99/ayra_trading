import React from "react";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { EconomyHistoryChart } from "./EconomyHistoryChart";

const point = { period: "2026-09", value: 0, group: "series:percent:SA:current" };
const draw = (points: typeof point[]) => render(<EconomyHistoryChart points={points} empty="Insufficient history" format={String} />);
it("does not reserve a chart for one observation or incompatible vintages", () => {
  const { container, rerender } = draw([point]);
  expect(container.querySelector("svg")).toBeNull();
  rerender(<EconomyHistoryChart points={[point, { ...point, period: "2026-10", group: "series:percent:SA:new-vintage" }]} empty="Insufficient history" format={String} />);
  expect(container.querySelector("svg")).toBeNull();
});
it("charts comparable observations including zero without joining a missing month", () => {
  const { container } = draw([point, { ...point, period: "2026-10", value: 1 }, { ...point, period: "2026-12", value: 2 }]);
  expect(container.querySelectorAll("circle")).toHaveLength(3);
  expect(container.querySelectorAll("line[data-history-segment]")).toHaveLength(1);
});
it("does not connect a different stage or unit to a compatible series", () => {
  const { container } = draw([point, { ...point, period: "2026-10", value: 1 }, { ...point, period: "2026-11", group: "series:USD:NSA:final" }]);
  expect(container.querySelectorAll("line[data-history-segment]")).toHaveLength(1);
});
