import { redirect } from "next/navigation";

/**
 * Root route. Ponder has no landing page of its own — the project list is
 * the entry point.
 */
export default function Home() {
  redirect("/projects");
}
