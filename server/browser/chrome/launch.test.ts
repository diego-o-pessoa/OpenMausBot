import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";
import { BrowserHostError } from "./host-setup.ts";
import { ChromeLaunchError, launchChrome } from "./launch.ts";

const dir = mkdtempSync(join(tmpdir(), "omb-launch-"));
afterAll(() => removeTempDir(dir));

it.skipIf(process.platform === "win32")("keeps the host setup a failed launch needs as the error's cause", async () => {
  const executable = join(dir, "chrome");
  writeFileSync(executable, "#!/bin/sh\necho '[0101/000000.000:FATAL:zygote_host_impl_linux.cc(128)] No usable sandbox!' >&2\nexit 1\n");
  chmodSync(executable, 0o755);
  const failure = await launchChrome({ executablePath: executable, userDataDir: join(dir, "profile"), mode: "headless", host: "server", handshakeTimeoutMs: 5_000 })
    .then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(ChromeLaunchError);
  expect((failure as Error).cause).toBeInstanceOf(BrowserHostError);
  expect(((failure as Error).cause as BrowserHostError).kind).toBe("sandbox");
});
