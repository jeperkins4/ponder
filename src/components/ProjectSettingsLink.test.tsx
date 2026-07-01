import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectSettingsLink } from "./ProjectSettingsLink";

describe("ProjectSettingsLink", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("links to the project's settings page", () => {
    render(<ProjectSettingsLink projectId="p1" />);
    const link = screen.getByTestId("project-settings-link");
    expect(link).toHaveAttribute("href", "/projects/p1/settings");
  });

  it("is labelled for assistive tech and shows a Settings label", () => {
    render(<ProjectSettingsLink projectId="p1" />);
    const link = screen.getByRole("link", { name: /project settings/i });
    expect(link).toHaveTextContent("Settings");
  });

  it("uses dark-mode tokens when the theme is dark", () => {
    window.localStorage.setItem("ponderTheme", "dark");
    render(<ProjectSettingsLink projectId="p1" />);
    expect(screen.getByTestId("project-settings-link").className).toContain(
      "text-ponder-dark-text"
    );
  });
});
