import { t } from "@/lib/i18n";
import { intervalLabel } from "@/lib/schedule-label";

export function RandomTimesToggle({ checked, everyMinutes, onChange }: { checked: boolean; everyMinutes: number; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-[12px] text-ink">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="font-medium">{t("routines.randomTimes")}</span>
        <span className="block text-[11px] leading-relaxed text-ink-secondary">
          {t("routines.randomTimesHint", { interval: intervalLabel(everyMinutes || 5).toLocaleLowerCase() })}
        </span>
      </span>
    </label>
  );
}
