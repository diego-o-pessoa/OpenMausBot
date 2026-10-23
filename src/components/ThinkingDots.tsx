import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { BotAvatar, type BotAvatarProps } from "./Avatar";

const DOT_DELAYS_MS = [0, 300, 600];

export function ThinkingDots({ color, size = 36 }: { color: string; size?: number }) {
  const dot = Math.round(size * 0.22);
  const gap = Math.max(2, Math.round(size * 0.07));
  return (
    <span className="inline-flex shrink-0 items-center" style={{ height: size, gap }} role="presentation">
      {DOT_DELAYS_MS.map((delay) => (
        <span
          key={delay}
          className="thinking-dot block rounded-full"
          style={{ width: dot, height: dot, backgroundColor: color, animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** Thinking shows the dots; once the bot is working they merge into its mascot. */
export function PresenceMascot({ bot, working, size = 36 }: { bot: BotAvatarProps["bot"]; working: boolean; size?: number }) {
  if (!working) return <ThinkingDots color={MAUS_COLORS[bot.color as MausColor] ?? MAUS_COLORS.green} size={size} />;
  return (
    <span className="presence-mascot-in inline-flex shrink-0">
      <BotAvatar bot={bot} state="working" size={size} trackPointer={false} />
    </span>
  );
}
