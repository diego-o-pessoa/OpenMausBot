import { expect, it } from "vitest";
import { askedBack } from "./store.ts";

it("calls a teammate back only when a sentence mentioning them is a question", () => {
  const augusto = { name: "Augusto" };
  expect(askedBack("Feito. @Augusto, incluo as devoluções?", augusto)).toBe(true);
  expect(askedBack("@Augusto devo agendar a noite também? Sigo depois.", augusto)).toBe(true);
  expect(askedBack("Conforme o @Augusto pediu, agendei a manhã.", augusto)).toBe(false);
  expect(askedBack("reply to: @Augusto please bring Samu in", augusto)).toBe(false);
  expect(askedBack("Alguém sabe o limite do dia? @Augusto já confirmou.", augusto)).toBe(false);
});
