import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Server } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

type Container = { name: string; image: string; state: string };
export type RemoteJob = {
  id: string;
  action: "check" | "install" | "move" | "pair";
  phase: "running" | "done" | "failed";
  step: { index: number; total: number; key: string } | null;
  percent: number;
  details: string[];
  results: Record<string, string>;
  containers: Container[];
  error?: string;
};
type Defaults = { alias: string | null; repo: string; branch: string; port: number };
type Stage = "idle" | "checking" | "installing" | "moving" | "connecting";

const inputClass = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[14px] text-ink disabled:opacity-50";
const buttonClass = "cursor-pointer inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-40";
const quietClass = "cursor-pointer rounded-lg border border-hairline/50 bg-control px-3 py-2 text-[13px] font-medium text-ink disabled:opacity-40";
const POLL_MS = 1500;

const STEP_LABELS: Record<string, string> = {
  prepare: "remoteServer.step.prepare", user: "remoteServer.step.user", code: "remoteServer.step.code", build: "remoteServer.step.build",
  configure: "remoteServer.step.configure", service: "remoteServer.step.service", health: "remoteServer.step.health", pair: "remoteServer.step.pair",
  reach: "remoteServer.step.reach", connect: "remoteServer.step.connect", copy: "remoteServer.step.copy", restore: "remoteServer.step.restore",
  restart: "remoteServer.step.restart", credentials: "remoteServer.step.credentials", disconnect: "remoteServer.step.disconnect", done: "remoteServer.step.done",
};

export function stepLabel(job: RemoteJob): string {
  const key = job.step?.key ? STEP_LABELS[job.step.key] : undefined;
  return key ? t(key as Parameters<typeof t>[0]) : t("remoteServer.step.starting");
}

async function follow(id: string, onUpdate: (job: RemoteJob) => void, alive: () => boolean): Promise<RemoteJob> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (!alive()) throw new Error("closed");
    try {
      const { job }: { job: RemoteJob } = await api(`/api/remote-server/jobs/${encodeURIComponent(id)}`, { background: true });
      onUpdate(job);
      if (job.phase !== "running") return job;
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 404) throw cause;
    }
  }
}

export function RemoteServerSettings() {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [alias, setAlias] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [bringData, setBringData] = useState(true);
  const [check, setCheck] = useState<RemoteJob | null>(null);
  const [job, setJob] = useState<RemoteJob | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);
  const addVpsServer = typeof window !== "undefined" ? window.ogb?.environments?.addVpsServer : undefined;

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const result: { defaults: Defaults } = await api("/api/remote-server");
        if (!alive.current) return;
        setDefaults(result.defaults);
        setAlias(result.defaults.alias ?? "");
        setRepo(result.defaults.repo);
        setBranch(result.defaults.branch);
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { alive.current = false; };
  }, []);

  const request = () => JSON.stringify({ alias: alias.trim(), repo: repo.trim(), branch: branch.trim(), label: t("remoteServer.pairLabel") });

  const run = async (next: Stage, work: () => Promise<void>) => {
    if (stage !== "idle") return;
    setStage(next);
    setError(null);
    try { await work(); }
    catch (cause) { if (alive.current && !(cause instanceof Error && cause.message === "closed")) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setStage("idle"); }
  };

  const verify = () => run("checking", async () => {
    setJob(null);
    setConnected(false);
    const result: { job: RemoteJob } = await api("/api/remote-server/check", { method: "POST", body: request() });
    if (!alive.current) return;
    setCheck(result.job);
    if (result.job.phase === "failed") throw new Error(result.job.error ?? t("remoteServer.failed"));
  });

  const step = async (path: "install" | "move"): Promise<RemoteJob> => {
    const started: { job: RemoteJob } = await api(`/api/remote-server/${path}`, { method: "POST", body: request() });
    setJob(started.job);
    const done = await follow(started.job.id, (update) => { if (alive.current) setJob(update); }, () => alive.current);
    if (done.phase === "failed") throw new Error(done.error ?? t("remoteServer.failed"));
    return done;
  };

  const connect = async (code: string | undefined) => {
    if (!addVpsServer || !defaults) return;
    let pairing = code;
    if (!pairing) {
      const paired: { job: RemoteJob } = await api("/api/remote-server/pair", { method: "POST", body: request() });
      if (paired.job.phase === "failed") throw new Error(paired.job.error ?? t("remoteServer.failed"));
      pairing = paired.job.results.pairing_code;
    }
    const added = await addVpsServer({ alias: alias.trim(), remotePort: defaults.port, code: pairing, name: alias.trim() });
    if (!added.ok) throw new Error(added.error ?? t("remoteServer.failed"));
    if (alive.current) setConnected(true);
  };

  const install = () => run("installing", async () => {
    const installed = await step("install");
    let code = installed.results.pairing_code;
    if (bringData) {
      setStage("moving");
      const moved = await step("move");
      code = moved.results.pairing_code;
    }
    setStage("connecting");
    await connect(code);
  });

  const open = () => run("connecting", () => connect(undefined));

  const busy = stage !== "idle";
  const upToDate = check?.phase === "done" && check.results.up_to_date === "yes";
  const installed = check?.phase === "done" && check.results.installed_commit && check.results.installed_commit !== "none";
  const ready = alias.trim() && repo.trim() && branch.trim();

  return <Card title={t("remoteServer.title")} subtitle={t("remoteServer.subtitle")}>
    <div className="flex flex-col gap-3">
      {!addVpsServer && <p className="text-[13px] text-ink-secondary">{t("remoteServer.desktopOnly")}</p>}
      {error && <p role="alert" className="break-words text-[13px] text-danger">{error}</p>}
      <label className="text-[13px] text-ink">{t("remoteServer.alias")}
        <input type="text" autoComplete="off" spellCheck={false} maxLength={128} disabled={busy} placeholder="minha-vps"
          value={alias} onChange={(event) => { setAlias(event.target.value); setCheck(null); }} className={`${inputClass} mt-1`} />
      </label>
      <p className="-mt-2 text-[12px] text-ink-secondary">{t("remoteServer.aliasHint")}</p>
      <details className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
        <summary className="cursor-pointer text-[13px] text-ink-secondary">{t("remoteServer.source")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="text-[13px] text-ink">{t("remoteServer.repo")}
            <input type="text" autoComplete="off" spellCheck={false} maxLength={500} disabled={busy} value={repo} onChange={(event) => { setRepo(event.target.value); setCheck(null); }} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[13px] text-ink">{t("remoteServer.branch")}
            <input type="text" autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} value={branch} onChange={(event) => { setBranch(event.target.value); setCheck(null); }} className={`${inputClass} mt-1`} />
          </label>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !ready} onClick={() => void verify()} className={quietClass}>
          {stage === "checking" ? t("remoteServer.checking") : t("remoteServer.check")}
        </button>
      </div>

      {check?.phase === "done" && <div className="rounded-lg border border-hairline/50 bg-inset p-3 text-[13px]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-ink-secondary">{t("remoteServer.machine")}</dt><dd className="text-ink">{check.results.os} · {check.results.arch}</dd>
          <dt className="text-ink-secondary">Docker</dt><dd className="text-ink">{t(check.results.docker === "yes" ? "remoteServer.docker.yes" : check.results.docker === "stopped" ? "remoteServer.docker.stopped" : "remoteServer.docker.no")}</dd>
          <dt className="text-ink-secondary">{t("remoteServer.status")}</dt>
          <dd className="text-ink">{upToDate ? t("remoteServer.status.upToDate") : installed ? t("remoteServer.status.outdated") : t("remoteServer.status.none")}</dd>
        </dl>
        {check.containers.length > 0 && <div className="mt-3">
          <p className="text-ink-secondary">{t("remoteServer.containers")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink">{check.containers.map((container) => <li key={container.name} className="break-all">{container.name} <span className="text-ink-secondary">({container.image}, {container.state})</span></li>)}</ul>
        </div>}
        <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("remoteServer.where")}</p>
      </div>}

      {check?.phase === "done" && !upToDate && <>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <input type="checkbox" className="mt-0.5" checked={bringData} disabled={busy} onChange={(event) => setBringData(event.target.checked)} />
          <span>{t("remoteServer.bringData")}<span className="block text-[12px] text-ink-secondary">{t("remoteServer.bringDataHint")}</span></span>
        </label>
        <button type="button" disabled={busy || !addVpsServer} onClick={() => void install()} className={`${buttonClass} self-start`}>
          {busy ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Server aria-hidden="true" size={15} />}
          {t(installed ? "remoteServer.update" : "remoteServer.install")}
        </button>
      </>}
      {upToDate && <button type="button" disabled={busy || !addVpsServer} onClick={() => void open()} className={`${buttonClass} self-start`}>
        {stage === "connecting" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <CheckCircle2 aria-hidden="true" size={15} />}
        {t("remoteServer.open")}
      </button>}

      {job && (stage === "installing" || stage === "moving" || stage === "connecting" || job.phase !== "running") && <div role="status" className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[13px] text-ink">
          <span>{stage === "moving" || job.action === "move" ? t("remoteServer.moving") : t("remoteServer.installing")}: {stepLabel(job)}</span>
          <span className="tabular-nums text-ink-secondary">{job.percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
          <div className={`h-full rounded-full ${job.phase === "failed" ? "bg-danger" : "bg-accent"} transition-[width] duration-500`} style={{ width: `${job.percent}%` }} />
        </div>
        {job.details.length > 0 && <p className="truncate text-[12px] text-ink-secondary">{job.details[job.details.length - 1]}</p>}
        {job.action === "move" && job.phase === "running" && <p className="text-[12px] text-ink-secondary">{t("remoteServer.movingHint")}</p>}
      </div>}
      {connected && <p className="text-[13px] text-ink">{t("remoteServer.connected")}</p>}
    </div>
  </Card>;
}
