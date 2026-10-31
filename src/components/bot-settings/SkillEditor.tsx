import { useState } from "react";

import { t } from "@/lib/i18n";
import type { ManagedSkill } from "./SkillsSection";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

export function useSkillEditor({ botId, api, refresh, working, setWorking, setError }: {
  botId: string;
  api: Request;
  refresh: () => Promise<void>;
  working: string;
  setWorking: (name: string) => void;
  setError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);
  const failed = (cause: unknown) => setError(cause instanceof Error && cause.message ? cause.message : t("botPanel.skills.editFailed"));

  const start = async (skill: ManagedSkill) => {
    if (working) return;
    setError("");
    try {
      const { text } = (await api(`/api/bots/${botId}/skills/${encodeURIComponent(skill.name)}`)) as { text: string };
      setEditing({ name: skill.name, text });
    } catch (cause) {
      failed(cause);
    }
  };
  const save = async () => {
    if (!editing || working) return;
    setWorking(editing.name);
    setError("");
    try {
      await api(`/api/bots/${botId}/skills/${encodeURIComponent(editing.name)}`, { method: "PUT", body: JSON.stringify({ text: editing.text }) });
      setEditing(null);
      await refresh();
    } catch (cause) {
      failed(cause);
    } finally {
      setWorking("");
    }
  };
  return { editing, setEditing, start, save };
}

export function SkillEditor({ editing, working, onChange, onCancel, onSave }: {
  editing: { name: string; text: string };
  working: boolean;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const button = "inline-flex h-8 shrink-0 items-center justify-center rounded-[9px] bg-control px-3.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3" data-panel-form="skill-edit">
      <div className="text-[13.5px] font-medium text-ink">{t("botPanel.skills.editing", { name: editing.name })}</div>
      <div className="text-[12.5px] leading-[1.35] text-ink-secondary">{t("botPanel.skills.editHint")}</div>
      <textarea
        aria-label={t("botPanel.skills.editing", { name: editing.name })}
        value={editing.text}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        rows={16}
        className="w-full resize-y rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] leading-[1.45] text-ink focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className={button} disabled={working} onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" data-panel-action="save-skill" className={button} disabled={working || !editing.text.trim()} onClick={onSave}>{t("common.save")}</button>
      </div>
    </div>
  );
}
