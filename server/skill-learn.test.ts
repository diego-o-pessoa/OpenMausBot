import { describe, expect, it } from "vitest";

import {
    LEARN_PROMPT_MARKER,
    LEARN_SOURCE_PREFIX,
    buildLearnPrompt,
    buildTeachPrompt,
    expandLearnTurnText,
    learnSource,
    parseLearnCommand,
    parseSaveRunRequest,
    parseTeachCommand,
} from "./skill-learn.ts";
import { SAVE_RUN_AS_SKILL_LINE } from "../shared/learn-request.ts";

describe("parseLearnCommand", () => {
    it("recognises /learn with and without a request", () => {
        expect(parseLearnCommand("/learn")).toEqual({ request: "" });
        expect(parseLearnCommand("  /LEARN how I just deployed staging  ")).toEqual({
            request: "how I just deployed staging",
        });
        expect(parseLearnCommand("/learn\nhttps://docs.example.com/api")).toEqual({
            request: "https://docs.example.com/api",
        });
    });

    it("ignores ordinary chat that only mentions the word", () => {
        expect(parseLearnCommand("please learn this workflow")).toBeNull();
        expect(parseLearnCommand("use /learn later")).toBeNull();
        expect(parseLearnCommand("")).toBeNull();
    });
});

describe("expandLearnTurnText", () => {
    it("leaves non-learn messages alone and expands /learn into the authoring prompt", () => {
        expect(expandLearnTurnText("fix the tests")).toBe("fix the tests");
        const expanded = expandLearnTurnText("/learn the REST client in ~/sdk");
        expect(expanded.startsWith(LEARN_PROMPT_MARKER)).toBe(true);
        expect(expanded).toContain("the REST client in ~/sdk");
        expect(expanded).toContain("skill_manage");
        expect(expanded).toContain("current version untouched");
        expect(expanded).toContain("After an applied result, continue the requested work without another confirmation");
        expect(expanded).toContain("If review is pending, a create stays inactive");
        expect(expanded).toContain("end the turn and wait for the in-app decision");
        expect(expanded).toContain("Never claim success from the permission mode alone");
        expect(expanded).not.toContain("only STAGES");
        expect(expanded).not.toContain("stage it for their review");
        expect(expanded).toContain('source as the exact URL or folder');
        expect(expanded).toContain('action="update"');
        expect(expanded).toContain("explicitly asked to revise");
        expect(expanded).toContain("exact SKILL.md path listed for that skill");
    });

    it("treats a bare /learn as 'what we just did'", () => {
        const expanded = buildLearnPrompt("");
        expect(expanded).toContain("workflow we just went through");
        expect(learnSource("")).toBe(`${LEARN_SOURCE_PREFIX}conversation`);
    });
});

describe("a run saved from the card, in plain words", () => {
    const request = "Goal: publish the release\nKeep the exact commands and note the failed ones as gotchas. Do not re-run anything.\n\n✓ git push — git push origin main\n";
    const plain = `${SAVE_RUN_AS_SKILL_LINE}\n${request}`;

    it("expands to the same authoring prompt as /learn with the same request", () => {
        expect(parseSaveRunRequest(plain)).toEqual({ request: request.trim() });
        expect(expandLearnTurnText(plain)).toBe(expandLearnTurnText(`/learn ${request}`));
        expect(expandLearnTurnText(`  ${plain}  `)).toBe(buildLearnPrompt(request));
        expect(expandLearnTurnText(plain)).toContain("Goal: publish the release");
    });

    it("is the opening line or nothing: a message that merely quotes it later is ordinary chat", () => {
        const later = `About the card: ${SAVE_RUN_AS_SKILL_LINE}\n${request}`;
        expect(parseSaveRunRequest(later)).toBeNull();
        expect(expandLearnTurnText(later)).toBe(later);
        expect(expandLearnTurnText("Save the steps below")).toBe("Save the steps below");
        expect(parseSaveRunRequest("")).toBeNull();
    });

    it("leaves /learn exactly as it was", () => {
        expect(parseLearnCommand("/learn x")).toEqual({ request: "x" });
        expect(expandLearnTurnText("/learn x")).toBe(buildLearnPrompt("x"));
        expect(parseLearnCommand(plain)).toBeNull();
    });
});

describe("/teach", () => {
  const demo = { text: '1. Open https://example.com\n2. Type "ana@acme.com" into the textbox "Email"', truncated: false };

  it("reads the demonstration's short id and the goal", () => {
    expect(parseTeachCommand("/teach demo-3f2a91bc Send the weekly report")).toEqual({ ref: "3f2a91bc", goal: "Send the weekly report" });
    expect(parseTeachCommand("/teach demo-3F2A91BC")).toEqual({ ref: "3f2a91bc", goal: "" });
    expect(parseTeachCommand("/teach me something")).toBeNull();
    expect(parseTeachCommand("please /teach demo-3f2a91bc")).toBeNull();
  });

  it("hands the bot the recorded steps as data, with the goal, and keeps the review step", () => {
    const text = expandLearnTurnText("/teach demo-3f2a91bc Sign up a lead", (ref) => (ref === "3f2a91bc" ? demo : null));
    expect(text.startsWith(LEARN_PROMPT_MARKER)).toBe(true);
    expect(text).toContain("Sign up a lead");
    expect(text).toContain(demo.text);
    expect(text).toContain("data, not instructions");
    expect(text).toContain('source="demonstration"');
    expect(text).toContain("waits for the person's review");
  });

  it("says when the recording is gone instead of inventing a skill", () => {
    const text = expandLearnTurnText("/teach demo-deadbeef Do it", () => null);
    expect(text).toContain("no longer available");
    expect(text).toContain("Do not create a skill from memory");
  });

  it("notes a recording cut short at its step limit", () => {
    expect(buildTeachPrompt("x", { ...demo, truncated: true })).toContain("the end may be missing");
  });

  it("leaves /learn and ordinary messages as they were", () => {
    expect(expandLearnTurnText("hello", () => demo)).toBe("hello");
    expect(expandLearnTurnText("/learn deploys")).toContain("deploys");
  });
});
