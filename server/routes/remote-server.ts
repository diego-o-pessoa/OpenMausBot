import { z } from "zod";

import { DEFAULT_REMOTE_BRANCH, DEFAULT_REMOTE_REPO, publicJob, REMOTE_SERVER_PORT, type createRemoteServerJobs } from "../remote-server.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PREFIX = "/api/remote-server";
const body = z.object({
  alias: z.string().min(1).max(200),
  repo: z.string().max(500).optional(),
  branch: z.string().max(100).optional(),
  label: z.string().max(60).optional(),
});

export function createRemoteServerRoutes(deps: {
  jobs: ReturnType<typeof createRemoteServerJobs>;
  /** The VPS alias already saved for bots' computers, offered first. */
  savedAlias: () => string | null;
  /** Off where the server is not the person's own machine (a Cloud home, a shared workspace). */
  available: () => boolean;
  /** This installation's bots, chats, connections and engine sign-ins, for the server to copy in. */
  move: () => { payload: () => string; reverseTunnel: (alias: string) => Promise<() => void> };
}): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return PASS;
    if (!deps.available()) return json(res, 404, { error: "Installing a server on a VPS is available from the desktop app and self-hosted servers." });
    try {
      if (method === "GET" && path === PREFIX) {
        const latest = deps.jobs.latest();
        return json(res, 200, {
          defaults: { alias: deps.savedAlias(), repo: DEFAULT_REMOTE_REPO, branch: DEFAULT_REMOTE_BRANCH, port: REMOTE_SERVER_PORT },
          latest: latest ? publicJob(latest) : null,
        });
      }
      const jobMatch = /^\/api\/remote-server\/jobs\/([\w-]+)$/.exec(path);
      if (method === "GET" && jobMatch) {
        const job = deps.jobs.get(jobMatch[1]!);
        return job ? json(res, 200, { job: publicJob(job, true) }) : json(res, 404, { error: "This installation is no longer known; start it again." });
      }
      const action = method === "POST" ? /^\/api\/remote-server\/(check|install|move|pair)$/.exec(path)?.[1] as "check" | "install" | "move" | "pair" | undefined : undefined;
      if (action) {
        const input = body.parse(await readBody(req));
        const started = deps.jobs.start({
          action,
          alias: input.alias.trim(),
          repo: (input.repo ?? DEFAULT_REMOTE_REPO).trim(),
          branch: (input.branch ?? DEFAULT_REMOTE_BRANCH).trim(),
          pairLabel: input.label ?? "Desktop",
          ...(action === "move" ? { move: deps.move() } : {}),
        });
        if (action === "check") return json(res, 200, { job: publicJob(await started.finished) });
        if (action === "pair") return json(res, 200, { job: publicJob(await started.finished, true) });
        void started.finished.catch(() => {});
        return json(res, 202, { job: publicJob(started.job) });
      }
      return json(res, 404, { error: "Unknown VPS server operation." });
    } catch (error) {
      if (error instanceof z.ZodError) return json(res, 400, { error: error.issues[0]?.message ?? "Invalid request." });
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      return json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
