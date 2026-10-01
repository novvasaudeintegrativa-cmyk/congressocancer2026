import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN     = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET       = Deno.env.get("WHATSAPP_APP_SECRET")?.trim();
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SVC_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN         = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID  = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;
const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;

const svcHeaders = { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": "application/json" };

async function logarUsoIA(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  try {
    const tokensIn = usage?.input_tokens ?? 0;
    const tokensOut = usage?.output_tokens ?? 0;
    const custo = (tokensIn / 1e6) * HAIKU_INPUT_USD_PER_M + (tokensOut / 1e6) * HAIKU_OUTPUT_USD_PER_M;
    await fetch(`${SUPABASE_URL}/rest/v1/ia_uso`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify([{ origem: "cris_whatsapp", modelo: "claude-haiku-4-5-20251001", tokens_entrada: tokensIn, tokens_saida: tokensOut, custo_usd: custo }]),
    });
  } catch (e) { console.error("log ia_uso:", e); }
}

const FRASE_OPTIN_WHATSAPP = "quero receber novidades do congresso câncer 2026 por whatsapp";
function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
async function registrarOptinWhatsapp(numero: string, texto: string | null) {
  if (!texto) return;
  const norm = normalizarTexto(texto);
  if (!norm.includes("novidades") || !norm.includes("congresso") || !norm.includes("whatsapp")) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_marketing_optin?on_conflict=whatsapp`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ whatsapp: numero, origem: "email_campanha", texto_recebido: texto }]),
    });
  } catch (e) { console.error("optin whatsapp:", e); }
}

async function marcarOrigemCampanha(numero: string) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/campanha_whatsapp_contatos?numero=eq.${numero}&status=eq.enviado&select=campanha_id&order=enviado_em.desc&limit=1`,
      { headers: svcHeaders },
    );
    const rows = await r.json();
    const campanhaId = rows && rows[0] && rows[0].campanha_id;
    if (!campanhaId) return;
    await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ whatsapp: numero, campanha_whatsapp_id: campanhaId }]),
    });
  } catch (e) { console.error("origem campanha:", e); }
}

// ---- WhatsApp Flow do Congresso Câncer 2026 (SUPABASE.md §49) ----
// Quando a pessoa conclui o Flow, a Meta manda uma mensagem interativa "nfm_reply" com as
// respostas em JSON. Aqui a gente grava o lead + opt-in e responde com o link do site (com UTM).
const SITE_FLOW_URL = "https://congressocancer.novvasaudeintegrativa.com.br/?utm_source=whatsapp&utm_medium=flow&utm_campaign=flow-congresso";
const TEXTO_ACEITE_FLOW = "Autorizo o uso do meu nome, e-mail e área de atuação para contato sobre o Congresso Câncer 2026, por WhatsApp e e-mail, pela equipe organizadora (Novva Saúde Integrativa). Posso pedir a exclusão dos meus dados quando quiser.";
const FLOW_AREAS: Record<string, string> = {
  medicina: "Medicina", odontologia: "Odontologia", farmacia: "Farmácia", enfermagem: "Enfermagem",
  fisioterapia: "Fisioterapia", nutricao: "Nutrição", terapias_integrativas: "Terapias integrativas", outra: "Outra",
};
type RespostaFlow = { nome: string; email: string; area: string; aceitou: boolean };

function lerRespostaFlow(nfm: any): RespostaFlow | null {
  try {
    const r = typeof nfm?.response_json === "string" ? JSON.parse(nfm.response_json) : nfm?.response_json;
    // só o Flow do Congresso tem esses campos; qualquer outro Flow cai no fluxo normal
    if (!r || typeof r.nome !== "string" || !r.nome.trim() || r.aceite_termos === undefined) return null;
    return {
      nome: r.nome.trim().slice(0, 120),
      email: String(r.email ?? "").trim().slice(0, 200),
      area: FLOW_AREAS[r.area_atuacao] ?? String(r.area_atuacao ?? "").slice(0, 80),
      aceitou: r.aceite_termos === "aceito",
    };
  } catch (e) { console.error("flow json:", e); return null; }
}

function resumoFlow(f: RespostaFlow): string {
  return `📋 Preencheu o formulário (Flow): ${f.nome} · ${f.area || "área não informada"}`;
}

async function jaProcessada(waId: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mensagens?wa_message_id=eq.${encodeURIComponent(waId)}&select=id&limit=1`, { headers: svcHeaders });
  const rows = r.ok ? await r.json() : [];
  return rows.length > 0;
}

async function processarFlow(numero: string, waId: string, f: RespostaFlow) {
  try {
    if (await jaProcessada(waId)) return; // a Meta reenvia o webhook às vezes: não duplica lead nem resposta
    const rl = await fetch(`${SUPABASE_URL}/rest/v1/quiz_leads`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify([{
        nome: f.nome, whatsapp: numero, email: f.email || null, profissao: f.area || null,
        respostas: { origem: "whatsapp_flow" },
        path: "whatsapp-flow", utm_source: "whatsapp", utm_medium: "flow", utm_campaign: "flow-congresso",
      }]),
    });
    if (!rl.ok) console.error("flow lead:", rl.status, await rl.text());
    if (f.aceitou) {
      await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_marketing_optin?on_conflict=whatsapp`, {
        method: "POST",
        headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ whatsapp: numero, origem: "whatsapp_flow", texto_recebido: TEXTO_ACEITE_FLOW }]),
      });
    }
    await garantirLeadStatus(numero);
    const primeiro = f.nome.split(/\s+/)[0];
    const texto = `Obrigado, ${primeiro}! 🙌 Aqui está o link para conhecer os lotes e garantir sua vaga no Congresso Câncer 2026: ${SITE_FLOW_URL}`;
    const resp = await mandarWhatsapp(numero, texto);
    if (resp) await gravarEnviada(numero, resp, texto);
  } catch (e) { console.error("flow:", e); }
}

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Sua função é criar uma conexão inicial calorosa com o lead e levar ele pra nossa página oficial — é lá que tem a apresentação completa (inclusive vídeo), que já responde as dúvidas mais comuns e foi feita pra converter. O site é: https://congressocancer.novvasaudeintegrativa.com.br

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes (decisão da empresa, 11/09/2026; escopo reforçado em 18/09/2026):
- Você é EXCLUSIVAMENTE uma atendente do Congresso Câncer 2026. Só existe pra falar sobre o congresso (o que é, pra quem é, e levar a pessoa pra página). Não é terapeuta, não é médica, não dá conselho de saúde, não opina sobre tratamento, medicamento, substância, exame ou diagnóstico de ninguém — nem "só uma orientação geral".
- Se o lead trouxer qualquer assunto fora do congresso (dúvida sobre o tratamento dele, pedido de indicação/opinião sobre medicamento ou substância — incluindo ivermectina, própolis, canabidiol ou qualquer outra —, ajuda pra comprar/importar/obter algo, diagnóstico, prognóstico, ou qualquer outro tema pessoal/médico/legal), NÃO desenvolva esse assunto: não faça lista, não dê passo a passo, não recomende "conversar com o médico sobre X" nem cite de volta as substâncias que a pessoa mencionou. NÃO diga que vai chamar alguém do time pra essa parte — a equipe é só de organizadores do evento, ninguém aqui está habilitado a orientar sobre tratamento/medicamento, então nunca prometa isso. Responda em no máximo 2 linhas, com empatia genuína e honestidade (ex: "essa parte do tratamento eu não tenho como te orientar, viu — isso é com a sua médica mesmo"), sem entrar no mérito, e traga de volta com naturalidade pro congresso (ex: comentar que lá ela vai poder trocar direto com especialistas em oncologia integrativa, que lidam com esse tipo de dúvida no dia a dia deles).
- NÃO informe valores, preço de lote, datas, programação, nomes de palestrantes, certificado ou qualquer detalhe aprofundado do congresso diretamente na conversa. Isso vale pra QUALQUER pergunta que o lead fizer — seja sobre preço, data, palestrantes, programação ou qualquer outra coisa sobre o congresso — não é uma lista fechada de tópicos: responda breve e SEMPRE mande o link da página: "Isso está bem explicadinho na nossa página, com todos os detalhes — dá uma olhada: https://congressocancer.novvasaudeintegrativa.com.br". Nunca cite valor em R$ na conversa, nem repita em detalhe o que está no "CONTEÚDO ATUAL DO SITE" abaixo — esse conteúdo é só pra você mesma saber do que se trata o congresso.
- Sempre que passar o link da página pro lead, use exatamente https://congressocancer.novvasaudeintegrativa.com.br (sem "/time-comercial.html" no final) — esse sufixo é só um redirecionamento interno do site, não deve aparecer na conversa.
- Se essa é a primeira mensagem que você manda nessa conversa (olhe o histórico: se não tem nenhuma mensagem sua ainda), já cumprimente, diga rapidamente do que se trata o congresso e já mande o link da página nessa mesma resposta — não espere a pessoa perguntar ou demonstrar interesse primeiro, o objetivo é levar ela pra página o quanto antes.
- Praticamente toda resposta sua deve incluir o link da página, não só quando a pergunta for sobre preço/data/palestrantes — mesmo que a pergunta seja sobre outra coisa qualquer relacionada ao congresso (formato, local, certificado, como funciona, etc.), feche a resposta mandando o link de novo. Pode confirmar o básico/geral sem detalhar (ex: "sim, é sobre práticas integrativas em oncologia", "é em São Paulo, 2 dias"), mas sempre reforçando o link, não só um convite vago.
- Se souber quem é o lead (seção "QUEM É ESSE CONTATO"), trate com familiaridade e chame pelo nome.
- Não empurre a venda de forma agressiva nem finja urgência falsa — só reforce com naturalidade que vale a pena conferir a página agora.
- Se a pessoa pedir explicitamente pra falar com um humano (sobre assunto do congresso — inscrição, pagamento, dúvida específica): se for dentro do horário comercial (8h-17h, seg-sex), diga que já chamou alguém do time e a pessoa deve aparecer a qualquer momento; se for fora desse horário, diga que chama assim que o time abrir. Nos dois casos, continue reforçando a página enquanto isso.
- A NOVVA Saúde Integrativa (a mesma organizadora do Congresso Câncer 2026) também realizou neste ano o Evento de Autismo e TDAH, um evento anterior que já aconteceu e tem página própria: https://autismo-tdah.novvasaudeintegrativa.com.br. Se o lead falar de autismo, TDAH ou desse evento (inclusive pedindo pra ser expositor nele), reconheça que é um evento nosso, diga que ele já foi realizado e passe o link da página dele. Não invente data, local, programação, valores ou qualquer detalhe desse evento, e nunca mande a pessoa procurar "outra organização", porque a organização é a mesma. Se ela quiser expor ou participar do Congresso Câncer 2026, mande o link do congresso e, no caso de expositor ou patrocinador, o Kit do Expositor: https://congressocancer.novvasaudeintegrativa.com.br/ApresentacaoKitExpositores.html
- Formatação: escreva como no WhatsApp. Pra negrito use um único asterisco de cada lado (*assim*) e nunca dois asteriscos (**assim**). Não use títulos nem listas em markdown.
- Tom: brasileiro, informal, caloroso, mensagens curtas (2-4 linhas), no máximo 1 emoji por mensagem. Nunca mencione que é uma IA a menos que perguntem diretamente.`;

const SITE_URL = "https://congressocancer.novvasaudeintegrativa.com.br/";
const SITE_TTL_MS = 30 * 60 * 1000;
let siteCache: { texto: string; quando: number } | null = null;

async function textoDoSite(): Promise<string> {
  if (siteCache && Date.now() - siteCache.quando < SITE_TTL_MS) return siteCache.texto;
  try {
    const r = await fetch(SITE_URL);
    const html = await r.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, 9000);
    siteCache = { texto, quando: Date.now() };
    return texto;
  } catch (e) {
    console.error("fetch site:", e);
    return siteCache?.texto ?? "";
  }
}

function horaBrasil(): { dia: number; hora: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour12: false, weekday: "short", hour: "2-digit",
  });
  const partes = fmt.formatToParts(new Date());
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const diaTxt = partes.find((p) => p.type === "weekday")?.value ?? "";
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[diaTxt] ?? 0, hora };
}
function dentroComercial(): boolean {
  const { dia, hora } = horaBrasil();
  return dia >= 1 && dia <= 5 && hora >= 8 && hora < 17;
}

async function assinaturaOk(req: Request, body: string): Promise<boolean> {
  if (!APP_SECRET) return true;
  const sig = req.headers.get("x-hub-signature-256");
  if (!sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sig === `sha256=${hex}`;
}

async function iaAtiva(numero: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lead_status?whatsapp=eq.${numero}&select=ia_ativa`, { headers: svcHeaders });
  if (!r.ok) return true;
  const rows = await r.json();
  return !rows.length || rows[0].ia_ativa !== false;
}

async function leadConhecido(numero: string): Promise<{ nome: string; profissao: string | null; nivel: string | null } | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_lead_conhecido`, {
    method: "POST", headers: svcHeaders, body: JSON.stringify({ p_whatsapp: numero }),
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

async function historico(numero: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&select=direcao,texto,enviado_por&order=criado_em.asc&limit=20`,
    { headers: svcHeaders },
  );
  return r.ok ? await r.json() : [];
}

async function aberturasRecentes(): Promise<string[]> {
  try {
    const desde = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/mensagens?direcao=eq.enviada&enviado_por=is.null&criado_em=gte.${desde}&select=lead_whatsapp,texto,criado_em&order=criado_em.asc`,
      { headers: svcHeaders },
    );
    if (!r.ok) return [];
    const rows = await r.json();
    const porLead = new Map<string, string>();
    for (const row of rows) {
      if (!porLead.has(row.lead_whatsapp) && row.texto) porLead.set(row.lead_whatsapp, row.texto);
    }
    return Array.from(porLead.values()).slice(-5);
  } catch (e) { console.error("aberturasRecentes:", e); return []; }
}

async function crisResponde(msgsHist: any[], conhecido: { nome: string; profissao: string | null; nivel: string | null } | null, emComercial: boolean): Promise<string | null> {
  const msgs = msgsHist
    .filter((m: any) => m.texto)
    .map((m: any) => ({ role: m.direcao === "recebida" ? "user" : "assistant", content: m.texto }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;

  const ehPrimeiraMensagem = !msgs.some((m) => m.role === "assistant");

  const site = await textoDoSite();
  const notaHorario = emComercial
    ? "Estamos dentro do horário comercial agora — um humano da equipe já foi avisado e pode assumir a qualquer momento."
    : "Estamos fora do horário comercial agora (a equipe volta às 8h no próximo dia útil).";
  let system = CRIS_INSTRUCOES + "\n\n" + notaHorario + "\n\nCONTEÚDO ATUAL DO SITE (só pra seu conhecimento — NÃO repita preço/data/programação daqui na conversa, é só a página que deve mostrar isso):\n" + site;
  if (conhecido) {
    system += `\n\nQUEM É ESSE CONTATO: nome ${conhecido.nome}` +
      (conhecido.profissao ? `, profissão ${conhecido.profissao}` : "") +
      (conhecido.nivel ? `, nível de interesse ${conhecido.nivel}` : "") +
      ". Já preencheu o formulário do site antes.";
  }
  if (ehPrimeiraMensagem) {
    const aberturas = await aberturasRecentes();
    if (aberturas.length) {
      system += "\n\nSUAS ÚLTIMAS ABERTURAS (mensagens que você mandou pra OUTROS leads nas últimas 72h) — não repita nenhuma delas quase palavra por palavra, varie o jeito de cumprimentar e apresentar o congresso:\n- " +
        aberturas.join("\n- ");
    }
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 350, system, messages: msgs }),
  });
  if (!resp.ok) { console.error("anthropic:", resp.status, await resp.text()); return null; }
  const data = await resp.json();
  const texto = (data.content || []).map((b: any) => b.text || "").join("").trim();
  return texto || null;
}

async function mandarWhatsapp(numero: string, texto: string): Promise<string | null> {
  const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "text", text: { body: texto } }),
  });
  const body = await r.json();
  if (!r.ok) { console.error("envio cris:", r.status, body); return null; }
  return body.messages?.[0]?.id ?? null;
}

async function baixarEArmazenarMidia(mediaId: string, mimeType: string): Promise<string | null> {
  try {
    const metaR = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { authorization: `Bearer ${WA_TOKEN}` },
    });
    if (!metaR.ok) return null;
    const metaJson = await metaR.json();
    const fileR = await fetch(metaJson.url, { headers: { authorization: `Bearer ${WA_TOKEN}` } });
    if (!fileR.ok) return null;
    const bytes = new Uint8Array(await fileR.arrayBuffer());
    const ext = (mimeType || "").split("/")[1]?.split(";")[0] || "bin";
    const path = `${mediaId}.${ext}`;
    const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/whatsapp-media/${path}`, {
      method: "POST",
      headers: { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": mimeType || "application/octet-stream", "x-upsert": "true" },
      body: bytes,
    });
    if (!upR.ok) { console.error("upload midia:", upR.status, await upR.text()); return null; }
    return `${SUPABASE_URL}/storage/v1/object/public/whatsapp-media/${path}`;
  } catch (e) { console.error("midia:", e); return null; }
}

async function gravarEnviada(numero: string, waId: string | null, texto: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/mensagens?on_conflict=wa_message_id`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      wa_message_id: waId, lead_whatsapp: numero, direcao: "enviada",
      tipo: "text", texto, status: "sent", wa_timestamp: new Date().toISOString(),
      enviado_por: null, raw: {},
    }]),
  });
}

async function crisFalouRecentemente(numero: string, horas: number): Promise<boolean> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&direcao=eq.enviada&enviado_por=is.null&select=criado_em&order=criado_em.desc&limit=1`,
    { headers: svcHeaders },
  );
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) return false;
  const diffMs = Date.now() - new Date(rows[0].criado_em).getTime();
  return diffMs < horas * 60 * 60 * 1000;
}

async function marcarUrgente(numero: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero, urgente: true }]),
  });
}

async function contarRespostasCris(numero: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&direcao=eq.enviada&enviado_por=is.null&select=id`,
    { headers: svcHeaders },
  );
  const rows = r.ok ? await r.json() : [];
  return rows.length;
}

async function garantirLeadStatus(numero: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lead_status?whatsapp=eq.${numero}&select=etapa`, { headers: svcHeaders });
  const rows = r.ok ? await r.json() : [];
  const etapaAtual = rows && rows[0] ? rows[0].etapa : null;
  const payload: Record<string, unknown> = { whatsapp: numero };
  // lead que ja tinha sido fechado (ganho/finalizado ou perdido) e manda
  // mensagem de novo volta pra "Em Atendimento" em vez de ficar escondido
  // na coluna de Finalizado/fora do Kanban.
  if (etapaAtual === "ganho" || etapaAtual === "perdido") payload.etapa = "conversando";
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([payload]),
  });
}

async function deixarCrisResponder(numero: string) {
  await garantirLeadStatus(numero);
  if (!(await iaAtiva(numero))) return;
  const conhecido = await leadConhecido(numero);
  const emComercial = dentroComercial();

  if (emComercial) {
    await marcarUrgente(numero);
    const jaAjudouDeVerdade = (await contarRespostasCris(numero)) >= 2;
    if (!jaAjudouDeVerdade && (await crisFalouRecentemente(numero, 0.25))) {
      return;
    }
  }

  const hist = await historico(numero);
  const texto = await crisResponde(hist, conhecido, emComercial);
  if (!texto) return;
  const waId = await mandarWhatsapp(numero, texto);
  if (!waId) return;
  await gravarEnviada(numero, waId, texto);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) return new Response(challenge, { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const bodyText = await req.text();
  if (!(await assinaturaOk(req, bodyText))) return new Response("bad signature", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(bodyText); } catch { return new Response("bad json", { status: 400 }); }

  const linhas: Record<string, unknown>[] = [];
  const statusUpdates: { id: string; status: string; ts?: string }[] = [];
  const numerosRecebidos = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        const midia = m.image || m.video || m.audio || m.document || m.sticker;
        const midiaUrl = midia?.id ? await baixarEArmazenarMidia(midia.id, midia.mime_type) : null;
        const flowResp = m.interactive?.type === "nfm_reply" ? lerRespostaFlow(m.interactive.nfm_reply) : null;
        const texto = (flowResp ? resumoFlow(flowResp) : null) ?? m.text?.body ?? m.button?.text ??
               m.interactive?.button_reply?.title ??
               m.interactive?.list_reply?.title ?? midia?.caption ?? null;
        linhas.push({
          wa_message_id: m.id,
          lead_whatsapp: m.from,
          direcao: "recebida",
          tipo: m.type ?? null,
          texto,
          midia_url: midiaUrl,
          wa_timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          raw: m,
        });
        if (flowResp) {
          // Flow do Congresso: grava lead + opt-in e responde com o link; a Cris não entra (evita resposta dupla)
          await processarFlow(m.from, m.id, flowResp);
          await marcarOrigemCampanha(m.from);
        } else {
          await registrarOptinWhatsapp(m.from, texto);
          await marcarOrigemCampanha(m.from);
          numerosRecebidos.add(m.from);
        }
      }
      for (const s of v.statuses ?? []) {
        if (s.id && s.status) statusUpdates.push({ id: s.id, status: s.status, ts: s.timestamp });
      }
    }
  }

  if (linhas.length) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/mensagens?on_conflict=wa_message_id`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linhas),
    });
    if (!resp.ok) console.error("insert mensagens:", resp.status, await resp.text());
  }

  for (const s of statusUpdates) {
    await fetch(`${SUPABASE_URL}/rest/v1/mensagens?wa_message_id=eq.${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify({ status: s.status }),
    }).catch((e) => console.error("status update:", s.id, e));

    // disparos de campanha: guarda entrega/leitura em campanha_whatsapp_contatos (SUPABASE.md §47)
    if (s.status === "delivered" || s.status === "read") {
      const quando = s.ts ? new Date(Number(s.ts) * 1000).toISOString() : new Date().toISOString();
      const corpo = s.status === "read" ? { lido_em: quando } : { entregue_em: quando };
      await fetch(`${SUPABASE_URL}/rest/v1/campanha_whatsapp_contatos?wa_message_id=eq.${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify(corpo),
      }).catch((e) => console.error("status campanha:", s.id, e));
    }
  }

  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
