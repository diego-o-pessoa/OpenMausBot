import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, RefreshCw } from "lucide-react";
import type { WorkspaceBackupSummary } from "../../shared/workspace-backup";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { WORKSPACE_RESTORE_MARKER } from "@/lib/workspace-backup-client";
import { Card } from "./SettingsPrimitives";
import { WorkspaceBackupRestartNotice, WorkspaceBackupSummaryView } from "./WorkspaceBackupSettings";

type SourceComputer = { address: string; pairedAt: string };
type BackupStatus = { busy: boolean; pendingRestore?: boolean };
type Operation = "connect" | "pull" | "disconnect" | "restore";

const inputClass = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[14px] text-ink disabled:opacity-50";
const buttonClass = "cursor-pointer inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-40";
const quietClass = "cursor-pointer rounded-lg border border-hairline/50 bg-control px-3 py-2 text-[13px] font-medium text-ink disabled:opacity-40";

export function WorkspaceSourceSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [source, setSource] = useState<SourceComputer | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [staged, setStaged] = useState<{ id: string; summary: WorkspaceBackupSummary } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const [backup, paired]: [BackupStatus, { source: SourceComputer | null }] = await Promise.all([
          api("/api/workspace-backup/status"), api("/api/workspace-backup/source"),
        ]);
        if (alive.current) { setStatus(backup); setSource(paired.source); }
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { alive.current = false; };
  }, []);

  const perform = async (operation: Operation, work: () => Promise<void>) => {
    if (lock.current || !status || status.busy || status.pendingRestore) return;
    lock.current = true;
    setBusy(operation);
    setError(null);
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(null); }
  };

  const connect = () => perform("connect", async () => {
    if (!address.trim()) return;
    const result: { source: SourceComputer } = await api("/api/workspace-backup/source", {
      method: "POST", body: JSON.stringify({ address, code }),
    });
    if (alive.current) { setSource(result.source); setAddress(""); setCode(""); }
  });

  const pull = () => perform("pull", async () => {
    setStaged(null);
    setConfirmation("");
    const result: { id: string; summary: WorkspaceBackupSummary } = await api("/api/workspace-backup/pull", { method: "POST", body: "{}" });
    if (alive.current) setStaged({ id: result.id, summary: result.summary });
  });

  const disconnect = () => perform("disconnect", async () => {
    await api("/api/workspace-backup/source", { method: "DELETE" });
    if (alive.current) { setSource(null); setStaged(null); setConfirmation(""); }
  });

  const restore = () => perform("restore", async () => {
    if (!staged || confirmation !== "REPLACE") return;
    localStorage.setItem(WORKSPACE_RESTORE_MARKER, staged.id);
    try {
      await api("/api/workspace-backup/restore", { method: "POST", body: JSON.stringify({ id: staged.id, confirmation: "REPLACE" }) });
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 404 && alive.current) { setStaged(null); setConfirmation(""); }
      throw cause;
    }
    if (alive.current) { setStatus({ busy: false, pendingRestore: true }); setStaged(null); setConfirmation(""); }
  });

  if (status?.pendingRestore) {
    return <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-ink"><WorkspaceBackupRestartNotice /></div>;
  }
  const disabled = busy !== null || !status || status.busy;
  return <Card title={t("backup.sync.title")} subtitle={t(source ? "backup.sync.connectedHint" : "backup.sync.hint")}>
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="break-words text-[13px] text-danger">{error}</p>}
      {source ? <>
        <p className="break-all text-[13px] text-ink">{t("backup.sync.connected", { address: source.address })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={() => void pull()} className={buttonClass}>
            {busy === "pull" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <RefreshCw aria-hidden="true" size={15} />}
            {busy === "pull" ? t("backup.sync.pulling") : t("backup.sync.pull")}
          </button>
          <button type="button" disabled={disabled} onClick={() => void disconnect()} className={quietClass}>{t("backup.sync.disconnect")}</button>
        </div>
      </> : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
        <label className="text-[13px] text-ink">{t("backup.sync.address")}
          <input type="text" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048} required disabled={disabled}
            placeholder="http://127.0.0.1:18799" value={address} onChange={(event) => setAddress(event.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-[13px] text-ink">{t("backup.sync.code")}
          <input type="text" autoComplete="off" spellCheck={false} maxLength={64} disabled={disabled}
            placeholder="XXXX-XXXX-XXXX" value={code} onChange={(event) => setCode(event.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <button type="submit" disabled={disabled || !address.trim()} className={buttonClass}>
          {busy === "connect" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Link2 aria-hidden="true" size={15} />}
          {busy === "connect" ? t("backup.sync.connecting") : t("backup.sync.connect")}
        </button>
      </form>}
      {staged && <div className="mt-2 flex flex-col gap-3">
        <WorkspaceBackupSummaryView summary={staged.summary} />
        <p className="text-[13px] leading-relaxed text-danger">{t("backup.sync.replaceWarning")}</p>
        <p className="text-[13px] leading-relaxed text-danger">{t("backup.trustWarning")}</p>
        <label className="text-[13px] text-ink">{t("backup.confirmReplace")}
          <input value={confirmation} autoComplete="off" spellCheck={false} disabled={disabled} onChange={(event) => setConfirmation(event.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <button type="button" disabled={disabled || confirmation !== "REPLACE"} onClick={() => void restore()}
          className="cursor-pointer rounded-lg bg-danger px-3 py-2 text-[13px] font-medium text-danger-ink disabled:opacity-40">
          {busy === "restore" ? t("backup.restoring") : t("backup.replace")}
        </button>
      </div>}
    </div>
  </Card>;
}
