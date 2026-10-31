#!/usr/bin/env node
// A stdio MCP server for the bot-ofertas agent API (KaykyFelipe/bot-ofertas, api.py).
//
//   BOT_OFERTAS_TOKEN=...  node scripts/bot-ofertas-mcp.mjs
//   BOT_OFERTAS_TOKEN=...  BOT_OFERTAS_SOMENTE_LEITURA=1  node scripts/bot-ofertas-mcp.mjs
//
// Security invariant: the rules (only the agent's own offers, the daily limit, no repeats, no settings) are
// enforced by bot-ofertas, not here; this server only forwards. Keep the token in this server's environment,
// never in a bot's instructions or memory, so a bot cannot call the API with a token it was not meant to have.

const API = (process.env.BOT_OFERTAS_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const TOKEN = process.env.BOT_OFERTAS_TOKEN || "";
const READ_ONLY = /^(1|true|sim|yes)$/i.test(process.env.BOT_OFERTAS_SOMENTE_LEITURA || "");

class OfferError extends Error {}

async function call(method, path, body) {
  if (!TOKEN) throw new OfferError("BOT_OFERTAS_TOKEN não está configurado neste servidor MCP.");
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new OfferError(`O bot de ofertas não respondeu em ${API}: ${error instanceof Error ? error.message : String(error)}. Ele está no ar?`);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok) {
    const reason = data?.erro || text.slice(0, 300) || `HTTP ${response.status}`;
    const extra = data && typeof data === "object" ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== "erro")) : {};
    throw new OfferError(Object.keys(extra).length ? `${reason}\n${JSON.stringify(extra, null, 2)}` : reason);
  }
  return data;
}

function offerId(args) {
  const id = Number(args?.id);
  if (!Number.isInteger(id) || id <= 0) throw new OfferError("id é o número da oferta (ex.: 12).");
  return id;
}

const price = { type: ["number", "string"], description: "Valor em reais, como na página (ex.: 129.9 ou \"R$ 129,90\")." };

const TOOLS = [
  {
    name: "ofertas_criar",
    readOnly: false,
    description: "Cria uma oferta no bot a partir do link de afiliado e devolve a prévia: número (#12), preços do post já com o cupom, se a foto saiu, o que falta (falta) e onde a página do produto diverge do que você mandou (divergencias). A prévia aparece no grupo como \"🤖 criou #12\". No Mercado Livre, link é o meli.la da etiqueta telegram e link_whatsapp o da etiqueta whatsapp. Com cupom, mande cupom_pct para o bot calcular o Pix e o cartão. Preços: preco_por = o principal (à vista), pix só se for menor, e o parcelado como está na página (parcelas + valor_parcela); o post sai com os dois preços. Recusa produto que já está aberto ou saiu nos últimos 7 dias, e produto indisponível.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        link: { type: "string", description: "Link de afiliado: meli.la (Mercado Livre) ou da Shopee." },
        link_whatsapp: { type: "string", description: "Mercado Livre: o meli.la da etiqueta whatsapp." },
        titulo: { type: "string", description: "Nome do produto, se a página não der." },
        preco_de: price, preco_por: price,
        pix: { ...price, description: "Preço no Pix, só se a página mostrar um preço menor no Pix." },
        cartao: { ...price, description: "Não precisa: o bot calcula o total parcelado (parcelas x valor_parcela). Se mandar, ele confere a conta." },
        parcelas: { type: "integer", minimum: 1, description: "Número de parcelas, como na página (\"10x R$ 32,99\" é 10). Vai sempre com valor_parcela." },
        valor_parcela: { ...price, description: "O valor de CADA parcela, como na página (\"10x R$ 32,99\" é 32.99). Obrigatório com parcelas." },
        cupom: { type: "string", description: "Código do cupom, se houver." },
        cupom_pct: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100, description: "Desconto do cupom em %." },
        cupom_limite: { ...price, description: "Desconto máximo do cupom em R$, se houver." },
        precos_com_cupom: { type: "boolean", description: "true quando pix e cartao já são os valores com o cupom." },
      },
      required: ["link"],
    },
    run: (args) => call("POST", "/ofertas", args),
  },
  {
    name: "ofertas_ver",
    readOnly: true,
    description: "Lê uma oferta: status (rascunho, agendada, postada, descartada), preços, cupom, links, foto, quem criou, horário agendado, quando foi postada e para onde já foi no WhatsApp.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("GET", `/ofertas/${offerId(args)}`),
  },
  {
    name: "ofertas_recentes",
    readOnly: true,
    description: "Ofertas criadas ou postadas nos últimos dias (padrão 1, até 30), de todo mundo, as mais novas primeiro. Use para não repetir produto e para conferir o que saiu.",
    inputSchema: { type: "object", additionalProperties: false, properties: { dias: { type: "integer", minimum: 1, maximum: 30 } } },
    run: (args) => call("GET", `/ofertas?dias=${Number.isInteger(args?.dias) ? args.dias : 1}`),
  },
  {
    name: "ofertas_postar",
    readOnly: false,
    description: "Posta agora no canal do Telegram uma oferta sua. Não posta duas vezes: se já estava postada, diz isso. Recusa se faltar dado ou foto, se o limite do dia já foi, ou se a oferta espera aprovação. Depois, use ofertas_whatsapp.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/postar`),
  },
  {
    name: "ofertas_whatsapp",
    readOnly: false,
    description: "Manda no WhatsApp (grupo e canal) uma oferta sua já postada no Telegram e devolve o resultado de cada destino, ex.: grupo: ok / canal: o motivo da falha. Um destino que já recebeu não recebe de novo, então pode chamar de novo depois de uma falha.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/whatsapp`),
  },
  {
    name: "ofertas_descartar",
    readOnly: false,
    description: "Descarta uma oferta sua que ainda não foi postada.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/descartar`),
  },
  {
    name: "ofertas_editar",
    readOnly: false,
    description: "O mesmo que o botão ✏️ Editar, numa oferta sua ainda não postada: muda só os campos que você mandar e devolve a prévia nova (a prévia também aparece no grupo). null tira o valor, ex.: \"pix\": null. Use para corrigir uma divergência com o valor certo da página.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "integer" },
        titulo: { type: ["string", "null"] }, descricao: { type: ["string", "null"], description: "A frase curta do post; null ou vazio tira." },
        preco_de: { ...price, type: ["number", "string", "null"] }, preco_por: price,
        pix: { ...price, type: ["number", "string", "null"] }, cartao: { ...price, type: ["number", "string", "null"] },
        parcelas: { type: ["integer", "null"], minimum: 1, maximum: 24, description: "Vai sempre com valor_parcela." },
        valor_parcela: { ...price, description: "O valor de CADA parcela, como na página. Obrigatório com parcelas." },
        cupom: { type: ["string", "null"], description: "Só o código. Para calcular os preços com a %, use ofertas_cupom." },
        foto: { type: "string", description: "Endereço https da imagem do produto." },
      },
      required: ["id"],
    },
    run: ({ id, ...fields }) => call("POST", `/ofertas/${offerId({ id })}/editar`, fields),
  },
  {
    name: "ofertas_cupom",
    readOnly: false,
    description: "O mesmo que tocar em Sim e digitar o cupom com a %: grava o cupom numa oferta sua e calcula o Pix e o cartão com ele. Uma vez só por oferta, para não dar desconto em dobro.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "integer" }, cupom: { type: "string" },
        cupom_pct: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100 },
        cupom_limite: { ...price, description: "Desconto máximo do cupom em R$, se houver." },
      },
      required: ["id", "cupom", "cupom_pct"],
    },
    run: ({ id, ...fields }) => call("POST", `/ofertas/${offerId({ id })}/cupom`, fields),
  },
  {
    name: "ofertas_pra_fila",
    readOnly: false,
    description: "O mesmo que o botão 🕒 Pra fila: a oferta sai no próximo horário fixo do bot, dentro do limite do dia. Use só quando pedirem; nas janelas, use ofertas_agendar_janela.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/fila`),
  },
  {
    name: "ofertas_kit",
    readOnly: false,
    description: "O mesmo que o botão 🎁 Kit de divulgação: monta o story, a legenda, o roteiro e o status do WhatsApp da oferta, manda no grupo e grava na pasta dos agentes.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/kit`),
  },
  {
    name: "ofertas_marketeiro",
    readOnly: false,
    description: "O mesmo que o botão 📣 Mandar para o Marketeiro: grava a oferta postada (foto, preços, cupom e link) na pasta que o Marketeiro do OpenMausBot lê. Uma vez só por oferta.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "integer" } }, required: ["id"] },
    run: (args) => call("POST", `/ofertas/${offerId(args)}/marketeiro`),
  },
  {
    name: "ofertas_mensagem_grupo",
    readOnly: false,
    description: "Manda no grupo do bot o resumo da janela ou um aviso seu (ex.: \"⚠️ Samu parado: ...\"). O bot põe o seu nome na frente. Até 40 por dia.",
    inputSchema: { type: "object", additionalProperties: false, properties: { texto: { type: "string", maxLength: 3000 } }, required: ["texto"] },
    run: (args) => call("POST", "/grupo/mensagem", { texto: args?.texto }),
  },
  {
    name: "ofertas_agendar_janela",
    readOnly: false,
    description: "Agenda uma janela de postagem (manha, almoco, tarde ou noite, conforme as JANELAS do bot) com as suas ofertas prontas, na ordem de preferência. O bot sorteia os horários (com JANELA_RITMO, um post a cada N a M minutos até o fim da janela; sem ele, 3 a 6 posts), sem passar do limite do dia, posta cada uma no horário, manda no WhatsApp depois de uma pausa e descarta as sobras quando a janela acaba. Devolve os horários sorteados, as sobras e as recusadas com o motivo. Depois disso você não precisa esperar: a janela anda sozinha.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        ids: { type: "array", items: { type: "integer" }, minItems: 1, description: "Números das ofertas, da melhor para a pior." },
        janela: { type: "string", description: "manha, almoco, tarde ou noite." },
      },
      required: ["ids", "janela"],
    },
    run: (args) => call("POST", "/janelas", { ids: args?.ids, janela: args?.janela }),
  },
  {
    name: "ofertas_situacao",
    readOnly: true,
    description: "A situação do dia: quantas saíram e o limite, quanto ainda cabe, as postadas (com o WhatsApp de cada uma), as agendadas com o horário, se o WhatsApp está conectado, se a Shopee está ligada, o modo aprovação e as janelas.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    run: () => call("GET", "/situacao"),
  },
  {
    name: "ofertas_buscar_shopee",
    readOnly: false,
    description: "Busca na Shopee as que mais vendem com uma palavra e cria até 5 ofertas que passam no filtro do bot (desconto, nota, preço e vendas), já com o link de afiliado. Devolve as prévias. Use no máximo 3 palavras por janela.",
    inputSchema: { type: "object", additionalProperties: false, properties: { palavra: { type: "string" } }, required: ["palavra"] },
    run: (args) => call("POST", "/shopee/buscar", { palavra: args?.palavra }),
  },
  {
    name: "ofertas_funil",
    readOnly: true,
    description: "Filtra e ordena uma lista de produtos sem IA e sem criar nada: tira preço baixo demais para a categoria, palavra proibida (elástico, fita, corda...), desconto abaixo do mínimo, nota ou vendas baixas e o que já saiu nos últimos 7 dias. Devolve os escolhidos da maior nota para a menor (os temas da janela na frente) e os recusados com o motivo. Use antes de abrir qualquer página de produto.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        janela: { type: "string", description: "manha, almoco, tarde ou noite: os temas dela vêm na frente." },
        limite: { type: "integer", minimum: 1, maximum: 60, description: "Quantos escolhidos devolver (padrão 15)." },
        candidatos: {
          type: "array", minItems: 1, maxItems: 300,
          description: "Os produtos, com o que a lista mostra: titulo, categoria (tecnologia, games, eletrodomesticos, tenis, moda_masculina, moda_feminina, academia, casa, cozinha, beleza, alimentos), preco_por, preco_de, vendidos (ex.: \"+1.000\"), nota, item_id (ex.: MLB123) e link.",
          items: { type: "object" },
        },
      },
      required: ["candidatos"],
    },
    run: (args) => call("POST", "/funil", { candidatos: args?.candidatos, ...(args?.janela ? { janela: args.janela } : {}), ...(args?.limite ? { limite: args.limite } : {}) }),
  },
];

const visibleTools = () => TOOLS.filter((tool) => !READ_ONLY || tool.readOnly);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "bot-ofertas", version: "1.0.0" },
      instructions: READ_ONLY
        ? "Ferramentas só de leitura do bot de ofertas: confira o dia com ofertas_situacao e ofertas_recentes, e filtre produtos com ofertas_funil."
        : "Use estas ferramentas para tudo no bot de ofertas; nunca opere o bot pelo Telegram Web. As travas (só as suas ofertas, limite do dia, sem repetir) estão no bot.",
    } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: visibleTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  }
  if (method === "tools/call") {
    try {
      const tool = visibleTools().find((candidate) => candidate.name === params?.name);
      if (!tool) throw new OfferError(`Ferramenta desconhecida${READ_ONLY ? " ou fora do modo só leitura" : ""}: ${params?.name}.`);
      const result = await tool.run(params?.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (error) {
      const text = error instanceof OfferError ? error.message : `Erro inesperado: ${error instanceof Error ? error.message : String(error)}`;
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("bot-ofertas-mcp.mjs")) {
  let buffer = "";
  let queue = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let request;
      try { request = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      queue = queue.then(() => handle(request)).catch((error) => console.error(error));
    }
  });
}
