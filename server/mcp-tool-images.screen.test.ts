import { expect, it } from "vitest";
import { isScreenCaptureTool } from "./mcp-tool-images.ts";

it("treats screen and browser tools as the agent looking, never as images for the person", () => {
  for (const name of ["mcp__computer__screenshot", "computer", "mcp__cua__click", "browser_take_screenshot",
    "mcp__playwright__browser_snapshot", "desktop", ""]) expect(isScreenCaptureTool(name)).toBe(true);
  for (const name of ["mcp__mage__generate", "image_gen", "mcp__bot-ofertas__ofertas_kit"]) expect(isScreenCaptureTool(name)).toBe(false);
});
