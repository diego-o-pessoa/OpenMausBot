import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MoreMenu } from "./MoreMenu";
import { teachMessage } from "./TeachBar";

const menu = (stream: boolean, onTeach?: () => void) => renderToStaticMarkup(createElement(MoreMenu, {
  stream, ready: true, typing: true, setting: { mode: "fill" }, zoom: 1, pip: null,
  onViewport: () => {}, onZoom: () => {}, onPip: () => {}, onType: () => {}, onSecret: () => {}, onReconnect: () => {}, onRestart: () => {},
  ...(onTeach ? { onTeach } : {}),
}));

describe("teachMessage", () => {
  it("names the demonstration by its short id and carries the goal", () => {
    expect(teachMessage("3f2a91bc-0000-4000-8000-000000000000", "  Add a lead  ")).toBe("/teach demo-3f2a91bc Add a lead");
    expect(teachMessage("3f2a91bc-0000-4000-8000-000000000000", "")).toBe("/teach demo-3f2a91bc");
  });
});

describe("the browser menu", () => {
  it("offers Teach a task only on the stream, where the person's inputs reach the harness", () => {
    expect(menu(true, () => {})).toContain("Teach a task");
    expect(menu(false, () => {})).not.toContain("Teach a task");
    expect(menu(true)).not.toContain("Teach a task");
  });
});
