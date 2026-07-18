import { describe, it, expect } from "vitest";
import { computeBand, computeComposite } from "./composite";

describe("computeBand", () => {
  it("is 'equilibrium' at or above 80", () => {
    expect(computeBand(80)).toBe("equilibrium");
    expect(computeBand(100)).toBe("equilibrium");
  });

  it("is 'drifting' between 50 and 79", () => {
    expect(computeBand(50)).toBe("drifting");
    expect(computeBand(79)).toBe("drifting");
  });

  it("is 'out' below 50", () => {
    expect(computeBand(49)).toBe("out");
    expect(computeBand(0)).toBe("out");
  });
});

describe("computeComposite", () => {
  it("averages the four axes with no churn", () => {
    const result = computeComposite(
      { decomposition: 100, rigor: 100, wip: 100, staleness: 100 },
      0
    );
    expect(result).toEqual({ overall: 100, band: "equilibrium", churnEvents: 0, churnDamper: 1 });
  });

  it("applies the churn damper to the average", () => {
    const result = computeComposite(
      { decomposition: 100, rigor: 100, wip: 100, staleness: 100 },
      5
    );
    expect(result.overall).toBe(60); // 100 * 0.6
    expect(result.band).toBe("drifting");
  });

  it("rounds the overall score", () => {
    const result = computeComposite(
      { decomposition: 100, rigor: 67, wip: 100, staleness: 100 },
      0
    );
    expect(result.overall).toBe(92); // avg 91.75 rounded
  });
});
