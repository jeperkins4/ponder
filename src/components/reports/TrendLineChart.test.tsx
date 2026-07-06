import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendLineChart } from "./TrendLineChart";

const data = [
  { label: "2026-06-22", value: 2.5 },
  { label: "2026-06-29", value: null }, // zero-completion week: no point
  { label: "2026-07-06", value: 4 },
];

describe("TrendLineChart", () => {
  it("renders one point per non-null datum and a connecting polyline", () => {
    const { container } = render(
      <TrendLineChart data={data} ariaLabel="Cycle time trend" />
    );
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(2);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("is exposed as a labelled image", () => {
    render(<TrendLineChart data={data} ariaLabel="Cycle time trend" />);
    expect(
      screen.getByRole("img", { name: "Cycle time trend" })
    ).toBeInTheDocument();
  });

  it("renders MM-DD axis labels for every datum, null or not", () => {
    const { container } = render(
      <TrendLineChart data={data} ariaLabel="Cycle time trend" />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("06-22");
    expect(text).toContain("06-29");
    expect(text).toContain("07-06");
  });

  it("renders nothing when every value is null", () => {
    const { container } = render(
      <TrendLineChart
        data={[{ label: "2026-06-22", value: null }]}
        ariaLabel="Cycle time trend"
      />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
