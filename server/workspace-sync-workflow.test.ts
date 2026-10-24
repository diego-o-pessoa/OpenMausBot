import { expect, it } from "vitest";
import { verifyWorkspaceSync } from "../scripts/verify-workspace-sync.ts";

it("syncs one installation into another through a loopback tunnel and keeps the connection across the restore", async () => {
  const result = await verifyWorkspaceSync();
  console.info(JSON.stringify(result));
  expect(result).toMatchObject({
    ok: true, pairedThroughTunnel: true, chatOnlyRefused: true, nonLoopbackHttpRefused: true, botsAndHistorySynced: true,
    memorySynced: true, connectionKeptAcrossRestore: true, resyncBringsNewBots: true, disconnectRevokes: true,
  });
}, 240_000);
