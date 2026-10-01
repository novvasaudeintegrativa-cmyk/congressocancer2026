import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// enviar-flow: manda um WhatsApp Flow (mensagem interativa) pra UM número.
// Só o gestor chama (Verify JWT ligado). Serve pra testar o Flow, inclusive em rascunho.
// A pessoa precisa ter falado com o número da Novva nas últimas 24h (senão a Meta recusa).
const URL_      = Deno.env.get("SUPABASE_URL")!;
const ANON      = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN  = (Deno.env.get("WHATSAPP_PERMANENT_TOKEN") ?? "").trim();
const PHONE_ID  = (Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "").trim();

const FLOW_ID_PADRAO = "2127650164508667"; // "Congresso Câncer 2026 – Cadastro"
const CORPO_PADRAO =
  "Quer garantir sua vaga no Congresso Câncer 2026 (20 e 21 de novembro, em São Paulo)? Preencha o cadastro rapidinho, é só tocar no botão abaixo. 👇";
const CTA_PADRAO = "Quero minha vaga";

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };
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
async function ehGestor(uid: string) {
  const r = await fetch(`${URL_}/rest/v1/perfis?id=eq.${uid}&select=papel,ativo`, { headers: svcHeaders });
  const rows = await r.json();
  const p = rows && rows[0];
  return !!(p && p.ativo && p.papel === "gestor");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return j({ erro: "method" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const u = await quemChamou(token);
  if (!u) return j({ erro: "não autenticado" }, 401);
  if (!(await ehGestor(u.id))) return j({ erro: "só o gestor pode enviar Flow" }, 403);
  if (!WA_TOKEN || !PHONE_ID) return j({ erro: "WHATSAPP_PERMANENT_TOKEN / WHATSAPP_PHONE_NUMBER_ID não configurados" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }

  let numero = String(body.numero ?? "").replace(/\D/g, "");
  if (numero.length === 10 || numero.length === 11) numero = "55" + numero; // número BR sem DDI
  if (numero.length < 12) return j({ erro: "número inválido (use DDI + DDD, ex: 5511999999999)" }, 400);

  const flowId = String(body.flow_id || FLOW_ID_PADRAO).replace(/\D/g, "");
  const rascunho = body.rascunho === true;
  const corpo = String(body.corpo || CORPO_PADRAO).slice(0, 1024);
  const cta = String(body.cta || CTA_PADRAO).slice(0, 30);

  const parametros: Record<string, unknown> = {
    flow_message_version: "3",
    flow_token: "congresso-cancer-2026",
    flow_id: flowId,
    flow_cta: cta,
    flow_action: "navigate",
    flow_action_payload: { screen: "CADASTRO" },
  };
  if (rascunho) parametros.mode = "draft";

  const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: numero,
      type: "interactive",
      interactive: { type: "flow", body: { text: corpo }, action: { name: "flow", parameters: parametros } },
    }),
  });
  const rb = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("enviar-flow:", r.status, JSON.stringify(rb));
    return j({ erro: rb?.error?.message ?? `Meta respondeu ${r.status}`, codigo: rb?.error?.code ?? null, detalhe: rb?.error?.error_data?.details ?? null }, 502);
  }

  const waId = rb.messages?.[0]?.id ?? null;
  if (waId) {
    // registra na conversa do CRM
    await fetch(`${URL_}/rest/v1/mensagens?on_conflict=wa_message_id`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        wa_message_id: waId, lead_whatsapp: numero, direcao: "enviada", tipo: "interactive",
        texto: `[Flow] ${corpo}`, status: "sent", wa_timestamp: new Date().toISOString(),
        enviado_por: u.id, raw: {},
      }]),
    }).catch((e) => console.error("gravar mensagem:", e));
  }
  return j({ ok: true, wa_message_id: waId, rascunho });
});
