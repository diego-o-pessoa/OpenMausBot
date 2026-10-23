import { Users } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

export function StackedMauses({ members, density, large = false }: { members: Bot[]; density: SidebarDensity; large?: boolean }) {
  const iconOnly = density === "icons";
  const slotSize = iconOnly ? "size-12" : large ? "size-9" : density === "compact" ? "size-7" : "size-8";
  const singleSize = iconOnly ? 44 : large ? 36 : density === "compact" ? 26 : 32;
  if (members.length <= 1) {
    const b = members[0];
    return (
      <div className={cn("flex shrink-0 items-center justify-center", slotSize)}>
        {b ? <BotAvatar bot={b} state="happy" size={singleSize} animated={false} /> : <Users size={24} className="text-ink-secondary" />}
      </div>
    );
  }
  const box = singleSize;
  const ring = box >= 30 ? 2 : 1.5;
  const spots: Array<[number, number]> = members.length === 2 ? [[0.32, 0.5], [0.68, 0.5]] : [[0.5, 0.3], [0.3, 0.68], [0.7, 0.68]];
  const ball = Math.round(box * 0.47);
  const avatar = Math.round(ball / 0.884);
  return (
    <div className={cn("flex shrink-0 items-center justify-center", slotSize)}>
      <div className="relative" style={{ width: box, height: box }}>
        {members.slice(0, spots.length).map((b, i) => (
          <span
            key={b.id}
            className="absolute rounded-full bg-panel"
            style={{
              width: ball,
              height: ball,
              left: box * spots[i][0] - ball / 2,
              top: box * spots[i][1] - ball / 2,
              boxShadow: `0 0 0 ${ring}px var(--color-panel)`,
            }}
          >
            <span className="absolute" style={{ left: (ball - avatar) / 2, top: (ball - avatar) / 2 }}>
              <BotAvatar bot={b} state="idle" size={avatar} animated={false} trackPointer={false} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
