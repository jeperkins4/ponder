import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JIRA Kanban Sync",
  description: "Local JIRA Kanban board sync tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
