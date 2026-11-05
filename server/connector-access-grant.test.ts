import { describe, expect, it } from "vitest";

import { botAllowsConnector, connectorAccessGrant } from "./connector-access-grant.ts";

describe("connector access from the card", () => {
  it("allows every app when the bot has no limits", () => {
    expect(botAllowsConnector({}, "microsoft_teams")).toBe(true);
    expect(connectorAccessGrant({}, "microsoft_teams")).toEqual({});
  });

  it("grants an app outside the bot's scopes and tool grants", () => {
    const bot = { connectorScopes: { apps: { gmail: "read" as const } }, connectorTools: { gmail: { tools: "*" as const } } };
    expect(botAllowsConnector(bot, "microsoft_teams")).toBe(false);
    const grant = connectorAccessGrant(bot, "microsoft_teams");
    expect(grant).toEqual({
      connectorScopes: { apps: { gmail: "read", microsoft_teams: "write" } },
      connectorTools: { gmail: { tools: "*" }, microsoft_teams: { tools: "*" } },
    });
    expect(botAllowsConnector({ ...bot, ...grant }, "microsoft_teams")).toBe(true);
  });

  it("keeps an existing tool grant", () => {
    const bot = { connectorTools: { microsoft_teams: { tools: ["MICROSOFT_TEAMS_SEND_MESSAGE"] } } };
    expect(connectorAccessGrant(bot, "microsoft_teams")).toEqual({});
  });
});
