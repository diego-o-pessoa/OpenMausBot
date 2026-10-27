import type { Message } from "@/state/store";
import { t } from "./i18n";
import type { LocaleKey } from "@/locales";

/** Which program or kind of tool a step uses, shown as a small icon beside its label. */
export type ActivityKind = "think" | "terminal" | "file" | "web" | "search" | "screen" | "clipboard" | "team" | "mail" | "calendar" | "ticket" | "app";

// Keys, not labels: this array is built at import time, and t() reads the active pack when called.
const FALLBACK_LABELS: Array<[RegExp, LocaleKey, ActivityKind]> = [
  [/\b(?:bash|shell|terminal|exec|command|run_command)\b/i, "chat.activity.runCommand", "terminal"],
  [/\b(?:clipboard_read|read_clipboard|get_clipboard|paste)\b/i, "chat.activity.readClipboard", "clipboard"],
  [/clipboard/i, "chat.activity.clipboard", "clipboard"],
  [/\b(?:read|read_file|view|open_file)\b/i, "chat.activity.readFile", "file"],
  [/\b(?:write|write_file|create_file)\b/i, "chat.activity.writeFile", "file"],
  [/\b(?:edit|apply_patch|replace|str_replace)\b/i, "chat.activity.editFile", "file"],
  [/\b(?:web_search|search_web)\b/i, "chat.activity.searchWeb", "web"],
  [/\b(?:web_fetch|fetch_url|read_page)\b/i, "chat.activity.readPage", "web"],
  [/\b(?:grep|glob|find|search)\b/i, "chat.activity.searching", "search"],
  [/\b(?:screenshot|screen_capture)\b/i, "chat.activity.screen", "screen"],
  [/\b(?:click|type|keypress|press|scroll|computer)\b/i, "chat.activity.computer", "screen"],
  [/\b(?:open_url|navigate)\b|^browser/i, "chat.activity.openPage", "web"],
  [/\b(?:list_bots|list_agents)\b/i, "chat.activity.whosAround", "team"],
  [/\blist_rooms\b/i, "chat.activity.rooms", "team"],
  [/\bpost_to_room\b/i, "chat.activity.postRoom", "team"],
  [/\bpublish_page\b/i, "chat.activity.publishPage", "web"],
  [/\bdelegate_bot\b/i, "chat.activity.handoff", "team"],
  [/\b(?:ask_bot|send_message)\b/i, "chat.activity.askTeammate", "team"],
];

const APP_KINDS: Array<[RegExp, ActivityKind]> = [
  [/ticket/i, "ticket"],
  [/mail|outlook/i, "mail"],
  [/calendar/i, "calendar"],
  [/drive|dropbox|box|files?/i, "file"],
];

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.\s]+$/, "");
  if (!trimmed) return t("chat.activity.thinking");
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

export function liveActivityLabel(message?: Message): string {
  return liveActivityPhrases(message).phrases[0];
}

const ALTERNATES: Partial<Record<LocaleKey, LocaleKey[]>> = {
  "chat.activity.thinking": [
    "chat.activity.alt.mullingItOver",
    "chat.activity.alt.piecingItTogether",
    "chat.activity.alt.workingItOut",
    "chat.activity.alt.weighingOptions",
    "chat.activity.alt.chippingAway",
    "chat.activity.alt.diggingIn",
    "chat.activity.alt.liningThingsUp",
    "chat.activity.alt.makingProgress",
  ],
  "chat.activity.working": [
    "chat.activity.alt.chippingAway",
    "chat.activity.alt.makingProgress",
    "chat.activity.alt.liningThingsUp",
  ],
  "chat.activity.runCommand": ["chat.activity.alt.checkingTheOutput"],
  "chat.activity.readFile": ["chat.activity.alt.readingThrough", "chat.activity.alt.lookingItOver"],
  "chat.activity.writeFile": ["chat.activity.alt.draftingIt"],
  "chat.activity.editFile": ["chat.activity.alt.makingChanges"],
  "chat.activity.searchWeb": ["chat.activity.alt.lookingItUp", "chat.activity.alt.goingThroughResults"],
  "chat.activity.readPage": ["chat.activity.alt.skimmingThePage"],
  "chat.activity.searching": ["chat.activity.alt.narrowingItDown"],
  "chat.activity.screen": ["chat.activity.alt.takingALook"],
  "chat.activity.computer": ["chat.activity.alt.clickingThrough"],
  "chat.activity.handoff": ["chat.activity.alt.passingItAlong"],
};

export type LiveActivityPhrases = {
  phase: string;
  phrases: string[];
  kind: ActivityKind;
};

function phaseOf(key: LocaleKey, kind: ActivityKind = "think"): LiveActivityPhrases {
  return { phase: key, phrases: [key, ...(ALTERNATES[key] ?? [])].map((k) => t(k)), kind };
}

export function liveActivityPhrases(message?: Message): LiveActivityPhrases {
  if (
    message?.kind !== "activity" ||
    !message.tool ||
    message.tool.ok !== undefined ||
    message.comm
  ) {
    return phaseOf("chat.activity.thinking");
  }
  return toolActivityPhrases(message.tool);
}

export function activityStepLabel(tool: { name: string; spoken?: string }): string {
  return toolActivityPhrases(tool).phrases[0];
}

function toolActivityPhrases(tool: { name: string; spoken?: string }): LiveActivityPhrases {
  const server = tool.name.match(/^mcp__([^_]+)__/)?.[1] ?? "";
  const toolName = bareToolName(tool.name);
  const spoken = tool.spoken?.trim();
  // The server narrates in English for speech; a tool with a plain name is labelled in the person's language instead.
  if (!/^[\w./-]+$/.test(toolName)) {
    return spoken ? { phase: `spoken:${spoken}`, phrases: [sentenceCase(spoken)], kind: "think" } : phaseOf("chat.activity.working", "app");
  }
  const known = FALLBACK_LABELS.find(([pattern]) => pattern.test(toolName));
  if (known) return phaseOf(known[1], known[2]);
  const kind = APP_KINDS.find(([pattern]) => pattern.test(`${server} ${toolName}`))?.[1] ?? "app";
  const readable = toolName.replace(/[_-]+/g, " ").trim().toLowerCase();
  return { phase: `tool:${toolName}`, phrases: [t("chat.activity.usingTool", { tool: readable })], kind };
}

function bareToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "").split(":", 1)[0]?.trim() ?? "";
}

export function toolActivityKey(name: string): LocaleKey {
  return FALLBACK_LABELS.find(([pattern]) => pattern.test(bareToolName(name)))?.[1] ?? "chat.activity.working";
}

export function toolActivityKind(name: string): ActivityKind {
  return toolActivityPhrases({ name }).kind;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function phraseAt(phrases: readonly string[], seed: string, step: number): string {
  if (phrases.length < 2 || step <= 0) return phrases[0] ?? "";
  const rest = phrases.slice(1);
  const order = rest
    .map((phrase, index) => ({ phrase, rank: hash(`${seed}|${index}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.phrase);
  const cycle = [...order, phrases[0]];
  return cycle[(step - 1) % cycle.length];
}

export function phraseHoldMs(seed: string, step: number): number {
  return 4000 + (hash(`${seed}#${step}`) % 2001);
}
