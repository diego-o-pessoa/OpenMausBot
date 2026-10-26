import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Select } from "../Select";

export function ResultsDestination({ bot: _bot, value: _value, allowCurrent: _allowCurrent = false, onChange: _onChange }: {
  bot?: Bot;
  value: string | null | undefined;
  allowCurrent?: boolean;
  onChange: (threadId: string | null | undefined) => void;
}) {
  return <div className="min-w-0 space-y-1.5">
    <label className="block text-[12px] font-medium text-ink">{t("routines.results.label")}</label>
    <Select className="w-full" disabled value="main" aria-label={t("routines.results.label")}>
      <option value="main">{t("routines.results.main")}</option>
    </Select>
    <p className="text-[11px] leading-relaxed text-ink-secondary">{t("routines.results.mainHelp")}</p>
  </div>;
}
