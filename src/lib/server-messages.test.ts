import { describe, expect, it } from "vitest";

import { translateServerMessage } from "./server-messages";

describe("translateServerMessage", () => {
  it("shows a stored team-goal outcome in Portuguese, keeping the bot's name", () => {
    expect(translateServerMessage("Assistant did not provide a valid next-step decision.", "pt-br"))
      .toBe("Assistant não informou uma decisão válida para o próximo passo.");
  });

  it("keeps the optional reason of a failed step", () => {
    expect(translateServerMessage("Dino could not return a result to Assistant — timed out.", "pt-br"))
      .toBe("Dino não conseguiu devolver um resultado para Assistant — timed out.");
    expect(translateServerMessage("Assistant could not complete the coordination step.", "pt-br"))
      .toBe("Assistant não conseguiu concluir a etapa de coordenação.");
  });

  it("fills numbers into routine limits", () => {
    expect(translateServerMessage("Stopped after reaching the 5-minute run limit", "pt-br"))
      .toBe("Parado ao atingir o limite de 5 minutos de execução");
  });

  it("leaves English and unknown text as written", () => {
    expect(translateServerMessage("Assistant did not provide a valid next-step decision.", "en"))
      .toBe("Assistant did not provide a valid next-step decision.");
    expect(translateServerMessage("Chamado #32202 respondido.", "pt-br")).toBe("Chamado #32202 respondido.");
  });
});
