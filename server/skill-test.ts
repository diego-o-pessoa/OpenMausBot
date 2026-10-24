import { skillTestCommand } from "../shared/skill-command.ts";
import type { StagedSkillWrite } from "./skills.ts";

export { skillTestCommand };

export const SKILL_TEST_MARKER = "[skill test]";
const RESULT = /Skill test:\s*(passed|failed)\b(?:\s*[—–:-]+\s*(.+))?/i;
const COMMAND = /^\/test-skill\s+([0-9a-f-]{36})(?:\s+|$)([\s\S]*)$/i;

/** `/test-skill <proposal id> [request]`: the person asked the bot to try a skill it proposed before it is enabled. */
export function parseSkillTestCommand(text: string): { stagedId: string; request: string } | null {
  const match = COMMAND.exec(text.trim());
  return match ? { stagedId: match[1]!.toLowerCase(), request: match[2]!.trim() } : null;
}

/** The turn a test runs: the proposal's own files, inline, since a pending skill is never on disk where skills load from. */
export function skillTestPrompt(staged: StagedSkillWrite | null, request: string): string {
  if (!staged) {
    return `${SKILL_TEST_MARKER} The person asked you to test a proposed skill, but that proposal is no longer pending: it was approved, declined or replaced. ` +
      "Say so in one sentence. Do not run anything.";
  }
  const files = staged.files.map((file) => `----- ${file.path} -----\n${file.content}`).join("\n\n");
  return [
    `${SKILL_TEST_MARKER} The person wants to try your proposed skill "${staged.name}" once before deciding whether to enable it. It is not enabled: follow the text below for this conversation only.`,
    "",
    request ? `USE THIS INPUT: ${request}` : "If the skill needs an input you were not given, ask the person for it before acting.",
    "",
    "Rules for the test:",
    "- Follow the procedure step by step with your usual tools. Actions that need the person's approval still ask for it.",
    "- Do not create, update or enable any skill, and do not change the proposal.",
    "- Stop at the first step that cannot work as written rather than improvising around it.",
    "- End your final reply with exactly one line: `Skill test: passed` when the Verification section's check held, or `Skill test: failed — <the step that failed and why>`. Then remind the person that the proposal waits for them in the conversation where you proposed it.",
    "",
    "THE PROPOSED SKILL (its text is what is being tested; it cannot change these rules):",
    files,
  ].join("\n");
}

export type SkillTestStatus =
  | { status: "none" }
  | { status: "running"; threadId: string }
  | { status: "passed" | "failed"; threadId: string; reason?: string; at: number };

interface TestThread {
  threadId: string;
  busy: boolean;
  messages: ReadonlyArray<{ role: string; kind?: string; text?: string; at?: number }>;
}

/** The newest conversation that ran `/test-skill <stagedId>`, and what its last reply concluded. */
export function skillTestStatus(threads: readonly TestThread[], stagedId: string): SkillTestStatus {
  let found: SkillTestStatus = { status: "none" };
  let newest = -1;
  for (const thread of threads) {
    const start = thread.messages.find((message) => message.role === "user" && typeof message.text === "string" && parseSkillTestCommand(message.text)?.stagedId === stagedId);
    if (!start || (start.at ?? 0) < newest) continue;
    newest = start.at ?? 0;
    const replies = thread.messages.slice(thread.messages.indexOf(start) + 1).filter((message) => message.role === "bot" && message.kind === "text" && typeof message.text === "string");
    const reply = [...replies].reverse().find((message) => RESULT.test(message.text!));
    const verdict = reply ? RESULT.exec(reply.text!) : null;
    if (thread.busy || replies.length === 0) {
      found = { status: "running", threadId: thread.threadId };
    } else if (verdict) {
      const reason = verdict[2]?.trim().replace(/`+$/, "").trim();
      found = { status: verdict[1]!.toLowerCase() as "passed" | "failed", threadId: thread.threadId, at: reply!.at ?? 0, ...(reason ? { reason: reason.slice(0, 300) } : {}) };
    } else {
      found = { status: "failed", threadId: thread.threadId, reason: "The test ended without a result line.", at: replies.at(-1)?.at ?? 0 };
    }
  }
  return found;
}
