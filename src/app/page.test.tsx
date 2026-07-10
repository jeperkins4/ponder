import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import Home from "@/app/page";

describe("Home page", () => {
  it("redirects to /projects", () => {
    Home();
    expect(redirectMock).toHaveBeenCalledWith("/projects");
  });
});
