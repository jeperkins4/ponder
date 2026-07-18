import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EquilibriumMeterWidget from "@/components/EquilibriumMeterWidget";
import type { EquilibriumPayload } from "@/lib/equilibrium/types";

const payload: EquilibriumPayload = {
  overall: 72,
  band: "drifting",
  axes: { decomposition: 80, rigor: 60, wip: 90, staleness: 70 },
  churnEvents: 1,
  churnDamper: 0.92,
  streaks: { rigorStreak: 3, balanceStreak: 0 },
  badges: [
    { key: "in_equilibrium", label: "In Equilibrium", condition: "Reach green", earnedAt: null },
    {
      key: "clean_run",
      label: "Clean Run",
      condition: "10 in a row",
      earnedAt: "2026-07-10T00:00:00.000Z",
    },
  ],
  history: [
    { date: "2026-07-15", overall: 60, band: "drifting" },
    { date: "2026-07-16", overall: 72, band: "drifting" },
  ],
};

describe("EquilibriumMeterWidget", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
    ) as unknown as typeof fetch;
  });

  it("renders nothing until the payload loads", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const { container } = render(<EquilibriumMeterWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the compact score and band once loaded", async () => {
    render(<EquilibriumMeterWidget />);
    expect(await screen.findByText("72")).toBeInTheDocument();
    expect(screen.getByText("Drifting")).toBeInTheDocument();
  });

  it("renders nothing if the fetch fails", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
    const { container } = render(<EquilibriumMeterWidget />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("expands to show axes, churn, streaks, and badges on click", async () => {
    render(<EquilibriumMeterWidget />);
    const toggle = await screen.findByRole("button", { name: /equilibrium meter/i });
    fireEvent.click(toggle);

    expect(screen.getByRole("dialog", { name: /equilibrium meter details/i })).toBeInTheDocument();
    expect(screen.getByText("Decomposition")).toBeInTheDocument();
    expect(screen.getByText(/churn: 1 event/i)).toBeInTheDocument();
    expect(screen.getByText(/rigor streak: 3/i)).toBeInTheDocument();
    expect(screen.getByText("In Equilibrium")).toBeInTheDocument();
    expect(screen.getByText("Clean Run")).toBeInTheDocument();
  });

  it("greys out unearned badges", async () => {
    render(<EquilibriumMeterWidget />);
    const toggle = await screen.findByRole("button", { name: /equilibrium meter/i });
    fireEvent.click(toggle);

    const unearned = screen.getByText("In Equilibrium").closest("li");
    const earned = screen.getByText("Clean Run").closest("li");
    expect(unearned).toHaveClass("opacity-40");
    expect(earned).not.toHaveClass("opacity-40");
  });
});
