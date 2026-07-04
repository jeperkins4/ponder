import { describe, it, expect } from "vitest";
import { createServer } from "./server";
import type { PonderClient } from "./client";

describe("createServer", () => {
  it("does not throw and registers the nine expected tools", () => {
    // A fake client is enough — no tool handler is invoked here, we're only
    // verifying registration. `createServer` must not spawn a stdio
    // transport as a side effect of being called (that only happens in
    // `main()`, guarded by the `process.argv[1]` check at the bottom of
    // server.ts), otherwise this test would hang waiting on stdin.
    const fakeClient = {} as PonderClient;

    const server = createServer(fakeClient);

    // McpServer doesn't expose a public "list registered tools" API, so we
    // read its internal registry — the same map `registerTool` populates —
    // to assert on the tool names without needing a live transport.
    const registeredNames = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools
    );

    expect(registeredNames.sort()).toEqual(
      [
        "list_projects",
        "list_stories",
        "list_work_units",
        "move_work_unit",
        "mark_done",
        "update_work_unit",
        "regenerate_acceptance",
        "attach_image",
        "report_verification",
      ].sort()
    );
  });
});
