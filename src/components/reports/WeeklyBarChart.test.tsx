import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyBarChart } from "./WeeklyBarChart";

const data = [
  { label: "2026-06-22", value: 3 },
  { label: "2026-06-29", value: 0 },
  { label: "2026-07-06", value: 5 },
];

describe("WeeklyBarChart", () => {
  it("renders one bar per datum", () => {
    const { container } = render(
      <WeeklyBarChart data={data} ariaLabel="Weekly throughput" />
    );
    expect(container.querySelectorAll('[data-testid="bar"]')).toHaveLength(3);
  });

  it("is exposed as a labelled image", () => {
    render(<WeeklyBarChart data={data} ariaLabel="Weekly throughput" />);
    expect(
      screen.getByRole("img", { name: "Weekly throughput" })
    ).toBeInTheDocument();
  });

  it("renders MM-DD axis labels and value labels", () => {
    const { container } = render(
      <WeeklyBarChart data={data} ariaLabel="Weekly throughput" />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("06-22");
    expect(text).toContain("07-06");
    expect(text).toContain("5");
  });

  it("renders nothing for empty data", () => {
    const { container } = render(
      <WeeklyBarChart data={[]} ariaLabel="Weekly throughput" />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
