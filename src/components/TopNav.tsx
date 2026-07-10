"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/hooks/useTheme";

/**
 * Global top navigation bar with the Ponder brand mark in the upper-left.
 * Rendered from the root layout so it appears on every page. Theme-aware:
 * reads the shared `useTheme` state so it matches the board's light/dark mode.
 */
export default function TopNav() {
  const pathname = usePathname();
  const { isDark, toggle, mounted } = useTheme();

  const links = [
    { href: "/projects", label: "Projects" },
    { href: "/reports", label: "Reports" },
  ];

  // Until mounted, render the light palette to avoid a hydration flash.
  const dark = mounted && isDark;

  const barClass = dark
    ? "bg-ponder-dark-surface border-ponder-dark-border"
    : "bg-ponder-light-surface border-ponder-light-card-border";
  const brandClass = dark ? "text-ponder-dark-text" : "text-ponder-light-text";
  const purple = dark ? "text-ponder-dark-purple" : "text-ponder-light-purple";
  const markBg = dark ? "bg-ponder-dark-purple" : "bg-ponder-light-purple";

  return (
    <nav
      aria-label="Primary"
      className={`sticky top-0 z-40 w-full border-b ${barClass}`}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        {/* Brand — upper left */}
        <Link
          href="/"
          aria-label="Ponder home"
          className="flex items-center gap-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-ponder-light-purple"
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-lg font-space-grotesk text-sm font-bold text-white ${markBg}`}
            aria-hidden="true"
          >
            P
          </span>
          <span
            className={`font-space-grotesk text-xl font-bold tracking-tight ${brandClass}`}
          >
            Ponder
          </span>
        </Link>

        {/* Nav links + theme toggle */}
        <div className="flex items-center gap-1">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 font-instrument text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ponder-light-purple ${
                  active
                    ? `${purple} ${dark ? "bg-ponder-dark-bg" : "bg-ponder-light-bg"}`
                    : dark
                      ? "text-ponder-dark-text-muted hover:text-ponder-dark-text"
                      : "text-ponder-light-text-muted hover:text-ponder-light-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className={`ml-1 rounded-lg p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-ponder-light-purple ${
              dark
                ? "text-ponder-dark-text hover:bg-ponder-dark-bg"
                : "text-ponder-light-text hover:bg-ponder-light-bg"
            }`}
          >
            {dark ? (
              // Sun
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              // Moon
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
