import { CalendarDays, ClipboardList, FileText, Globe, Mail, Monitor, Plug, Search, SquareTerminal, Ticket, Users, type LucideIcon } from "lucide-react";
import type { ActivityKind } from "@/lib/live-activity";
import { cn } from "@/lib/cn";

const ICONS: Record<Exclude<ActivityKind, "think">, LucideIcon> = {
  terminal: SquareTerminal,
  file: FileText,
  web: Globe,
  search: Search,
  screen: Monitor,
  clipboard: ClipboardList,
  team: Users,
  mail: Mail,
  calendar: CalendarDays,
  ticket: Ticket,
  app: Plug,
};

export function ActivityKindIcon({ kind, size = 13, className }: { kind: ActivityKind; size?: number; className?: string }) {
  if (kind === "think") return null;
  const Icon = ICONS[kind];
  return <Icon size={size} aria-hidden="true" className={cn("shrink-0 text-ink-secondary", className)} data-activity-kind={kind} />;
}
