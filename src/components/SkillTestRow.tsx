import { useContext, useEffect, useState } from "react";
import { Check, FlaskConical, Loader2, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { api, StoreContext, type Bot } from "@/state/store";
import { skillTestCommand } from "../../shared/skill-command";
import type { SkillRequestCardData } from "../../shared/skill-request";

type Status =
  | { status: "none" }
  | { status: "running"; threadId: string }
  | { status: "passed" | "failed"; threadId: string; reason?: string };

const POLL_MS = 3_000;

/** Tries a pending skill proposal once, in a conversation of its own, and shows how that went. */
export function SkillTestRow({ request }: { request: SkillRequestCardData }) {
  const store = useContext(StoreContext);
  const [result, setResult] = useState<Status>({ status: "none" });
  const [error, setError] = useState("");
  const path = `/api/bots/${request.botId}/skill-tests/${request.stagedId}`;

  useEffect(() => {
    if (!store) return;
    let active = true;
    const read = () => void api<Status>(path).then((next) => { if (active) setResult(next); }).catch(() => {});
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [path]);

  const start = async () => {
    setError("");
    try {
      const created = await api<{ bot: Bot }>(`/api/bots/${request.botId}/tasks`, { method: "POST", body: "{}" });
      store?.dispatch({ type: "taskSwitched", bot: created.bot });
      store?.dispatch({ type: "send", botId: request.botId, text: skillTestCommand(request.stagedId), threadId: created.bot.threadId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const open = (threadId: string) => store?.dispatch({ type: "switchTask", botId: request.botId, threadId });
  if (!store) return null;

  return (
    <div className="mt-2 flex flex-col gap-1 text-[12.5px]" data-skill-test={result.status}>
      <div className="flex flex-wrap items-center gap-2">
        {result.status === "running" ? (
          <span className="flex items-center gap-1 text-ink-secondary"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{t("skillTest.running")}</span>
        ) : (
          <button type="button" onClick={() => void start()} className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-ink hover:bg-inset">
            <FlaskConical size={13} aria-hidden="true" />{t(result.status === "none" ? "skillTest.start" : "skillTest.again")}
          </button>
        )}
        {result.status === "passed" && <span className="flex items-center gap-1 text-success"><Check size={13} aria-hidden="true" />{t("skillTest.passed")}</span>}
        {result.status === "failed" && <span className="flex items-center gap-1 text-danger"><X size={13} aria-hidden="true" />{t("skillTest.failed", { reason: result.reason ?? "" })}</span>}
        {result.status !== "none" && <button type="button" className="underline text-ink-secondary hover:text-ink" onClick={() => open(result.threadId)}>{t("skillTest.open")}</button>}
      </div>
      {result.status === "none" && <p className="text-[11.5px] text-ink-tertiary">{t("skillTest.note")}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  );
}
