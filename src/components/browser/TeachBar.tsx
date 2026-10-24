import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { browserScope, withBrowserScope } from "@/lib/team-browser";
import { api, useStore, type Bot } from "@/state/store";

const POLL_MS = 1_000;

type Phase =
  | { kind: "starting" }
  | { kind: "recording"; count: number; text: string }
  | { kind: "stopping" }
  | { kind: "review"; demoId: string; text: string };

interface DemoReply {
  recording: boolean;
  steps?: unknown[];
  text?: string;
  demo?: { id: string } | null;
}

/** The text a bot reads to learn a saved demonstration: the server finds it by the short id. */
export function teachMessage(demoId: string, goal: string): string {
  return `/teach demo-${demoId.slice(0, 8)}${goal.trim() ? ` ${goal.trim()}` : ""}`;
}

const button = "rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-50";

/** Records the person doing a task in the bot's browser, then hands the steps to the bot to learn as a skill. */
export function TeachBar({ bot, onTakeControl, onClose }: { bot: Bot; onTakeControl: () => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const path = withBrowserScope(`/api/bots/${bot.id}/browser/demo`, browserScope(state.config?.team, bot.threadId));
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  const recording = useRef(false);
  const post = (action: string) => api<DemoReply>(path, { method: "POST", body: JSON.stringify({ action }) });

  useEffect(() => {
    let active = true;
    void post("start").then(() => {
      if (!active) { void post("discard"); return; }
      recording.current = true;
      setPhase({ kind: "recording", count: 0, text: "" });
      onTakeControl();
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      active = false;
      if (recording.current) void post("discard").catch(() => {});
    };
  }, [path]);

  useEffect(() => {
    if (phase.kind !== "recording") return;
    const timer = setInterval(() => {
      void api<DemoReply>(path).then((reply) => {
        if (reply.recording) setPhase((now) => (now.kind === "recording" ? { kind: "recording", count: reply.steps?.length ?? 0, text: reply.text ?? "" } : now));
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase.kind, path]);

  const finish = async () => {
    setError("");
    setPhase({ kind: "stopping" });
    try {
      const reply = await post("stop");
      recording.current = false;
      if (!reply.demo) {
        setError(t("browser.teach.empty"));
        onClose();
        return;
      }
      setPhase({ kind: "review", demoId: reply.demo.id, text: reply.text ?? "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase({ kind: "recording", count: 0, text: "" });
    }
  };

  const discard = async () => {
    if (recording.current) await post("discard").catch(() => {});
    recording.current = false;
    onClose();
  };

  const teach = () => {
    if (phase.kind !== "review") return;
    dispatch({ type: "send", botId: bot.id, text: teachMessage(phase.demoId, goal), threadId: bot.threadId });
    onClose();
  };

  const steps = phase.kind === "recording" || phase.kind === "review" ? phase.text : "";
  return (
    <div className="shrink-0 border-b border-hairline/30 bg-card px-3 py-2 text-[12px] text-ink" data-teach-phase={phase.kind}>
      {phase.kind === "review" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-medium"><GraduationCap size={14} aria-hidden="true" />{t("browser.teach.reviewTitle", { name: bot.name })}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 font-sans text-[12px] text-ink-secondary">{steps}</pre>
          <label className="flex flex-col gap-1">
            <span className="text-ink-secondary">{t("browser.teach.goal")}</span>
            <input value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={300} placeholder={t("browser.teach.goalPlaceholder")} className="rounded-lg bg-inset px-3 py-1.5 outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <p className="text-[11.5px] text-ink-tertiary">{t("browser.teach.reviewNote", { name: bot.name })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${button} text-ink-secondary hover:bg-inset`} onClick={() => void discard()}>{t("browser.teach.discard")}</button>
            <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={teach}>{t("browser.teach.teach", { name: bot.name })}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {phase.kind === "recording" ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" /> : <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />}
            <span role="status" className="min-w-0 flex-1 truncate">
              {phase.kind === "recording" ? t("browser.teach.recording", { count: phase.count }) : t("browser.teach.starting")}
            </span>
            {phase.kind === "recording" && phase.count > 0 && (
              <button type="button" className={`${button} text-ink-secondary hover:bg-inset`} aria-expanded={showSteps} onClick={() => setShowSteps((open) => !open)}>{t("browser.teach.showSteps")}</button>
            )}
            <button type="button" className={`${button} text-ink-secondary hover:bg-inset`} onClick={() => void discard()}>{t("browser.teach.discard")}</button>
            <button type="button" className={`${button} bg-accent text-accent-ink`} disabled={phase.kind !== "recording"} onClick={() => void finish()}>{t("browser.teach.finish")}</button>
          </div>
          {phase.kind === "recording" && <p className="text-[11.5px] text-ink-tertiary">{t("browser.teach.hint")}</p>}
          {showSteps && steps && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 font-sans text-[12px] text-ink-secondary">{steps}</pre>}
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-danger">{error}</p>}
    </div>
  );
}
