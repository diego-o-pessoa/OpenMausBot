import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";
import { GROK_BODY_IDS } from "@/lib/mascot";
import { HALLOWEEN_BODIES, HALLOWEEN_BODY_IDS } from "../../shared/halloween-bodies";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

describe("BotProfileAvatarCard body picker", () => {
  it("offers only Grok's bodies, labeled by name", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(">Body<");
    for (const id of GROK_BODY_IDS) {
      expect(markup).toContain(`aria-label="Use the ${MASCOT_BODIES[id].name} body"`);
    }
    expect(markup).not.toContain(`aria-label="Use the ${MASCOT_BODIES.star.name} body"`);
  });

  it("offers the Halloween bodies in their own row", () => {
    const markup = renderCard(makeBot({ mascotBody: "witch" }));

    expect(markup).toContain(">Halloween<");
    for (const id of HALLOWEEN_BODY_IDS) {
      expect(markup).toContain(`aria-label="Use the ${HALLOWEEN_BODIES[id].name} body"`);
    }
    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${HALLOWEEN_BODIES.witch.name} body"`);
  });

  it("marks the current body pressed and the rest unpressed, defaulting to circle", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${MASCOT_BODIES.circle.name} body"`);
    expect(markup).toContain(`aria-pressed="false" aria-label="Use the ${MASCOT_BODIES.bean.name} body"`);
  });

  it("reflects an explicitly chosen body, and shows an old one as the circle it is drawn as", () => {
    const markup = renderCard(makeBot({ mascotBody: "bean" }));

    expect(markup).toContain(`aria-pressed="true" aria-label="Use the ${MASCOT_BODIES.bean.name} body"`);
    expect(markup).toContain(`aria-pressed="false" aria-label="Use the ${MASCOT_BODIES.circle.name} body"`);
    expect(renderCard(makeBot({ mascotBody: "blob" }))).toContain(`aria-pressed="true" aria-label="Use the ${MASCOT_BODIES.circle.name} body"`);
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("hides the body picker for flat crops that have no mascot to wear one", () => {
    const markup = renderCard(makeBot({ avatarCrop: "circle" }));

    expect(markup).not.toContain(">Body<");
    expect(markup).not.toContain(`aria-label="Use the ${MASCOT_BODIES.cursor.name} body"`);
  });

  it("hides the body picker for every flat crop, not just circle", () => {
    for (const crop of ["rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));

      expect(markup).not.toContain(">Body<");
    }
  });
});
