import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_  = Deno.env.get("SUPABASE_URL")!;
const ANON  = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!; // 1039296279264556

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };

// botão "Retomar conversa" do CRM (lead fora da janela de 24h): template aprovado na Meta, sem variáveis
const TEMPLATE_RETOMAR = "retomar_conversa_congresso";
const TEXTO_RETOMAR = "[Template] Olá! Tudo bem? 😊 Aqui é a equipe do Congresso Câncer 2026. Vimos que ficamos com uma conversa em aberto e queremos continuar te ajudando. Se ainda tiver interesse ou alguma dúvida, é só responder esta mensagem que a gente retoma por aqui.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function quemChamou(userToken: string) {
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${userToken}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function ehEquipeAtiva(uid: string) {
  const r = await fetch(`${URL_}/rest/v1/perfis?id=eq.${uid}&select=papel,ativo`, { headers: svcHeaders });
  const rows = await r.json();
  const p = rows && rows[0];
  return !!(p && p.ativo);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return j({ erro: "method" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const u = await quemChamou(token);
  if (!u) return j({ erro: "não autenticado" }, 401);
  if (!(await ehEquipeAtiva(u.id))) return j({ erro: "usuário inativo" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }

  const numero = String(body.numero || "").replace(/\D/g, "");
  let texto = String(body.texto || "").trim();
  const audioBase64 = body.audio_base64 ? String(body.audio_base64) : null;
  const mimeType = String(body.mime_type || "audio/ogg");
  const retomar = body.retomar === true; // botão de emergência: lead fora da janela de 24h
  if (!numero || (!texto && !audioBase64 && !retomar)) {
    return j({ erro: "numero e (texto, audio_base64 ou retomar) obrigatórios" }, 400);
  }

  // áudio: sobe pro mesmo bucket público que já guarda mídia recebida
  // (§15.8), manda por link (a Cloud API aceita audio.link direto, sem
  // precisar do passo extra de upload pro /media da Meta).
  let metaPayload: Record<string, unknown>;
  let tipoSalvo = "text";
  let midiaUrlSalva: string | null = null;
  if (retomar) {
    // template FIXO no servidor (o navegador não escolhe qual): só retoma conversa de quem já escreveu pra gente
    const rr = await fetch(`${URL_}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&direcao=eq.recebida&select=id&limit=1`, { headers: svcHeaders });
    const jaEscreveu = rr.ok ? await rr.json() : [];
    if (!jaEscreveu.length) return j({ erro: "só dá pra retomar a conversa de quem já escreveu pra gente" }, 403);
    texto = TEXTO_RETOMAR;
    metaPayload = { messaging_product: "whatsapp", to: numero, type: "template", template: { name: TEMPLATE_RETOMAR, language: { code: "pt_BR" } } };
  } else if (audioBase64) {
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const ext = (mimeType.split("/")[1] || "ogg").split(";")[0];
    const path = `enviado-${crypto.randomUUID()}.${ext}`;
    const upR = await fetch(`${URL_}/storage/v1/object/whatsapp-media/${path}`, {
      method: "POST",
      headers: { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": mimeType, "x-upsert": "true" },
      body: bytes,
    });
    if (!upR.ok) return j({ erro: "falha ao salvar áudio: " + (await upR.text()) }, 500);
    midiaUrlSalva = `${URL_}/storage/v1/object/public/whatsapp-media/${path}`;
    tipoSalvo = "audio";
    metaPayload = { messaging_product: "whatsapp", to: numero, type: "audio", audio: { link: midiaUrlSalva } };
  } else {
    metaPayload = { messaging_product: "whatsapp", to: numero, type: "text", text: { body: texto } };
  }

  const metaResp = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(metaPayload),
  });
  const metaBody = await metaResp.json();
  if (!metaResp.ok) return j({ erro: metaBody.error?.message || "falha ao enviar" }, 502);

  const waId = metaBody.messages && metaBody.messages[0] && metaBody.messages[0].id;

  await fetch(`${URL_}/rest/v1/mensagens?on_conflict=wa_message_id`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      wa_message_id: waId, lead_whatsapp: numero, direcao: "enviada",
      tipo: tipoSalvo, texto: texto || null, midia_url: midiaUrlSalva, status: "sent", wa_timestamp: new Date().toISOString(),
      enviado_por: u.id, raw: metaBody,
    }]),
  });

  // desliga a Cris e avança "Novos" -> "Em Atendimento" — sem dono, qualquer
  // um da equipe pode responder qualquer lead (sem comissão, mesmo objetivo)
  await fetch(`${URL_}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero, ia_ativa: false }]),
  });
  await fetch(`${URL_}/rest/v1/lead_status?whatsapp=eq.${numero}&etapa=eq.novo`, {
    method: "PATCH",
    headers: { ...svcHeaders, prefer: "return=minimal" },
    body: JSON.stringify({ etapa: "conversando" }),
  });

  return j({ ok: true, wa_message_id: waId });
});
