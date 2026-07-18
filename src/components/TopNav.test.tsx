import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Control the current path per-test.
let mockPathname = "/projects";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import TopNav from "@/components/TopNav";

describe("TopNav", () => {
  beforeEach(() => {
    mockPathname = "/projects";
    localStorage.clear();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            overall: 100,
            band: "equilibrium",
            axes: { decomposition: 100, rigor: 100, wip: 100, staleness: 100 },
            churnEvents: 0,
            churnDamper: 1,
            streaks: { rigorStreak: 0, balanceStreak: 0 },
            badges: [],
            history: [],
          }),
      })
    ) as unknown as typeof fetch;
  });

  it("renders the Ponder brand mark linking home", () => {
    render(<TopNav />);
    const brand = screen.getByRole("link", { name: /ponder home/i });
    expect(brand).toHaveAttribute("href", "/");
    expect(brand).toHaveTextContent("Ponder");
  });

  it("renders primary nav links", () => {
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      "/projects"
    );
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "href",
      "/reports"
    );
  });

  it("marks the active link based on the current path", () => {
    mockPathname = "/projects/abc/board";
    render(<TopNav />);
    // /projects is active because the path starts with it
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("does not render a global Board link", () => {
    render(<TopNav />);
    expect(
      screen.queryByRole("link", { name: "Board" })
    ).not.toBeInTheDocument();
  });

  it("exposes an accessible primary navigation landmark", () => {
    render(<TopNav />);
    expect(
      screen.getByRole("navigation", { name: /primary/i })
    ).toBeInTheDocument();
  });

  it("renders the Equilibrium Meter widget once it loads", async () => {
    render(<TopNav />);
    expect(await screen.findByText("100")).toBeInTheDocument();
  });

  it("toggles the theme and persists the preference", () => {
    render(<TopNav />);
    const toggle = screen.getByRole("button", { name: /switch to dark mode/i });
    fireEvent.click(toggle);
    expect(localStorage.getItem("ponderTheme")).toBe("dark");
    // Button label flips to offer switching back to light.
    expect(
      screen.getByRole("button", { name: /switch to light mode/i })
    ).toBeInTheDocument();
  });
});
