import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { ResultsDestination } from "./ResultsDestination";

const bot = {
  id: "pepper", projects: [{ id: "management", name: "OMB management" }],
  tasks: [
    { threadId: "main", title: "Everyday chat" },
    { threadId: "health", title: "Fleet health", projectId: "management" },
    { threadId: "execution", title: "Internal run", routineRunId: "run-1" },
  ],
} as Bot;

describe("routine result destination", () => {
  it("only allows the bot's main chat", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: null, onChange: vi.fn() }));
    expect(html).toContain("Post results to");
    expect(html).toContain('value="main" selected=""');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("Fleet health");
    expect(html).not.toContain("Everyday chat");
    expect(html).not.toContain("Internal run");
  });

  it("ignores legacy destination values", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: undefined, allowCurrent: true, onChange: vi.fn() }));
    expect(html).toContain('value="main" selected=""');
    expect(html).not.toContain("Keep current destination");
  });

  it("does not expose an unavailable legacy selection", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: "deleted-or-foreign", onChange: vi.fn() }));
    expect(html).toContain('value="main" selected=""');
    expect(html).not.toContain("Thread unavailable");
  });
});
