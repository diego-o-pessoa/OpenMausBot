import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Eye, Hand, Loader2, X } from "lucide-react";
import { t } from "@/lib/i18n";

export function ComputerWatchOverlay({ src, name, taking, onClose, onTakeControl }: {
  src: string;
  name: string;
  taking: boolean;
  onClose: () => void;
  onTakeControl: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("computer.watching", { name })} className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center gap-3 px-4 py-2 text-[13px] text-white">
        <Eye size={15} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t("computer.watching", { name })}</span>
        <button type="button" onClick={onTakeControl} disabled={taking}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
          {taking ? <Loader2 size={14} className="animate-spin" /> : <Hand size={14} />}
          {t("computer.takeControl")}
        </button>
        <button type="button" onClick={onClose} aria-label={t("computer.closeFullScreen")} title={t("computer.closeFullScreen")}
          className="cursor-pointer rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>
      </div>
      <img src={src} alt={t("computer.screenOf", { name })} className="min-h-0 w-full flex-1 object-contain" />
    </div>,
    document.body,
  );
}
