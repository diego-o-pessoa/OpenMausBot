import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const UNREAD_RED = "#FD3C2F";

/** The red unread dot that sits on the mascot's crown, cut out of it by a ring of the row's own background. */
export function UnreadBadge({ avatarSize, selected }: { avatarSize: number; selected: boolean }) {
  const radius = avatarSize * 0.442;
  const dot = Math.max(8, Math.round(avatarSize * 0.29));
  return (
    <span
      data-testid="unread-badge"
      role="img"
      aria-label={t("task.unreadMany")}
      className={cn("pointer-events-none absolute rounded-full ring-2", selected ? "ring-raised" : "ring-panel")}
      style={{
        width: dot,
        height: dot,
        left: avatarSize / 2 + radius * 0.27 - dot / 2,
        top: avatarSize / 2 - radius * 0.74 - dot / 2,
        backgroundColor: UNREAD_RED,
      }}
    />
  );
}
