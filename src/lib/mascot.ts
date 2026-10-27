import { botMascotBody, type MascotBodyId } from "../../shared/mascot-bodies";
import { CURSOR_STATES, type CursorState } from "@/components/CursorAvatar";
import type { MausColor } from "../../shared/wire";
import type { LocaleKey } from "@/locales";
import { toolActivityKey } from "./live-activity";
import { lastNonReceipt } from "./receipts";

export { MAUS_COLOR_NAMES, type MausColor } from "../../shared/wire";

export type MausState = CursorState;
export const MAUS_STATES = CURSOR_STATES;

/** CursorAvatar ships French group labels; these mirror its STATE_GROUPS memberships exactly. */
export const STATE_GROUPS = {
  Lifecycle: ["sleeping", "waking", "idle", "listening", "thinking", "searching", "working"],
  Reactions: [
    "excited",
    "surprised",
    "suspicious",
    "angry",
    "drowsy",
    "happy",
    "curious",
    "confused",
    "bored",
    "proud",
    "shy",
    "sad",
    "laughing",
    "scared",
    "playful",
    "celebrate",
  ],
  "Agent morphs": ["orbit", "radar", "progress"],
  "Product cycle": [
    "spawning",
    "humming",
    "loading",
    "dictating",
    "writing",
    "sending",
    "receiving",
    "uploading",
    "notifying",
    "alerting",
    "dragging",
    "bouncing",
    "powering-down",
  ],
} satisfies Record<string, MausState[]>;

export const MAUS_COLORS = {
  green: "#34B36A",
  blue: "#3D82F6",
  red: "#EF4F4F",
  orange: "#F19D38",
  purple: "#885DF3",
  cyan: "#23B3D8",
  pink: "#EC5C9F",
  yellow: "#F2BE2E",
  teal: "#53B9A6",
  coral: "#ED722E",
} satisfies Record<MausColor, string>;

export const MAUS_MOTIONS = [
  "arrive",
  "switch",
  "customize",
  "alert",
  "thinking",
  "working",
  "launch",
  "success",
  "celebrate",
  "blink",
  "surprise",
  "failure",
] as const;

export type MausMotion = "none" | (typeof MAUS_MOTIONS)[number];

interface LegacyStates {
  [state: string]: MausState;
}

const LEGACY_STATES: LegacyStates = {
  deadpan: "idle",
  friendly: "happy",
  focused: "working",
  thinking: "thinking",
  excited: "excited",
  sleepy: "drowsy",
  surprised: "surprised",
  skeptical: "suspicious",
  worried: "scared",
  mischievous: "playful",
};

const KNOWN_STATES = new Set<string>(MAUS_STATES);

export function normalizeState(value: string | null | undefined): MausState | null {
  if (!value) return null;
  if (KNOWN_STATES.has(value)) return value as MausState;
  return LEGACY_STATES[value] ?? null;
}

export const PICKABLE_STATES: MausState[] = [
  "idle",
  "happy",
  "curious",
  "drowsy",
  "working",
  "thinking",
  "listening",
  "sleeping",
  "suspicious",
  "proud",
];

type MascotMessage = {
  kind: string;
  role?: "bot" | "user";
  tool?: { name?: string; ok?: boolean };
};

export type MascotBotProfile = {
  name: string;
  title?: string;
  description?: string;
  mascotExpression?: string | null;
  busy?: boolean;
  unread?: boolean;
  tasks?: Array<{ unread?: boolean; routineRunId?: string }> | null;
  messages?: MascotMessage[];
};

const STATE_BY_TOOL: Partial<Record<LocaleKey, MausState>> = {
  "chat.activity.readFile": "searching",
  "chat.activity.searchWeb": "searching",
  "chat.activity.readPage": "searching",
  "chat.activity.searching": "searching",
  "chat.activity.writeFile": "writing",
  "chat.activity.editFile": "writing",
  "chat.activity.publishPage": "writing",
  "chat.activity.screen": "radar",
  "chat.activity.computer": "radar",
  "chat.activity.openPage": "radar",
};

/**
 * What a busy bot is doing right now, from the last message of its turn: thinking until a tool is running,
 * then reading, writing, looking at a screen or working, by the tool's kind.
 */
export function stateForBot(bot: MascotBotProfile): MausState {
  if (!bot.busy) return "idle";
  const last = lastNonReceipt(bot.messages);
  if (last?.kind !== "activity" || !last.tool?.name || last.tool.ok !== undefined) return "thinking";
  return STATE_BY_TOOL[toolActivityKey(last.tool.name)] ?? "working";
}

/** The bodies Grok Bot's mascots wear, in picker order; any other saved body is drawn as a circle. */
export const GROK_BODY_IDS = ["circle", "pillow", "bean"] as const satisfies readonly MascotBodyId[];

export function grokBody(value: unknown): MascotBodyId {
  const body = botMascotBody(value);
  return (GROK_BODY_IDS as readonly MascotBodyId[]).includes(body) ? body : "circle";
}
