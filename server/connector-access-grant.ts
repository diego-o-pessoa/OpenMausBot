import type { BotRecord } from "./store.ts";

type ConnectorAccess = Pick<BotRecord, "connectorScopes" | "connectorTools">;

export function botAllowsConnector(bot: ConnectorAccess, slug: string): boolean {
  if (bot.connectorScopes && !bot.connectorScopes.apps[slug]) return false;
  if (bot.connectorTools && !bot.connectorTools[slug]) return false;
  return true;
}

/** The person connecting from the card is the one allowing it, so the grant is full use of that app. */
export function connectorAccessGrant(bot: ConnectorAccess, slug: string): Partial<ConnectorAccess> {
  return {
    ...(bot.connectorScopes ? { connectorScopes: { apps: { ...bot.connectorScopes.apps, [slug]: "write" as const } } } : {}),
    ...(bot.connectorTools && !bot.connectorTools[slug] ? { connectorTools: { ...bot.connectorTools, [slug]: { tools: "*" as const } } } : {}),
  };
}
