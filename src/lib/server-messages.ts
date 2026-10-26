/**
 * The server stores routine and team-goal outcomes as English sentences. This shows the person's language for the
 * sentences it knows, including runs saved before the language was chosen, and leaves any other text as written.
 */
import { activeLocale } from "./i18n";

type Rule = [pattern: RegExp, render: (...groups: string[]) => string];

const PT_BR: Rule[] = [
  [/^(.+) did not provide a valid next-step decision\.$/, (bot) => `${bot} não informou uma decisão válida para o próximo passo.`],
  [/^(.+) could not complete the coordination step(?: — (.+))?\.$/, (bot, reason) => `${bot} não conseguiu concluir a etapa de coordenação${reason ? ` — ${reason}` : ""}.`],
  [/^(.+) hit the workspace spend cap\.$/, (bot) => `${bot} atingiu o limite de gastos do espaço de trabalho.`],
  [/^(.+) selected a teammate who is not an active member of this channel\.$/, (bot) => `${bot} escolheu um colega que não é membro ativo deste canal.`],
  [/^(.+) could not return a result to (.+?)(?: — (.+))?\.$/, (worker, lead, reason) => `${worker} não conseguiu devolver um resultado para ${lead}${reason ? ` — ${reason}` : ""}.`],
  [/^(.+) is not available\.$/, (bot) => `${bot} não está disponível.`],
  [/^The team run ended before the lead reported an outcome\.$/, () => "A execução da equipe terminou antes de o líder informar um resultado."],
  [/^Paused at the (\d+)-turn safety limit\. Send the goal again to continue with a fresh bounded run\.$/, (turns) => `Pausado no limite de segurança de ${turns} turnos. Envie o objetivo de novo para continuar com uma nova execução limitada.`],
  [/^Teammates stayed busy past the wait limit (\d+) times — try again when the team is free\.$/, (times) => `Os colegas ficaram ocupados além do limite de espera ${times} vezes — tente de novo quando a equipe estiver livre.`],
  [/^The team repeated the same assignment three times without resolving the goal\.$/, () => "A equipe repetiu a mesma tarefa três vezes sem resolver o objetivo."],
  [/^Stopped after reaching the (\d+)-minute run limit$/, (minutes) => `Parado ao atingir o limite de ${minutes} minutos de execução`],
  [/^The routine ended before this scheduled run could start$/, () => "A rotina terminou antes que esta execução agendada pudesse começar"],
  [/^The routine was deleted before it could start$/, () => "A rotina foi apagada antes de começar"],
  [/^Room goal routines are unavailable$/, () => "Rotinas de objetivo de equipe não estão disponíveis"],
  [/^Could not create a room task for this goal$/, () => "Não foi possível criar uma conversa na sala para este objetivo"],
  [/^Could not create a task for this run$/, () => "Não foi possível criar uma conversa para esta execução"],
  [/^The assigned room or coordinator no longer exists$/, () => "A sala ou o coordenador definido não existe mais"],
  [/^The assigned bot no longer exists$/, () => "O bot definido não existe mais"],
  [/^Stopped waiting: the next scheduled run of this routine started instead$/, () => "Parou de esperar: a próxima execução agendada desta rotina começou no lugar"],
  [/^Skipped because the previous run of this routine is still waiting$/, () => "Pulada porque a execução anterior desta rotina ainda está aguardando"],
  [/^OpenMausBot restarted while this routine was running$/, () => "O OpenMausBot reiniciou enquanto esta rotina estava em execução"],
  [/^This computer was offline for more than 12 hours after the scheduled time$/, () => "Este computador ficou desligado por mais de 12 horas depois do horário agendado"],
  [/^Stopped by you\.$/, () => "Parado por você."],
];

export function translateServerMessage(text: string, locale: string = activeLocale()): string {
  if (!locale.toLowerCase().startsWith("pt")) return text;
  const trimmed = text.trim();
  for (const [pattern, render] of PT_BR) {
    const match = pattern.exec(trimmed);
    if (match) return render(...match.slice(1).map((group) => group ?? ""));
  }
  return text;
}
