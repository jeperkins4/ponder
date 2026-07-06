import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeSeriesChart } from "./TimeSeriesChart";

function points(values: number[], startDay = 1): { label: string; value: number }[] {
  return values.map((value, i) => ({
    label: `2026-07-${String(startDay + i).padStart(2, "0")}`,
    value,
  }));
}

describe("TimeSeriesChart", () => {
  it("renders one polyline and one last-point marker per series", () => {
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Created vs completed"
        series={[
          { name: "Created", colorClass: "text-blue-500", points: points([1, 2, 3]) },
          { name: "Completed", colorClass: "text-emerald-500", points: points([0, 1, 1]) },
        ]}
      />
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="ts-point"]')).toHaveLength(2);
  });

  it("renders a legend entry per series", () => {
    render(
      <TimeSeriesChart
        ariaLabel="Chart"
        series={[
          { name: "Created", colorClass: "text-blue-500", points: points([1]) },
          { name: "Completed", colorClass: "text-emerald-500", points: points([2]) },
        ]}
      />
    );
    const legend = screen.getByTestId("ts-legend");
    expect(legend).toHaveTextContent("Created");
    expect(legend).toHaveTextContent("Completed");
  });

  it("is exposed as a labelled image", () => {
    render(
      <TimeSeriesChart
        ariaLabel="WIP over time"
        series={[{ name: "WIP", colorClass: "text-amber-500", points: points([1, 2]) }]}
      />
    );
    expect(screen.getByRole("img", { name: "WIP over time" })).toBeInTheDocument();
  });

  it("thins axis labels to at most 10, always keeping first and last", () => {
    const many = points(Array.from({ length: 28 }, (_, i) => i), 1); // 07-01..07-28
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Long range"
        series={[{ name: "S", colorClass: "text-blue-500", points: many }]}
      />
    );
    const axisLabels = [...container.querySelectorAll('[data-testid="ts-axis-label"]')];
    expect(axisLabels.length).toBeLessThanOrEqual(10);
    const texts = axisLabels.map((el) => el.textContent);
    expect(texts).toContain("07-01");
    expect(texts).toContain("07-28");
  });

  it("shows the last value of each series", () => {
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Chart"
        series={[{ name: "S", colorClass: "text-blue-500", points: points([1, 5, 9]) }]}
      />
    );
    expect(container.textContent).toContain("9");
  });

  it("renders nothing when every series is empty", () => {
    const { container } = render(
      <TimeSeriesChart ariaLabel="Empty" series={[{ name: "S", colorClass: "text-blue-500", points: [] }]} />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
