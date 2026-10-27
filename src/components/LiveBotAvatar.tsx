import { useMemo } from "react";
import { stateForBot, type MausState } from "@/lib/mascot";
import { visibleMessages, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

function useOwnState(bot: Bot | undefined): MausState {
  const messages = bot?.messages;
  const activeLeafId = bot?.activeLeafId;
  const visible = useMemo(() => (messages ? visibleMessages({ messages, activeLeafId }) : []), [messages, activeLeafId]);
  return bot ? stateForBot({ ...bot, messages: visible }) : "idle";
}

/** What the agent is doing, read from its own conversation, the same way its sidebar row reads it. */
export function useBotMascotState(bot: Bot): MausState {
  return useOwnState(bot);
}

/** The group's "is answering" mascot: the agent's own state while it works, so it matches its other mascots. */
export function useGroupPresenceState(bot: Bot | undefined, toolInFlight: boolean): MausState {
  const own = useOwnState(bot);
  if (bot?.busy) return own;
  return toolInFlight ? "working" : "thinking";
}

/** An agent's mascot that moves in step with every other mascot of that agent while it works. */
export function LiveBotAvatar({ bot, size, trackPointer = false }: { bot: Bot; size: number; trackPointer?: boolean }) {
  return <BotAvatar bot={bot} state={useBotMascotState(bot)} size={size} animated={Boolean(bot.busy)} trackPointer={trackPointer} />;
}
