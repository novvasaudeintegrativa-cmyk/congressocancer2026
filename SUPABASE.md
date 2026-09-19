# Coletor de eventos — Supabase + novva-crm.html

O site manda cada evento para **dois lugares**: o Meta Pixel e um banco próprio
(Supabase). O `novva-crm.html` lê esse banco e mostra os
números — é a "página mãe" com um menu lateral de 4 abas (CRM, Tráfego,
Financeiro, Quiz), cada uma carregando `crm.html`/`trafego.html`/`financeiro.html`/
`quiz-raiox.html` (leads do `quiz.html`) dentro de um `<iframe>`. Todas essas
ferramentas internas ficam soltas na raiz do site, sem link na navegação
pública — acesso só por quem tem a URL, igual `index.html` e `quiz.html`.

Arquivos deste `.md` **não** vão para o FTP (o deploy exclui `*.md`) — é só
referência de setup.

---

## 1. Criar o projeto Supabase

1. <https://supabase.com> → **New project**.
2. Região: **South America (São Paulo)**.
3. Guarde a senha do banco (não é usada no site, mas serve para Metabase/Grafana depois).

## 2. Rodar o SQL

Supabase → **SQL Editor** → cole e rode o bloco abaixo. Ele cria a tabela
`events` (só aceita INSERT anônimo via RLS) e as *views* agregadas, sem PII,
liberadas para o painel.

> Se a tabela `events` **já existe**, rode só o bloco de `alter table` da seção
> **"UTM / campanhas"** mais abaixo + as views novas — o `create table if not
> exists` não adiciona colunas em tabela existente.

```sql
-- ---------- Tabela bruta ----------
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  visitor_id   text not null,
  session_id   text,
  event        text not null,
  props        jsonb not null default '{}'::jsonb,
  path         text,
  referrer     text,
  screen_w     int,
  device       text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  fbclid       text
);

-- ---------- Migracao p/ tabela que ja existia (rodar sozinho) ----------
alter table public.events
  add column if not exists device       text,
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term     text,
  add column if not exists utm_content  text,
  add column if not exists gclid        text,
  add column if not exists fbclid       text,
  add column if not exists country      text,
  add column if not exists region       text,
  add column if not exists region_code  text,
  add column if not exists city         text,
  add column if not exists lat          double precision,
  add column if not exists lon          double precision;

-- o site agora manda `device` (mobile/tablet/desktop) no lugar do user agent
alter table public.events drop column if exists ua;

create index if not exists events_created_at_idx   on public.events (created_at desc);
create index if not exists events_event_idx        on public.events (event);
create index if not exists events_visitor_idx      on public.events (visitor_id);
create index if not exists events_utm_campaign_idx on public.events (utm_campaign);

-- ---------- RLS: só INSERT pelo anon ----------
alter table public.events enable row level security;

drop policy if exists "anon insere eventos" on public.events;
create policy "anon insere eventos"
  on public.events for insert
  to anon
  with check (true);

revoke select on public.events from anon;

-- ---------- Views agregadas (sem PII) ----------
create or replace view public.v_kpis_30d as
select
  count(*) filter (where event = 'PageView')          as pageviews,
  count(distinct session_id)                          as sessoes,
  count(distinct visitor_id)                          as visitantes,
  count(*) filter (where event = 'InitiateCheckout')  as initiate_checkout,
  count(*) filter (where event = 'Contact')           as contatos_whatsapp,
  count(*) filter (where event = 'VideoPlay')         as video_plays,
  count(*) filter (where event = 'VideoComplete')     as video_completes
from public.events
where created_at >= now() - interval '30 days';

create or replace view public.v_eventos_por_dia as
select (created_at at time zone 'America/Sao_Paulo')::date as dia,
       event, count(*) as total
from public.events
where created_at >= now() - interval '90 days'
group by 1, 2
order by 1 desc, 2;

create or replace view public.v_rolagem as
select (props->>'percent')::int as percent, count(*) as total
from public.events
where event = 'ScrollDepth' and created_at >= now() - interval '30 days'
group by 1 order by 1;

create or replace view public.v_tempo_pagina as
select (props->>'seconds')::int as segundos, count(*) as total
from public.events
where event = 'TimeOnPage' and created_at >= now() - interval '30 days'
group by 1 order by 1;

create or replace view public.v_videos as
select
  props->>'video_title' as video,
  props->>'placement'   as posicao,
  count(*) filter (where event = 'VideoPlay') as plays,
  count(*) filter (where event = 'VideoProgress' and (props->>'percent')::int = 25) as p25,
  count(*) filter (where event = 'VideoProgress' and (props->>'percent')::int = 50) as p50,
  count(*) filter (where event = 'VideoProgress' and (props->>'percent')::int = 75) as p75,
  count(*) filter (where event = 'VideoProgress' and (props->>'percent')::int = 95) as p95,
  count(*) filter (where event = 'VideoComplete') as completes
from public.events
where event in ('VideoPlay', 'VideoProgress', 'VideoComplete')
  and created_at >= now() - interval '30 days'
group by 1, 2
order by plays desc nulls last;

create or replace view public.v_referrers as
select
  coalesce(nullif(split_part(split_part(referrer, '//', 2), '/', 1), ''), '(direto)') as origem,
  count(*) as sessoes
from public.events
where event = 'PageView' and created_at >= now() - interval '30 days'
group by 1 order by 2 desc limit 25;

-- Campanhas por UTM (source / medium / campaign) — 30 dias
create or replace view public.v_campanhas as
select
  coalesce(utm_source,   '(sem source)')   as source,
  coalesce(utm_medium,   '(sem medium)')   as medium,
  coalesce(utm_campaign, '(sem campaign)') as campaign,
  count(*) filter (where event = 'PageView')         as pageviews,
  count(distinct session_id)                         as sessoes,
  count(*) filter (where event = 'InitiateCheckout') as checkouts,
  count(*) filter (where event = 'Contact')          as contatos
from public.events
where created_at >= now() - interval '30 days'
  and (utm_source is not null or utm_medium is not null or utm_campaign is not null
       or gclid is not null or fbclid is not null)
group by 1, 2, 3
order by sessoes desc
limit 50;

create or replace view public.v_recentes as
select created_at, event, props, path, device,
  coalesce(nullif(split_part(split_part(referrer, '//', 2), '/', 1), ''), '(direto)') as origem,
  utm_source, utm_campaign,
  session_id
from public.events
order by created_at desc limit 200;

-- ========== ROLLUP DIARIO (historico permanente, ocupa KB/mes) ==========
-- Agrega o cru por dia; mesmo que um dia a tabela `events` seja podada,
-- tendencia / UTM / funil / video ficam preservados aqui.
create table if not exists public.events_daily (
  dia          date not null,
  event        text not null,
  placement    text not null default '',
  utm_source   text not null default '',
  utm_medium   text not null default '',
  utm_campaign text not null default '',
  total        int  not null default 0,
  sessoes      int  not null default 0,
  primary key (dia, event, placement, utm_source, utm_medium, utm_campaign)
);

create or replace function public.rollup_events(
  d date default ((now() at time zone 'America/Sao_Paulo')::date - 1)
) returns void language sql as $$
  insert into public.events_daily
    (dia, event, placement, utm_source, utm_medium, utm_campaign, total, sessoes)
  select
    d, event,
    coalesce(props->>'placement', ''),
    coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, ''),
    count(*), count(distinct session_id)
  from public.events
  where (created_at at time zone 'America/Sao_Paulo')::date = d
  group by 1, 2, 3, 4, 5, 6
  on conflict (dia, event, placement, utm_source, utm_medium, utm_campaign)
  do update set total = excluded.total, sessoes = excluded.sessoes;
$$;

-- backfill dos dias que ja existem (roda uma vez, idempotente)
do $$
declare dd date;
begin
  for dd in
    select distinct (created_at at time zone 'America/Sao_Paulo')::date from public.events
  loop
    perform public.rollup_events(dd);
  end loop;
end $$;

-- agenda: todo dia 00:10 America/Sao_Paulo (03:10 UTC) roda "ontem"
create extension if not exists pg_cron;
select cron.unschedule('rollup-events-diario')
  where exists (select 1 from cron.job where jobname = 'rollup-events-diario');
select cron.schedule('rollup-events-diario', '10 3 * * *', $$select public.rollup_events();$$);

-- historico de eventos por dia a partir do rollup (serie longa, sem limite de janela)
create or replace view public.v_eventos_por_dia_hist as
select dia, event, sum(total)::int as total
from public.events_daily
group by 1, 2
order by 1 desc, 2;

grant select on public.v_kpis_30d, public.v_eventos_por_dia, public.v_eventos_por_dia_hist,
                public.v_rolagem, public.v_tempo_pagina, public.v_videos, public.v_referrers,
                public.v_campanhas, public.v_recentes
  to anon;

-- ========== RPC do painel (novva-crm.html) ==========
-- Um unico endpoint que devolve TODOS os blocos do painel para um
-- intervalo de datas. O painel chama POST /rest/v1/rpc/rpc_dashboard
-- com { "d_from": "YYYY-MM-DD", "d_to": "YYYY-MM-DD" } e os botoes de
-- periodo (Hoje / 7 / 14 / 30 / 45 / 60 / 90) so mudam essas datas.
-- nome completo do estado -> sigla (UF). ipwho.is as vezes manda "Rio de Janeiro"
-- em vez de "RJ"; isso normaliza para nao duplicar linhas no painel.
create or replace function public.uf_sigla(nome text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(nome, '')))
    when 'acre' then 'AC'
    when 'alagoas' then 'AL'
    when 'amapá' then 'AP' when 'amapa' then 'AP'
    when 'amazonas' then 'AM'
    when 'bahia' then 'BA'
    when 'ceará' then 'CE' when 'ceara' then 'CE'
    when 'distrito federal' then 'DF' when 'federal district' then 'DF'
    when 'espírito santo' then 'ES' when 'espirito santo' then 'ES'
    when 'goiás' then 'GO' when 'goias' then 'GO'
    when 'maranhão' then 'MA' when 'maranhao' then 'MA'
    when 'mato grosso' then 'MT'
    when 'mato grosso do sul' then 'MS'
    when 'minas gerais' then 'MG'
    when 'pará' then 'PA' when 'para' then 'PA'
    when 'paraíba' then 'PB' when 'paraiba' then 'PB'
    when 'paraná' then 'PR' when 'parana' then 'PR'
    when 'pernambuco' then 'PE'
    when 'piauí' then 'PI' when 'piaui' then 'PI'
    when 'rio de janeiro' then 'RJ'
    when 'rio grande do norte' then 'RN'
    when 'rio grande do sul' then 'RS'
    when 'rondônia' then 'RO' when 'rondonia' then 'RO'
    when 'roraima' then 'RR'
    when 'santa catarina' then 'SC'
    when 'são paulo' then 'SP' when 'sao paulo' then 'SP'
    when 'sergipe' then 'SE'
    when 'tocantins' then 'TO'
    else null
  end;
$$;

-- backfill: preenche region_code das linhas antigas a partir do nome do estado
update public.events
set region_code = public.uf_sigla(region)
where region_code is null and region is not null
  and public.uf_sigla(region) is not null;

-- security definer: roda como dona da tabela (anon nao tem SELECT em events,
-- so INSERT) e devolve apenas agregados, sem PII.
create or replace function public.rpc_dashboard(d_from date, d_to date)
returns json language sql stable
security definer set search_path = public
as $$
  with base as (
    select * from public.events
    where (created_at at time zone 'America/Sao_Paulo')::date between d_from and d_to
  )
  select json_build_object(
    'kpis', (select json_build_object(
        'pageviews',       count(*) filter (where event = 'PageView'),
        'sessoes',         count(distinct session_id),
        'visitantes',      count(distinct visitor_id),
        'checkouts',       count(*) filter (where event = 'InitiateCheckout'),
        'whatsapp',        count(*) filter (where event = 'Contact'),
        'video_plays',     count(*) filter (where event = 'VideoPlay'),
        'video_completes', count(*) filter (where event = 'VideoComplete')
      ) from base),
    'pv_daily', (select coalesce(json_agg(t order by t.dia), '[]'::json) from (
        select (created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as total
        from base where event = 'PageView' group by 1) t),
    'by_hour', (select coalesce(json_agg(t order by t.hora), '[]'::json) from (
        select extract(hour from (created_at at time zone 'America/Sao_Paulo'))::int as hora,
               count(*) as total
        from base group by 1) t),
    'funnel', (select coalesce(json_agg(t order by t.percent), '[]'::json) from (
        select (props->>'percent')::int as percent, count(*) as total
        from base where event = 'ScrollDepth' group by 1) t),
    'vsl', (select json_build_object(
        'plays',     count(*) filter (where event = 'VideoPlay'     and lower(coalesce(props->>'placement','')) = 'vsl'),
        'p25',       count(*) filter (where event = 'VideoProgress' and lower(coalesce(props->>'placement','')) = 'vsl' and (props->>'percent')::int = 25),
        'p50',       count(*) filter (where event = 'VideoProgress' and lower(coalesce(props->>'placement','')) = 'vsl' and (props->>'percent')::int = 50),
        'p75',       count(*) filter (where event = 'VideoProgress' and lower(coalesce(props->>'placement','')) = 'vsl' and (props->>'percent')::int = 75),
        'p95',       count(*) filter (where event = 'VideoProgress' and lower(coalesce(props->>'placement','')) = 'vsl' and (props->>'percent')::int = 95),
        'completes', count(*) filter (where event = 'VideoComplete' and lower(coalesce(props->>'placement','')) = 'vsl')
      ) from base),
    'campaigns', (select coalesce(json_agg(t order by t.sessoes desc), '[]'::json) from (
        select coalesce(utm_campaign, '(sem campaign)') as campaign,
               coalesce(utm_source, '')                 as source,
               coalesce(utm_medium, '')                 as medium,
               count(distinct session_id)               as sessoes,
               count(*) filter (where event = 'InitiateCheckout') as checkouts
        from base
        where utm_source is not null or utm_medium is not null or utm_campaign is not null
        group by 1, 2, 3 limit 12) t),
    'geo', (select coalesce(json_agg(t order by t.sessoes desc), '[]'::json) from (
        select case
                 when coalesce(city,'') <> '' then city || coalesce(' - ' || coalesce(region_code, public.uf_sigla(region), region), '')
                 when coalesce(region,'') <> '' then region
                 else '(sem local)'
               end as local,
               count(distinct session_id) as sessoes,
               count(distinct session_id) filter (where event = 'InitiateCheckout') as checkouts,
               count(distinct session_id) filter (where event = 'Contact') as whatsapp
        from base group by 1 order by sessoes desc limit 15) t),
    'geo_points', (select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from (
        select session_id, lat, lon, city, region, created_at from (
          select distinct on (session_id) session_id, lat, lon, city, region, created_at
          from base
          where lat is not null and lon is not null
          order by session_id, created_at desc
        ) s
        order by created_at desc
        limit 500) t)
  );
$$;

grant execute on function public.rpc_dashboard(date, date) to anon;

notify pgrst, 'reload schema';
```

> **Geo (Localização):** as colunas `country / region / city` já existem mas
> ficam vazias — o coletor atual não captura IP. Para popular, o caminho é
> uma **Supabase Edge Function** que recebe o evento, lê o IP da requisição,
> resolve país/estado/cidade e insere. Enquanto isso o painel mostra
> "sem dados de localização".

## 3. Pegar as credenciais

Supabase → **Project Settings → API**:

- **Project URL** → `https://xxxxxxxx.supabase.co`
- **anon / public key** → chave longa `eyJ...`

A anon key é **pública por design** — ela só consegue `INSERT` em `events` e
`SELECT` nas views agregadas. Pode ir no código do site (repo público) sem
problema, desde que o SQL acima tenha sido rodado como está.

## 4. Preencher no site

Em **dois arquivos**, no bloco de config no topo do `<script>`:

- `index.html` → `var ANALYTICS = { url: 'https://xxxx.supabase.co/rest/v1/events', key: 'eyJ...' }`
- `trafego.html` → `var SUPABASE_URL = 'https://xxxx.supabase.co'` e `var SUPABASE_KEY = 'eyJ...'`

Commit + push → o deploy FTP publica os dois.

## 5. Conferir

- Abrir o site, aba **Network** → deve haver `POST .../rest/v1/events` com status **201**.
- Supabase → **Table Editor → events** → linhas aparecendo.
- Abrir `https://SEU-DOMINIO/novva-crm.html` → números carregando.

## 6. Pendências / cuidados

- **LGPD**: citar o coletor próprio na política de privacidade; definir retenção
  (ex.: apagar linhas com mais de 12–18 meses via job agendado); não guardamos IP.
- **Bots**: o endpoint aceita INSERT anônimo — se aparecer spam, criar uma Edge
  Function com segredo + rate limit, ou filtrar por `ua` nas queries.
- **`novva-crm.html` é público** no domínio (não tem pasta protegendo). Só
  mostra agregados (sem PII), mas convém renomear pra algo não óbvio (ex.:
  `painel-7k2x.html`) e/ou proteger por `.htaccess` na TurboCloud.
- **Dashboard mais robusto** depois: Metabase (free) ou Grafana Cloud (free)
  conectados na connection string Postgres do Supabase.

## 7. Localização (geo) — Edge Function `collect`

Para o painel "Localização" ter dados, o site passa a mandar os eventos para
uma **Edge Function** em vez de inserir direto na tabela. A função lê o IP da
requisição, resolve país/estado/cidade (serviço grátis `ipwho.is`, sem chave)
e grava a linha com a service role key (server-side).

### 7.1. Criar a função pelo painel (sem CLI)

1. Supabase → menu esquerdo → **Edge Functions** → **Deploy a new function** →
   **Via editor** (editor no navegador).
2. Nome: **`collect`**.
3. Apague **todo** o conteúdo do `index.ts` e cole o código abaixo
   (ele já inclui a 1ª linha de type defs que o editor mostra):

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: collect — recebe evento do site, resolve geo por IP, grava em public.events
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const cut = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).slice(0, 200);
  return s.length ? s : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: cors });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors }); }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  let country: string | null = null, region: string | null = null, regionCode: string | null = null, city: string | null = null;
  let lat: number | null = null, lon: number | null = null;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const privado = !ip || ip === "127.0.0.1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.");
  if (!privado) {
    try {
      const r = await fetch(`https://ipwho.is/${ip}?fields=success,country,region,region_code,city,latitude,longitude`, { signal: AbortSignal.timeout(1500) });
      const g = await r.json();
      console.log("geo lookup", JSON.stringify({ ip, status: r.status, g }));
      if (g?.success) {
        country = cut(g.country); region = cut(g.region); regionCode = cut(g.region_code); city = cut(g.city);
        lat = num(g.latitude); lon = num(g.longitude);
      }
    } catch (e) { console.log("geo erro", String(e)); }
  }

  const row = {
    visitor_id: (cut(b.visitor_id) ?? "anon").slice(0, 64),
    session_id: cut(b.session_id),
    event: (cut(b.event) ?? "unknown").slice(0, 60),
    props: (b.props && typeof b.props === "object") ? b.props : {},
    path: cut(b.path), referrer: cut(b.referrer),
    screen_w: Number.isFinite(b.screen_w as number) ? b.screen_w : null,
    device: cut(b.device),
    utm_source: cut(b.utm_source), utm_medium: cut(b.utm_medium), utm_campaign: cut(b.utm_campaign),
    utm_term: cut(b.utm_term), utm_content: cut(b.utm_content),
    gclid: cut(b.gclid), fbclid: cut(b.fbclid),
    country, region, region_code: regionCode, city, lat, lon,
  };

  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}`, prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!resp.ok) return new Response(await resp.text(), { status: 500, headers: cors });
  return new Response(null, { status: 204, headers: cors });
});
```

4. **Deploy**. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidos
   (secrets automáticos) — não precisa configurar nada.

### 7.2. Alternativa por CLI

```bash
npm i -g supabase
supabase login
supabase link --project-ref nbhekjgbszyuuxrynzfo
mkdir -p supabase/functions/collect && $EDITOR supabase/functions/collect/index.ts   # cole o código acima
supabase functions deploy collect
```

### 7.3. O site já aponta pra função

No `index.html` o `ANALYTICS.url` agora é
`https://nbhekjgbszyuuxrynzfo.supabase.co/functions/v1/collect` (antes era
`/rest/v1/events`). Enquanto a função não existir, os eventos param — depois do
deploy voltam a fluir, já com `country/region/city`.

### 7.4. Conferir

- Site → **Network** → `POST .../functions/v1/collect` status **204**.
- Supabase → **Table Editor → events** → colunas `country/region/city` preenchidas.
- **Edge Functions → collect → Logs** mostra as invocações.

> A policy `anon insere eventos` continua válida como fallback. `ipwho.is` grátis
> aguenta o volume previsto (~1500/dia); se um dia estourar, troca a URL do geo
> por outro provedor ou um plano pago.

## 8. Tabela de leads do quiz (`quiz.html`)

O quiz de captação (`quiz.html`, Frente B / B1 do `docs/estrategia-marketing-congresso-cancer-2026.md`)
grava cada lead em uma tabela **separada** de `events` — diferente do coletor de
analytics, aqui **tem PII** (nome, WhatsApp, e-mail), então a tabela não é lida
por nenhum painel público e nunca recebe `SELECT` do `anon`.

Rode este bloco no mesmo projeto Supabase (SQL Editor):

```sql
create table if not exists public.quiz_leads (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  visitor_id   text,
  session_id   text,
  nome         text not null,
  whatsapp     text not null,
  email        text,
  profissao    text,
  respostas    jsonb not null default '{}'::jsonb,
  pontuacao    int,
  nivel        text,
  path         text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  fbclid       text
);

create index if not exists quiz_leads_created_at_idx on public.quiz_leads (created_at desc);
create index if not exists quiz_leads_nivel_idx      on public.quiz_leads (nivel);
create index if not exists quiz_leads_campaign_idx   on public.quiz_leads (utm_campaign);

-- RLS: só INSERT pelo anon, igual `events` — ninguém lê PII pela chave pública
alter table public.quiz_leads enable row level security;

drop policy if exists "anon insere quiz leads" on public.quiz_leads;
create policy "anon insere quiz leads"
  on public.quiz_leads for insert
  to anon
  with check (true);

revoke select on public.quiz_leads from anon;

notify pgrst, 'reload schema';
```

### Fluxo: contato primeiro, quiz depois

O `quiz.html` pede nome/WhatsApp/profissão **antes** das 5 perguntas (não
depois). Isso gera **duas gravações** por pessoa que termina o quiz:

1. Ao enviar o contato: 1 linha com `pontuacao`/`nivel` nulos e
   `respostas = {}` — garante o lead mesmo se a pessoa fechar a página no
   meio das perguntas.
2. Ao terminar a 5ª pergunta: outra linha, agora completa, com
   `pontuacao`/`nivel`/`respostas` preenchidos.

Pra analisar: filtre por `whatsapp` — quem só tem a linha "vazia" abandonou o
quiz; quem tem as duas terminou. Não há `UPDATE` na tabela (só `INSERT`), de
propósito, pra não precisar abrir uma policy de update pro `anon`.

### Como conferir os leads

A tabela **não** aparece em nenhum dashboard público — de propósito, pra não
vazar WhatsApp/e-mail. Pra ver os leads:

- Supabase → **Table Editor → quiz_leads** (acesso só de quem loga no projeto).
- Ou, se quiser, peça pra eu montar depois um painel interno protegido por
  senha/login (Supabase Auth) — hoje não existe autenticação no site, então
  esse painel ainda não foi criado.

## 9. Painel do quiz ("Quiz · Raio-X Profissional", `quiz-raiox.html`)

Painel agregado (sem PII) que lê `quiz_leads` cruzado com `events` só pra
classificar a **temperatura** de cada lead — nome/WhatsApp nunca saem daqui,
só contagens. Rode no mesmo projeto (SQL Editor):

```sql
-- ========== Painel do quiz (agregado, sem PII) ==========
-- security definer pq o anon nao tem SELECT em quiz_leads nem em events,
-- so nesta funcao que devolve agregados.
create or replace function public.rpc_quiz_dashboard()
returns json language sql stable
security definer set search_path = public
as $$
  with leads as (
    -- 1 linha por pessoa (visitor_id, com fallback pro whatsapp): pega a
    -- linha completa (nivel preenchido) se existir, senao a parcial.
    select distinct on (coalesce(visitor_id, whatsapp))
      id, visitor_id, whatsapp, profissao, nivel, pontuacao, respostas,
      utm_source, utm_medium, utm_campaign, created_at
    from public.quiz_leads
    order by coalesce(visitor_id, whatsapp), (nivel is not null) desc, created_at desc
  ),
  cta as (
    select distinct visitor_id
    from public.events
    where event in ('InitiateCheckout', 'Contact')
      and props->>'content_name' in ('Quiz CTA Lote', 'WhatsApp via quiz')
  ),
  classificado as (
    select l.*,
      case
        when l.nivel is null then 'frio'
        when c.visitor_id is not null then 'quente'
        else 'morno'
      end as temperatura
    from leads l
    left join cta c on c.visitor_id = l.visitor_id
  )
  select json_build_object(
    'total_contatos',  (select count(*) from classificado),
    'total_completos', (select count(*) from classificado where nivel is not null),
    'temperatura', (select json_build_object(
        'frio',   count(*) filter (where temperatura = 'frio'),
        'morno',  count(*) filter (where temperatura = 'morno'),
        'quente', count(*) filter (where temperatura = 'quente')
      ) from classificado),
    'por_nivel', (select json_build_object(
        'iniciante',     count(*) filter (where nivel = 'iniciante'),
        'intermediario', count(*) filter (where nivel = 'intermediario'),
        'avancado',      count(*) filter (where nivel = 'avancado')
      ) from classificado),
    'por_profissao', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select coalesce(profissao,'(não informado)') as profissao, count(*) as total
        from classificado group by 1) t),
    'por_canal', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select coalesce(utm_source,'(direto)') as canal, count(*) as total
        from classificado group by 1 limit 10) t),
    'por_dia', (select coalesce(json_agg(t order by t.dia), '[]'::json) from (
        select (created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as total
        from classificado group by 1 order by 1 desc limit 30) t),
    'por_pergunta', (select coalesce(json_agg(t order by t.pergunta), '[]'::json) from (
        select elem.ordinality::int as pergunta,
               count(*) filter (where elem.valor = '1') as opcao_a,
               count(*) filter (where elem.valor = '2') as opcao_b,
               count(*) filter (where elem.valor = '3') as opcao_c
        from classificado c
        cross join lateral jsonb_array_elements_text(c.respostas->'respostas') with ordinality as elem(valor, ordinality)
        where c.nivel is not null
        group by 1) t)
  );
$$;

grant execute on function public.rpc_quiz_dashboard() to anon;
notify pgrst, 'reload schema';
```

O painel chama `POST /rest/v1/rpc/rpc_quiz_dashboard` (sem parâmetros) e
recebe só esse JSON agregado — nenhuma linha individual de `quiz_leads` sai
pela chave `anon`.

## 10. Antes de publicar o `quiz.html`

- Trocar `SITE_URL` no `<script>` do `quiz.html` pelo domínio real (hoje é um
  placeholder), e conferir se o link `index.html#lotes?utm_...` cai na seção
  certa da página.
- O número de WhatsApp usado é o mesmo do botão flutuante do site
  (`5511934873737`) — trocar se for outro.
- **Rodar o SQL acima antes de divulgar o link** — sem a tabela `quiz_leads`
  criada, o envio do formulário falha (o quiz mostra erro e deixa a pessoa
  tentar de novo, mas não perde as respostas já dadas).

## 11. ROI (investimento vs. vendas) — aba "Tráfego & Conversão"

Duas tabelas novas, sem relação com `events`/`quiz_leads`, pra responder
"quanto investi" e "quanto voltou em venda":

- **`investimentos`** — lançamento manual de gasto (não tem integração com
  Meta Ads ainda; quando a conta de anúncios for autorizada, dá pra puxar
  automático depois, mas por enquanto é um formulário simples no painel).
- **`vendas`** — alimentada por um **webhook da Eduzz**: toda vez que uma
  venda é confirmada, a Eduzz chama uma Edge Function nossa, que grava a
  linha (produto/Lote, valor, status).

> ⚠️ **Aviso de honestidade:** não tenho certeza absoluta de como a Eduzz
> nomeia os campos no payload do webhook dela hoje (isso varia por conta/API
> e muda com o tempo). A função abaixo tenta alguns nomes comuns, mas
> **sempre grava o payload bruto** na coluna `raw` — então nada se perde
> mesmo que o mapeamento inicial erre. Depois de configurar o postback na
> Eduzz e fazer uma venda de teste, olhe a coluna `raw` na tabela `vendas` e
> me mande o que caiu lá pra eu ajustar os nomes de campo certos.

Rode no SQL Editor:

```sql
-- ---------- investimentos (lançamento manual de gasto) ----------
create table if not exists public.investimentos (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  data        date not null default current_date,
  canal       text,        -- ex: 'meta_ads', 'google_ads', 'organico' (opcional)
  descricao   text,
  valor       numeric(10,2) not null
);

alter table public.investimentos enable row level security;

drop policy if exists "anon insere investimento" on public.investimentos;
create policy "anon insere investimento"
  on public.investimentos for insert
  to anon
  with check (true);

revoke select on public.investimentos from anon;

-- ---------- vendas (alimentada pelo webhook da Eduzz, não pelo anon) ----------
create table if not exists public.vendas (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  eduzz_id      text,
  produto       text,
  produto_cod   text,
  valor         numeric(10,2),
  status        text,
  cliente_nome  text,
  cliente_email text,
  raw           jsonb not null default '{}'::jsonb
);

create index if not exists vendas_produto_idx    on public.vendas (produto);
create index if not exists vendas_created_at_idx on public.vendas (created_at desc);

alter table public.vendas enable row level security;
-- sem policy de insert pro anon: só a Edge Function (service role) escreve aqui.
revoke all on public.vendas from anon;

-- ---------- RPC agregado (sem PII, exposto pro painel) ----------
-- status "pago"/"paga"/"pagamento" (chute inicial em pt) OU "paid" (valor real
-- confirmado na doc oficial da Eduzz pro evento myeduzz.invoice_paid) contam
-- como venda paga; status vazio/NULL entra como "sem status informado" (não soma).
create or replace function public.rpc_roi()
returns json language sql stable
security definer set search_path = public
as $$
  select json_build_object(
    'total_investido', (select coalesce(sum(valor),0) from public.investimentos),
    'total_vendas',    (select coalesce(sum(valor),0) from public.vendas where status ilike 'pag%' or status ilike 'paid'),
    'qtd_vendas',      (select count(*) from public.vendas where status ilike 'pag%' or status ilike 'paid'),
    'por_produto', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select coalesce(produto,'(sem produto)') as produto,
               count(*) as qtd,
               sum(valor) as total
        from public.vendas
        where status ilike 'pag%' or status ilike 'paid'
        group by 1) t),
    'por_canal', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select coalesce(nullif(utm_campaign,''), '(direto)') as canal,
               coalesce(nullif(utm_source,''), '')            as origem,
               count(*) as qtd,
               sum(valor) as total
        from public.vendas
        where status ilike 'pag%' or status ilike 'paid'
        group by 1, 2) t)
  );
$$;

grant execute on function public.rpc_roi() to anon;
notify pgrst, 'reload schema';
```

### 11.1. Vendas por canal (vendedor/podcast) — UTM até dentro da Eduzz

**Por quê (16/09/2026):** pra medir venda **de verdade** por vendedor
(Gisele, Juliana) ou canal (Podcast do Fernando Beteti), não basta marcar
UTM só na URL do nosso site — a Eduzz não herda isso sozinha. Segundo a
documentação oficial
([Como rastrear UTM e Afiliados pelo link da página de vendas](https://ajuda.eduzz.com/hc/pt-br/articles/4402912683803-Como-rastrear-UTM-e-Afiliados-pelo-link-da-p%C3%A1gina-de-vendas)),
quando se divulga por uma página de vendas própria (o nosso `index.html`),
é preciso repassar os parâmetros UTM pra URL do checkout — é exatamente
isso que o script novo em `index.html` faz (§ próxima seção). Depois de
paga, a fatura carrega esses UTMs de volta no payload do webhook, em
`data.utm.source` / `campaign` / `medium` / `content` / `term`
([referência oficial do payload](https://developers.eduzz.com/reference/webhook/myeduzz-invoice-paid)).

```sql
alter table public.vendas
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text;

create index if not exists vendas_utm_campaign_idx on public.vendas (utm_campaign);

notify pgrst, 'reload schema';
```

Depois de rodar isso, **reaplique a função `rpc_roi()` acima** (já
atualizada com o campo `por_canal`) e **redeploy o `eduzz-webhook`**
(código atualizado na seção 11.2 abaixo) — os dois precisam estar
juntos pra o painel mostrar dado de verdade.

### 11.2. Links de rastreamento por vendedor/canal (já prontos)

```
Time Comercial (Gisele/Juliana):
https://congressocancer.novvasaudeintegrativa.com.br/?utm_source=time-comercial&utm_medium=vendedora&utm_campaign=time-comercial

Podcast (Fernando Beteti):
https://congressocancer.novvasaudeintegrativa.com.br/?utm_source=podcast&utm_medium=fernando-beteti&utm_campaign=podcast-fernando-beteti
```

Também aparecem prontos pra copiar direto no `novva-crm.html` (seção ROI).

### Edge Function `eduzz-webhook`

Supabase → **Edge Functions** → **Deploy a new function** → nome **`eduzz-webhook`**
→ editor no navegador → apague tudo e cole:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: eduzz-webhook — recebe notificação de venda da Eduzz e grava em public.vendas
// Os nomes de campo abaixo são um palpite dos mais comuns na Eduzz; o payload
// inteiro sempre vai pra coluna `raw`, então dá pra corrigir o mapeamento
// depois sem perder nenhuma venda já recebida.

// .trim() nos dois lados: cola-e-cola em campo de texto às vezes deixa uma
// quebra de linha sobrando no final do secret — sem o trim, isso quebra a
// comparação de um jeito invisível (as strings "parecem" iguais mas não são).
const SECRET = Deno.env.get("EDUZZ_WEBHOOK_SECRET")?.trim(); // opcional — defina como secret do projeto

function pick(body: any, paths: string[]) {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), body);
    if (v != null && v !== "") return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  if (SECRET) {
    const token = new URL(req.url).searchParams.get("token")?.trim();
    if (token !== SECRET) return new Response("unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    try { body = Object.fromEntries((await req.formData()).entries()); }
    catch { return new Response("bad body", { status: 400 }); }
  }

  const row = {
    eduzz_id:      String(pick(body, ["data.id", "cod_transacao", "trans_cod", "id"]) ?? ""),
    produto:       pick(body, ["data.items.0.name", "nome_produto", "product_name", "titulo_conteudo"]),
    produto_cod:   String(pick(body, ["data.items.0.productId", "cod_produto", "product_id"]) ?? ""),
    valor:         Number(pick(body, ["data.price.value", "valor_total", "total_value", "valor"]) ?? 0),
    status:        String(pick(body, ["data.status", "situacao", "status"]) ?? ""),
    cliente_nome:  pick(body, ["data.buyer.name", "nome_cliente", "customer_name"]),
    cliente_email: pick(body, ["data.buyer.email", "email_cliente", "customer_email"]),
    // UTM: a Eduzz so devolve isso se a URL do checkout ja chegou com os
    // parametros (ver index.html, que repassa os UTMs capturados no site
    // pro link chk.eduzz.com antes do clique) — path oficial em data.utm.*
    utm_source:    pick(body, ["data.utm.source", "utm_source"]),
    utm_medium:    pick(body, ["data.utm.medium", "utm_medium"]),
    utm_campaign:  pick(body, ["data.utm.campaign", "utm_campaign"]),
    utm_content:   pick(body, ["data.utm.content", "utm_content"]),
    utm_term:      pick(body, ["data.utm.term", "utm_term"]),
    raw: body
  };

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/vendas`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}`, prefer: "return=minimal" },
    body: JSON.stringify(row)
  });
  if (!resp.ok) return new Response(await resp.text(), { status: 500 });
  return new Response("ok", { status: 200 });
});
```

**Deploy.** `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidos
automaticamente. Se quiser travar contra chamadas falsas, adicione um secret
`EDUZZ_WEBHOOK_SECRET` (Edge Functions → Secrets) com um valor aleatório, e
configure na Eduzz a URL do postback já com `?token=SEUVALOR` no final.

### Configurar na Eduzz

**Status: configurado e testado (09/09/2026).** Postback ativo, evento
"Fatura paga" caindo em `vendas` com os campos certos.

No painel da Eduzz (Developer Hub → Webhook → Configurações → Criar
configuração), o evento certo é **`myeduzz.invoice_paid`** ("Fatura paga",
dentro do app **MyEduzz** na lista de eventos) — cobre boleto, cartão e pix
num evento só. Payload documentado em
https://developers.eduzz.com/reference/webhook/myeduzz-invoice-paid (é de
onde vêm os caminhos `data.id`, `data.items.0.name` etc. usados acima).

Cadastre a URL: com o token do secret (`?token=...`), e **desligue "Verify
JWT with legacy secret"** nas configurações da função (Edge Functions →
eduzz-webhook → Settings) — sem isso o Supabase bloqueia a chamada da Eduzz
antes mesmo dela chegar na função, com 401 mesmo com o token certo.

```
https://nbhekjgbszyuuxrynzfo.supabase.co/functions/v1/eduzz-webhook?token=SEUVALOR
```

**Pegadinha do campo de secret:** o campo "Value" em Edge Functions →
Secrets aceita múltiplas linhas — ao colar, é fácil sobrar uma quebra de
linha no final, o que quebra a comparação de um jeito invisível (o valor
"parece" igual mas não é). Por isso o código já faz `.trim()` nos dois
lados antes de comparar; não precisa recriar o secret com cuidado
cirúrgico.

Pra validar: faça uma venda de teste (ou peça pra Eduzz reenviar a
notificação de uma venda antiga, ou use "Testar eventos selecionados" no
painel da Eduzz) e confira **Table Editor → vendas** — se a linha aparecer
com `produto`/`valor` vazios mas `raw` preenchido, me manda o conteúdo de
`raw` pra eu corrigir o mapeamento de campos.

## 12. Editar/apagar lançamento de investimento — Edge Function `investimentos-admin`

A tabela `investimentos` só aceita **insert** do `anon` (a mesma chave
pública que já está no código-fonte do site) — de propósito, sem select,
update ou delete. Se abríssemos update/delete pro `anon` diretamente,
qualquer pessoa que copiasse essa chave do código-fonte (é pública, dá pra
ver no DevTools de qualquer navegador) poderia editar ou apagar os
lançamentos de todo mundo, sem controle nenhum.

Pra editar/apagar com alguma proteção, sem esperar login de equipe de
verdade (Fase 1 do CRM), usamos o mesmo padrão do `eduzz-webhook`: uma
Edge Function que só age se receber um token secreto (`?token=` /
`body.token`) que só o painel + quem tem a senha conhece. **Isso não é
autenticação de usuário de verdade** — é uma trava simples, suficiente
pra impedir acesso casual pela chave pública, mas qualquer um com o token
consegue editar/apagar qualquer lançamento (não é por vendedor). Trocar
por Supabase Auth quando a Fase 1 do CRM for construída.

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`investimentos-admin`** → editor no navegador → apague tudo e cole:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SECRET = Deno.env.get("INVESTIMENTOS_ADMIN_TOKEN")?.trim();

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("bad body", { status: 400 }); }

  const token = String(body.token ?? "").trim();
  if (!SECRET || token !== SECRET) return new Response("unauthorized", { status: 401 });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers = { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` };

  if (body.action === "list") {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/investimentos?select=*&order=data.desc,id.desc`, { headers });
    return new Response(await resp.text(), { status: resp.status, headers: { "content-type": "application/json" } });
  }

  if (body.action === "update") {
    const id = Number(body.id);
    if (!id) return new Response("missing id", { status: 400 });
    const patch: Record<string, unknown> = {};
    if (body.data !== undefined) patch.data = body.data;
    if (body.canal !== undefined) patch.canal = body.canal;
    if (body.descricao !== undefined) patch.descricao = body.descricao;
    if (body.valor !== undefined) patch.valor = Number(body.valor);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/investimentos?id=eq.${id}`, {
      method: "PATCH", headers: { ...headers, prefer: "return=minimal" }, body: JSON.stringify(patch)
    });
    if (!resp.ok) return new Response(await resp.text(), { status: 500 });
    return new Response("ok", { status: 200 });
  }

  if (body.action === "delete") {
    const id = Number(body.id);
    if (!id) return new Response("missing id", { status: 400 });
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/investimentos?id=eq.${id}`, {
      method: "DELETE", headers: { ...headers, prefer: "return=minimal" }
    });
    if (!resp.ok) return new Response(await resp.text(), { status: 500 });
    return new Response("ok", { status: 200 });
  }

  return new Response("unknown action", { status: 400 });
});
```

**Deploy.** Deixe **"Verify JWT with legacy secret" LIGADO** nesta função
(diferente do `eduzz-webhook`) — o painel já manda a chave anon como
`Authorization: Bearer` em toda chamada, então não custa manter essa
camada extra; quem chama de fora sem essa chave nem chega no nosso código.

Adicione o secret **`INVESTIMENTOS_ADMIN_TOKEN`** (Edge Functions →
Secrets) com um valor aleatório — é a senha que o painel vai pedir pra
liberar editar/apagar.

O painel (`trafego.html`, seção ROI) tem um link "Gerenciar
lançamentos" que pede esse token uma vez (fica salvo só nesse
navegador) e mostra a lista com editar/apagar inline.

## 13. CRM — Fase 1 (login de equipe + pipeline de leads reais)

Substitui a Kommo pra **gestão de leads** (não pra conversa de WhatsApp —
isso é Fase 2, depende da API do Meta). Tela nova `crm.html` atrás de
login: cada vendedor vê a carteira dele, gestor vê e distribui tudo.

**Conceito de "lead" aqui:** uma **pessoa** (identificada pelo WhatsApp),
não uma linha de `quiz_leads`. Como o quiz grava 2 linhas por pessoa
(contato + quiz completo), o CRM lê de uma **view deduplicada**.

### 13.1. SQL — rodar uma vez no SQL Editor

```sql
-- ---------- perfis da equipe (liga em auth.users) ----------
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  papel      text not null default 'vendedor' check (papel in ('gestor','vendedor')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
alter table public.perfis enable row level security;

-- helper: o usuário atual é gestor? (security definer = lê perfis SEM acionar
-- RLS; precisa vir ANTES das policies que o usam, senão a criação falha)
create or replace function public.eh_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'gestor' from public.perfis where id = auth.uid()), false);
$$;
revoke execute on function public.eh_gestor() from public, anon;
grant execute on function public.eh_gestor() to authenticated;

drop policy if exists "equipe lê perfis" on public.perfis;
create policy "equipe lê perfis" on public.perfis
  for select to authenticated using (true);

-- NÃO fazer subquery direta em perfis aqui dentro (recursão infinita de RLS) —
-- usar eh_gestor(), que é security definer.
drop policy if exists "gestor edita perfis" on public.perfis;
create policy "gestor edita perfis" on public.perfis
  for all to authenticated
  using  (public.eh_gestor())
  with check (public.eh_gestor());

-- ---------- view: 1 linha por pessoa (dedupe da quiz_leads pelo whatsapp) ----------
-- security_invoker = true: a view respeita o RLS de quem consulta, então o
-- anon (sem policy de select em quiz_leads) não enxerga nada por ela.
create or replace view public.crm_leads with (security_invoker = true) as
  select distinct on (whatsapp)
    whatsapp,
    nome, email, profissao, nivel, pontuacao,
    utm_source, utm_medium, utm_campaign,
    created_at as captado_em
  from public.quiz_leads
  where whatsapp is not null and whatsapp <> ''
  order by whatsapp, (pontuacao is not null) desc, created_at desc;

revoke all on public.crm_leads from anon, public;

-- ---------- estado do lead no CRM (chave = whatsapp da pessoa) ----------
create table if not exists public.lead_status (
  whatsapp        text primary key,
  atribuido_a     uuid references auth.users(id),
  etapa           text not null default 'novo'
                  check (etapa in ('novo','contato','conversando','proposta','ganho','perdido')),
  nota            text,
  urgente         boolean not null default false,
  atualizado_por  uuid references auth.users(id),
  atualizado_em   timestamptz not null default now(),
  criado_em       timestamptz not null default now()
);
alter table public.lead_status enable row level security;

-- trigger: só gestor muda o responsável; carimba quem/quando atualizou
create or replace function public.guarda_lead_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.atribuido_a is distinct from old.atribuido_a
     and not public.eh_gestor() then
    raise exception 'só gestor pode mudar o vendedor responsável';
  end if;
  new.atualizado_por := auth.uid();
  new.atualizado_em  := now();
  return new;
end;
$$;
drop trigger if exists lead_status_guarda on public.lead_status;
create trigger lead_status_guarda before insert or update on public.lead_status
  for each row execute function public.guarda_lead_status();

-- RLS lead_status: gestor tudo; vendedor só os dele + os marcados urgente
drop policy if exists "vê lead_status" on public.lead_status;
create policy "vê lead_status" on public.lead_status
  for select to authenticated
  using (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true);

drop policy if exists "insere lead_status" on public.lead_status;
create policy "insere lead_status" on public.lead_status
  for insert to authenticated with check (true);

drop policy if exists "edita lead_status" on public.lead_status;
create policy "edita lead_status" on public.lead_status
  for update to authenticated
  using (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true)
  with check (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true);

drop policy if exists "gestor apaga lead_status" on public.lead_status;
create policy "gestor apaga lead_status" on public.lead_status
  for delete to authenticated using (public.eh_gestor());

-- ---------- quiz_leads: liberar SELECT só pra quem loga (anon continua fora) ----------
drop policy if exists "equipe lê quiz_leads" on public.quiz_leads;
create policy "equipe lê quiz_leads" on public.quiz_leads
  for select to authenticated using (true);

grant select on public.crm_leads to authenticated;

-- ---------- RPC: pipeline pronto pro crm.html ----------
-- security definer, mas o 1º filtro exige que quem chama seja membro ativo
-- da equipe (senão retorna vazio) — sem isso, o "or urgente" deixaria
-- qualquer não-logado ler PII de lead urgente.
create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc), '[]'::json)
  from (
    select
      l.whatsapp, l.nome, l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign, l.captado_em,
      s.etapa, s.nota, s.urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em
    from public.crm_leads l
    left join public.lead_status s on s.whatsapp = l.whatsapp
    left join public.perfis pa on pa.id = s.atribuido_a
    where
      exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
      and (public.eh_gestor() or s.atribuido_a = auth.uid() or s.urgente = true)
  ) t;
$$;
revoke execute on function public.rpc_crm_pipeline() from public, anon;
grant execute on function public.rpc_crm_pipeline() to authenticated;

notify pgrst, 'reload schema';
```

### 13.2. Ativar o login (Supabase Auth)

1. **Authentication → Providers → Email**: liga o provider **Email**.
   Desliga "Confirm email" (equipe pequena, senha definida pelo gestor) —
   ou deixa ligado e cada um confirma pelo e-mail.
2. **Authentication → Users → Add user**: cria as contas (gestor + 2
   vendedores) com e-mail + senha.
3. Pra cada conta criada, pega o `id` (UUID) do usuário (Authentication →
   Users → clica no usuário) e roda:
   ```sql
   insert into public.perfis (id, nome, papel) values
     ('<uuid-do-gestor>',     'Novva (gestor)',    'gestor'),   -- novvasaudeintegrativa@gmail.com
     ('<uuid-do-vendedor-1>', 'Nome do Vendedor 1','vendedor'),
     ('<uuid-do-vendedor-2>', 'Nome do Vendedor 2','vendedor');
   ```
4. Adicionar um 3º vendedor depois = repetir os passos 2-3, sem mexer em
   mais nada.

### 13.3. Estado — Fase 1 CONCLUÍDA e testada (10/09/2026)

- Login funcionando: `novvasaudeintegrativa@gmail.com` (papel gestor).
- SMTP: Gmail (`smtp.gmail.com:465`, senha de app) configurado em
  Authentication -> Emails, porque o e-mail nativo do Supabase é limitado
  a ~2-4/hora.
- **Pegadinha 1 (resolvida):** senha via SQL precisa de custo bcrypt 10 —
  `crypt(senha, gen_salt('bf', 10))`. Sem o `10` o GoTrue recusa.
- **Pegadinha 2 (resolvida):** policy `for all` em `perfis` que chama
  função lendo `perfis` = recursão. Separada em insert/update/delete.
- **Pegadinha 3 (resolvida, no `crm.html`):** `#login{display:flex}` ganhava
  do atributo `hidden` -> a tela de login nunca sumia. Fix: `[hidden]{display:none!important}`.
- **Pegadinha 4 (resolvida, no `crm.html`):** supabase-js trava num lock
  interno na 1ª chamada `.from()` pós-login -> o `crm.html` lê dados por
  `fetch` REST direto com o token, usa supabase-js só pra auth.

### 13.4. O que o `crm.html` faz

- Login (Supabase Auth, e-mail/senha) — sem sessão, sem acesso.
- Pipeline Kanban por `etapa`, lido de `rpc_crm_pipeline()`.
- Card do lead: nome, nível (frio/morno/quente), profissão, origem (UTM),
  botão "abrir conversa" (`wa.me/<whatsapp>`), nota, toggle "urgente".
- Gestor: coluna extra de leads **não triados** (sem `lead_status`) pra
  distribuir; muda `atribuido_a` de qualquer lead.
- Vendedor: vê só a carteira + os urgentes; muda `etapa`/`nota`/`urgente`,
  **não** muda o responsável (trigger barra).

## 14. CRM — Fase 2 (receber mensagens do WhatsApp via Cloud API)

**Estado do lado da Meta (10/09/2026):** WABA `885985207685253` ("Novva
Saúde Integrativa"), número `+55 11 93487-3737`, Phone Number ID
`1039296279264556`, empresa verificada, número Conectado / qualidade Alta,
sem BSP. App **"Novva CRM"** criado no portfólio "Saúde Integrativa".

Esta fase **só recebe** mensagens (grava em `mensagens`). Responder de
dentro do CRM e mandar template é fase seguinte (precisa de token de envio
+ forma de pagamento + app publicado).

### 14.1. SQL — tabela `mensagens`

```sql
create table if not exists public.mensagens (
  id             bigint generated always as identity primary key,
  criado_em      timestamptz not null default now(),
  wa_message_id  text unique,           -- id no WhatsApp, usado pra dedupe
  lead_whatsapp  text not null,         -- número em dígitos (ex "5511934873737")
  direcao        text not null check (direcao in ('recebida','enviada')),
  tipo           text,                  -- text, image, audio, button...
  texto          text,
  status         text,                  -- enviadas: sent/delivered/read/failed
  wa_timestamp   timestamptz,
  raw            jsonb not null default '{}'::jsonb
);
create index if not exists mensagens_lead_idx on public.mensagens (lead_whatsapp, criado_em);
alter table public.mensagens enable row level security;

-- só quem loga e enxerga o lead vê as mensagens dele (mesma regra do lead_status)
drop policy if exists "equipe vê mensagens" on public.mensagens;
create policy "equipe vê mensagens" on public.mensagens
  for select to authenticated
  using (
    exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
    and (
      public.eh_gestor()
      or exists (
        select 1 from public.lead_status s
        where s.whatsapp = mensagens.lead_whatsapp
          and (s.atribuido_a = auth.uid() or s.urgente = true)
      )
    )
  );

-- ninguém escreve por aqui a não ser a Edge Function (service role)
revoke insert, update, delete on public.mensagens from anon, authenticated;

notify pgrst, 'reload schema';
```

> **Nota de formato:** o WhatsApp entrega o número em dígitos sem `+`
> (`5511934873737`). O `quiz_leads.whatsapp` foi digitado pela pessoa e
> pode vir em outro formato (`(11) 93487-3737`). Casar `mensagens` com
> `crm_leads`/`lead_status` vai precisar de uma normalização (só dígitos,
> com/sem DDI 55) — fica pra quando ligarmos a conversa no `crm.html`.

### 14.2. Edge Function `whatsapp-webhook`

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`whatsapp-webhook`** → editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET   = Deno.env.get("WHATSAPP_APP_SECRET")?.trim(); // opcional: valida X-Hub-Signature-256

async function assinaturaOk(req: Request, body: string): Promise<boolean> {
  if (!APP_SECRET) return true;               // sem secret, não valida
  const sig = req.headers.get("x-hub-signature-256");
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sig === `sha256=${hex}`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // verificação do webhook (Meta faz um GET quando você salva a URL)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const bodyText = await req.text();
  if (!(await assinaturaOk(req, bodyText))) return new Response("bad signature", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(bodyText); } catch { return new Response("bad json", { status: 400 }); }

  const linhas: Record<string, unknown>[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        linhas.push({
          wa_message_id: m.id,
          lead_whatsapp: m.from,
          direcao: "recebida",
          tipo: m.type ?? null,
          texto: m.text?.body ?? m.button?.text ??
                 m.interactive?.button_reply?.title ??
                 m.interactive?.list_reply?.title ?? null,
          wa_timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          raw: m,
        });
      }
      for (const s of v.statuses ?? []) {
        linhas.push({
          wa_message_id: s.id,
          lead_whatsapp: s.recipient_id,
          direcao: "enviada",
          status: s.status ?? null,
          wa_timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
        });
      }
    }
  }

  if (linhas.length) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/mensagens?on_conflict=wa_message_id`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linhas),
    });
    // nunca devolve erro pra Meta (ela reenvia em loop) — só loga
    if (!resp.ok) console.error("insert mensagens:", resp.status, await resp.text());
  }

  // Cris responde os leads sob controle dela (ver §16) — nunca deixa a
  // Meta esperar por isso, então roda depois do "ok" de verdade não dá,
  // mas cada erro individual só loga e não derruba o webhook.
  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
```

**Deploy.** Depois de publicar, **desliga "Verify JWT with legacy secret"**
(Edge Functions → whatsapp-webhook → Settings) — a Meta chama sem JWT do
Supabase, igual o `eduzz-webhook`.

> O código acima já pressupõe as peças da Cris (`svcHeaders`, `SUPABASE_URL`,
> `numerosRecebidos`, `deixarCrisResponder`) — o arquivo completo pra colar
> de uma vez está em **§16.2**, não só esse trecho.

**Secrets** (Edge Functions → Secrets):
- `WHATSAPP_VERIFY_TOKEN` = `442dff951c8b79e114f4efc555a6f6f26beb1880`
- `WHATSAPP_APP_SECRET` = a "Chave secreta do app" (Novva CRM → Configurações do app → Básico) — opcional mas recomendado; sem ele a função aceita qualquer POST.

### 14.3. Configurar o webhook no app (Meta)

No app **Novva CRM** → Etapa 2 → **Configurar webhooks**:
- **URL de callback:** `https://nbhekjgbszyuuxrynzfo.supabase.co/functions/v1/whatsapp-webhook`
- **Verificar token:** `442dff951c8b79e114f4efc555a6f6f26beb1880`
- Salvar (a Meta faz um GET de verificação na hora — a função responde o challenge).
- Depois, em **Campos de webhook**, assina o campo **`messages`**.

### 14.4. Estado (10/09/2026) — RECEBER está pronto e testado com mensagem real ✅

- App ID **`1081100977750031`**, App **publicado** (Live).
- WABA assinada no app via Graph API:
  `POST /885985207685253/subscribed_apps` → `{"success": true}`
  (feito uma vez, persiste — não precisa refazer).
- Campo `messages` assinado no app.
- Teste com WhatsApp real → linha em `mensagens` com `direcao='recebida'`. OK.

### 14.5. Fase 3 — responder de dentro do CRM (ainda não feito)

1. **Token permanente** — o de envio precisa ser de Usuário do Sistema
   (Configurações do Negócio → Usuários do Sistema → gerar token com
   `whatsapp_business_messaging` + `whatsapp_business_management`). O token
   do Graph API Explorer é temporário (~1h), serviu só pro subscribe.
2. **Normalizar telefone** — casar `mensagens.lead_whatsapp` (dígitos, ex
   `553284040133`) com `crm_leads.whatsapp` (digitado pela pessoa).
3. **Forma de pagamento** na WABA — só pra mandar fora da janela de 24h
   (template). Resposta dentro de 24h da última mensagem do lead é grátis.
4. **View de conversa no `crm.html`** — thread por lead + campo de
   resposta que chama a Cloud API (`POST /{phone-number-id}/messages`).

**Status (11/09/2026):** passos 2 e 4 já feitos (o campo de resposta no
`crm.html` está ligado e a função abaixo já escreve `direcao='enviada'`
com `lead_whatsapp` normalizado por dígitos, igual o webhook grava).
**Falta só o passo 1** (token permanente) — sem ele a função de envio
responde erro 502 da Meta. Passo 3 (forma de pagamento) só é necessário
pra template fora da janela de 24h, não bloqueia o teste inicial.

### 14.6. Edge Function `whatsapp-send` (responder pelo CRM)

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`whatsapp-send`** → cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_  = Deno.env.get("SUPABASE_URL")!;
const ANON  = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!; // 1039296279264556

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
  const texto = String(body.texto || "").trim();
  if (!numero || !texto) return j({ erro: "numero e texto obrigatórios" }, 400);

  const metaResp = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numero,
      type: "text",
      text: { body: texto },
    }),
  });
  const metaBody = await metaResp.json();
  if (!metaResp.ok) return j({ erro: metaBody.error?.message || "falha ao enviar" }, 502);

  const waId = metaBody.messages && metaBody.messages[0] && metaBody.messages[0].id;

  await fetch(`${URL_}/rest/v1/mensagens?on_conflict=wa_message_id`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      wa_message_id: waId, lead_whatsapp: numero, direcao: "enviada",
      tipo: "text", texto, status: "sent", wa_timestamp: new Date().toISOString(),
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
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO** (o CRM manda
o JWT do usuário logado, igual o `equipe-admin`).

**Secrets** (Edge Functions → Secrets):
- `WHATSAPP_PERMANENT_TOKEN` — o token gerado no passo 1 (Usuário de
  Sistema).
- `WHATSAPP_PHONE_NUMBER_ID` = `1039296279264556`.

**Decisão (11/09/2026):** sem comissão por vendedor, então qualquer membro
ativo da equipe pode responder qualquer lead a qualquer momento — não tem
mais reivindicação/dono (ver §15.7). Responder só desliga a Cris e avança
a etapa.

## 15. CRM — Gestão de equipe pelo painel (Edge Function `equipe-admin`)

Deixa o gestor cadastrar/desativar vendedor sem entrar no Supabase. A
função valida o JWT de quem chamou e **só age se for `papel = 'gestor'`
e `ativo`**. Usa a service_role key (só no servidor) + a Admin API do
Auth. Não apaga conta de auth (por causa das FKs) — desativa via
`perfis.ativo = false`.

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`equipe-admin`** → cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_  = Deno.env.get("SUPABASE_URL")!;
const ANON  = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRM_URL = "https://congressocancer.novvasaudeintegrativa.com.br/Ads/crm.html";

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };

// CORS — o painel (outro domínio) precisa disso, senão dá "Failed to fetch"
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

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const u = await quemChamou(token);
  if (!u) return j({ erro: "não autenticado" }, 401);
  if (!(await ehGestor(u.id))) return j({ erro: "só gestor" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }

  if (body.action === "list") {
    const pr = await fetch(`${URL_}/rest/v1/perfis?select=id,nome,papel,ativo,criado_em&order=criado_em.asc`, { headers: svcHeaders });
    const perfis = await pr.json();
    // e-mails: Admin API lista os usuários
    const ur = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders });
    const uj = await ur.json();
    const email: Record<string, string> = {};
    (uj.users || []).forEach((x: any) => { email[x.id] = x.email; });
    return j((perfis || []).map((p: any) => ({ ...p, email: email[p.id] || null })));
  }

  if (body.action === "criar") {
    const nome = String(body.nome || "").trim();
    const mail = String(body.email || "").trim().toLowerCase();
    const papel = body.papel === "gestor" ? "gestor" : "vendedor";
    if (!nome || !mail) return j({ erro: "nome e e-mail obrigatórios" }, 400);

    // senha provisória — o vendedor troca depois. Não depende de e-mail/SMTP.
    const senhaTemp = "Nv" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);

    let novoId: string | null = null;
    const cr = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: "POST", headers: svcHeaders,
      body: JSON.stringify({ email: mail, password: senhaTemp, email_confirm: true }),
    });
    const crBody = await cr.json();
    if (cr.ok && crBody.id) {
      novoId = crBody.id;
    } else {
      // já existe (convite anterior que falhou) → acha o id e reseta a senha
      const lu = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders });
      const luj = await lu.json();
      const achado = (luj.users || []).find((x: any) => (x.email || "").toLowerCase() === mail);
      if (!achado) return j({ erro: "criar usuário: " + (crBody.msg || JSON.stringify(crBody)) }, 400);
      novoId = achado.id;
      await fetch(`${URL_}/auth/v1/admin/users/${novoId}`, {
        method: "PUT", headers: svcHeaders,
        body: JSON.stringify({ password: senhaTemp, email_confirm: true }),
      });
    }

    const pr = await fetch(`${URL_}/rest/v1/perfis`, {
      method: "POST", headers: { ...svcHeaders, prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify({ id: novoId, nome, papel, ativo: true }),
    });
    if (!pr.ok) return j({ erro: "perfis: " + (await pr.text()) }, 500);
    return j({ ok: true, id: novoId, senha_provisoria: senhaTemp });
  }

  if (body.action === "atualizar") {
    const id = String(body.id || "");
    if (!id) return j({ erro: "id obrigatório" }, 400);
    const patch: Record<string, unknown> = {};
    if (body.nome !== undefined)  patch.nome  = String(body.nome).trim();
    if (body.papel !== undefined) patch.papel = body.papel === "gestor" ? "gestor" : "vendedor";
    if (body.ativo !== undefined) patch.ativo = !!body.ativo;
    if (id === u.id && patch.papel === "vendedor")
      return j({ erro: "você não pode rebaixar a si mesmo" }, 400);
    const pr = await fetch(`${URL_}/rest/v1/perfis?id=eq.${id}`, {
      method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!pr.ok) return j({ erro: await pr.text() }, 500);
    return j({ ok: true });
  }

  return j({ erro: "ação desconhecida" }, 400);
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO** (o painel manda
o JWT do usuário como Bearer — passa; a função ainda revalida por dentro).
Nenhum secret novo — `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidos.

No `crm.html`, seção **"Equipe"** (só aparece pro gestor): lista + form
"adicionar vendedor". Ao adicionar, o vendedor recebe e-mail com link pra
definir a senha (SMTP do Gmail já configurado, §13.3).

## 15.5. CRM — leads que só existem no WhatsApp (sem ter feito o quiz)

**Problema (11/09/2026):** o Kanban (`rpc_crm_pipeline`) monta a lista a partir
de `crm_leads` (dedupe de `quiz_leads`) — quem nunca preencheu o formulário
do site e só mandou WhatsApp direto **não aparece em lugar nenhum**, mesmo
tendo uma conversa ativa em `mensagens`. E pior: uma linha em `lead_status`
só era criada quando a Cris marcava `urgente` (só acontece em horário
comercial) — fora do horário, nem isso existia.

**Correção — duas partes:**

### 1. `rpc_crm_pipeline` — volta a ser só WhatsApp (Pipeline ≠ Quiz)

Decisão (11/09/2026): o Pipeline mostra **só quem está em conversa de
WhatsApp** (tem linha em `lead_status`, que agora é criada por
`garantirLeadStatus` desde a 1ª mensagem, em qualquer horário). Quem só
preencheu o quiz e nunca mandou WhatsApp fica de fora daqui — mora na aba
**Quiz** (§15.6). Se o mesmo número também fez o quiz, o nome/profissão
aparecem enriquecidos via join com `crm_leads`.

```sql
create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      l.nome, l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
```

Quem só existe via WhatsApp (nunca fez o quiz) aparece com `nome = null` (o
`crm.html` já mostra "(sem nome)" nesse caso).

## 15.6. CRM — aba "Quiz" (todo mundo que preencheu o formulário)

Lista separada do Pipeline, direto de `crm_leads` (não depende de ter
WhatsApp iniciado). Mostra nível (iniciante/intermediário/avançado) e
pontuação, com filtro e exportação em CSV — pra virar lista de abordagem
manual (WhatsApp um a um, ou repasse pra e-mail marketing). Sem envio em
massa automático pelo WhatsApp (ver decisão de compliance na conversa/no
plano de marketing — arriscaria a qualidade do número).

### 2. `whatsapp-webhook` — cria a linha de `lead_status` já na 1ª mensagem,
em qualquer horário

Adiciona essas duas peças no código (ver §17.7 pra versão completa já com
isso embutido):

```ts
async function garantirLeadStatus(numero: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero }]),
  });
}
```

Chamada logo no início de `deixarCrisResponder`, antes de qualquer outra
coisa — assim toda mensagem nova, não importa o horário, já garante um
card na coluna "Novo" do Kanban.

## 15.7. CRM — sem "dono" do lead (todo mundo pode responder qualquer um)

Decisão (11/09/2026): não existe comissão por vendedor — todo mundo
trabalha pelo mesmo objetivo (fechar venda), então a trava de "esse lead
já é de outro vendedor" (criada em §17.6/§17.7) foi **removida**. Agora:

- Qualquer membro ativo da equipe vê e edita qualquer lead no Kanban
  (etapa, nota, urgente, atribuir/desatribuir se quiser usar pra
  organização própria — mas não é mais obrigatório nem trava nada).
- Responder pelo WhatsApp (via `whatsapp-send`) não reivindica mais o
  lead — só desliga a Cris e avança a etapa de "Novos" pra "Em
  Atendimento", sem checar dono.

```sql
drop policy if exists "vê lead_status" on public.lead_status;
create policy "vê lead_status" on public.lead_status
  for select to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

drop policy if exists "edita lead_status" on public.lead_status;
create policy "edita lead_status" on public.lead_status
  for update to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo))
  with check (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

notify pgrst, 'reload schema';
```

`rpc_crm_pipeline` também precisa soltar o filtro de dono/urgente — ver
código atualizado logo abaixo.

## 15.8. CRM — recebendo imagens/áudios (mídia do WhatsApp)

O webhook da Meta manda só um **ID temporário** da mídia, não o arquivo —
pra exibir de verdade, precisa buscar na Graph API e guardar em algum
lugar antes que o link expire (poucos minutos/horas). Guardamos no
**Storage do Supabase**, num bucket público.

### SQL

```sql
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', true)
on conflict (id) do update set public = true;

alter table public.mensagens add column if not exists midia_url text;

notify pgrst, 'reload schema';
```

### `whatsapp-webhook` — trecho novo (baixa e sobe a mídia)

Adiciona essa função e usa no loop de mensagens recebidas (código
completo em §17.8):

```ts
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
```

Suporta imagem, áudio, vídeo, documento e sticker (qualquer um com
`m.image`/`m.video`/`m.audio`/`m.document`/`m.sticker`).

## 15.9. CRM — progresso da VSL por lead (remarketing e priorização)

**Por quê (12/09/2026):** além do remarketing anônimo pelo Meta Pixel (os
eventos `VideoPlay`/`VideoProgress`/`VideoComplete` da VSL já vão pro
`fbq('trackCustom', …)`, então já dá pra criar um Público Personalizado
no Gerenciador de Anúncios sem nenhuma mudança), o objetivo aqui é
**identificar qual lead especificamente** assistiu e até onde — pra
equipe priorizar quem assistiu mais (reduz dependência de tráfego pago
pra "esquentar" quem já demonstrou interesse assistindo a VSL).

**Como funciona:** `quiz.html` e o site principal usam o mesmo
`visitor_id` (mesma chave `cc_vid` no `localStorage`, mesmo domínio),
então dá pra cruzar `quiz_leads.visitor_id` com `events.visitor_id`
filtrando `props->>'placement' = 'vsl'`. **Limite:** só funciona pra
quem também preencheu o quiz (é onde o `visitor_id` vira identificável,
com nome/WhatsApp) — um contato que só mandou WhatsApp direto, sem
nunca ter passado pelo quiz, não tem `visitor_id` conhecido.

```sql
-- crm_leads precisa carregar o visitor_id pra poder cruzar com events.
-- visitor_id entra por ULTIMO na lista: CREATE OR REPLACE VIEW só aceita
-- ACRESCENTAR coluna no final — inserir no meio desloca a posição das
-- colunas seguintes e o Postgres recusa com "cannot change name of view
-- column" (ele interpreta como tentativa de renomear, não de inserir).
create or replace view public.crm_leads with (security_invoker = true) as
  select distinct on (whatsapp)
    whatsapp,
    nome, email, profissao, nivel, pontuacao,
    utm_source, utm_medium, utm_campaign,
    created_at as captado_em,
    visitor_id
  from public.quiz_leads
  where whatsapp is not null and whatsapp <> ''
  order by whatsapp, (pontuacao is not null) desc, created_at desc;

-- rpc_crm_pipeline ganha o campo vsl_progress (0-100, null = nunca assistiu
-- ou o lead so existe via WhatsApp, sem visitor_id conhecido)
create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      l.nome, l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em,
      (select max(
         case e.event
           when 'VideoComplete' then 100
           when 'VideoProgress' then (e.props->>'percent')::int
           when 'VideoPlay' then 0
           else null
         end)
       from public.events e
       where e.visitor_id = l.visitor_id
         and lower(coalesce(e.props->>'placement','')) = 'vsl'
         and e.event in ('VideoPlay','VideoProgress','VideoComplete')
      ) as vsl_progress
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';
```

No `crm.html`, cada card do Kanban ganha um badge verde "🎬 VSL 75%" (ou
"🎬 VSL iniciada" quando `vsl_progress = 0`, ou "🎬 VSL assistida" quando
`= 100`) ao lado do badge de nível/origem, só quando `vsl_progress` não é
nulo.

## 16. CRM — Cris (IA de primeiro contato)

Implementa o que já estava desenhado como simulação no `novva-crm.html`
("Fila da Cris") e registrado como **B5 — Chatbot de qualificação** na
estratégia de marketing: todo lead novo é atendido primeiro pela Cris (IA),
que faz 2-3 perguntas de qualificação, e só depois passa pra um humano —
seja porque alguém da equipe respondeu manualmente (handoff automático),
seja porque a própria Cris já qualificou o suficiente (handoff automático
depois de 3 respostas dela).

**Coração-chave:** o controle de "quem está no comando" (`ia_ativa`) mora
numa linha de `lead_status` **chaveada pelo número em dígitos** (o mesmo
formato que a Meta manda em `mensagens.lead_whatsapp`), não pelo número
como a pessoa digitou no quiz. É uma simplificação deliberada: a linha de
`lead_status` "oficial" do pipeline (Kanban, `atribuido_a`, `etapa`) pode
ter uma chave em outro formato pro mesmo humano — harmless pra esse
propósito, porque `ia_ativa` só é lido/escrito pelo fluxo de conversa
(`crm.html` e as duas Edge Functions), que sempre trabalham com o número em
dígitos. Unificar as duas chaves de vez é trabalho futuro (normalizar
`quiz_leads.whatsapp` na captura), não bloqueia isso.

A única normalização que **precisa** cruzar os dois formatos é a policy de
leitura de `mensagens` (pra um vendedor ver a conversa do lead que é dele,
mesmo se o `lead_status` dele foi criado com o número digitado no quiz).

### 16.1. SQL — migração

Roda no SQL Editor do Supabase:

```sql
-- normaliza número: só dígitos, sem o DDI 55 quando presente
create or replace function public.wa_norm(t text) returns text
language sql immutable as $$
  select case
    when length(d) = 13 and left(d,2) = '55' then right(d, 11)
    when length(d) = 12 and left(d,2) = '55' then right(d, 10)
    else d
  end
  from (select regexp_replace(coalesce(t,''), '\D', '', 'g') as d) s;
$$;

-- quem está no comando da conversa: true = Cris, false = humano assumiu
alter table public.lead_status add column if not exists ia_ativa boolean not null default true;

-- quem mandou a mensagem "enviada": null = Cris, uuid = humano da equipe
alter table public.mensagens add column if not exists enviado_por uuid references auth.users(id);

-- corrige a policy pra casar dígitos (mensagens) com o formato digitado (lead_status)
drop policy if exists "equipe vê mensagens" on public.mensagens;
create policy "equipe vê mensagens" on public.mensagens
  for select to authenticated
  using (
    exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
    and (
      public.eh_gestor()
      or exists (
        select 1 from public.lead_status s
        where public.wa_norm(s.whatsapp) = public.wa_norm(mensagens.lead_whatsapp)
          and (s.atribuido_a = auth.uid() or s.urgente = true)
      )
    )
  );

notify pgrst, 'reload schema';
```

### 16.2. Edge Function `whatsapp-webhook` (versão completa, com a Cris)

> **Superada por §17.3** (horário comercial + site como fonte de verdade).
> Cola sempre a versão de §17.3, não essa — ficou aqui só de histórico.

Substitui inteiro o código de **§14.2** — cola por cima:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN    = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET      = Deno.env.get("WHATSAPP_APP_SECRET")?.trim();
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SVC_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;

const svcHeaders = { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": "application/json" };

const CRIS_SYSTEM = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Está conversando pelo WhatsApp com alguém que acabou de chegar. Seu único trabalho agora é qualificar essa pessoa com perguntas curtas e naturais, uma de cada vez, nunca em lista:
1) qual a profissão/área de atuação dela;
2) se já atende ou pretende atender pacientes oncológicos;
3) o que mais busca no congresso (atualizar tecnicamente, fazer networking, etc).
Perfil ideal: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta interessado(a) em práticas integrativas oncológicas, disposto(a) a investir entre R$500 e R$1.500.
Depois de entender isso (o suficiente já em 2-3 trocas), avise com naturalidade que vai chamar alguém da equipe pra continuar e tirar dúvidas de valores/inscrição — não informe preço nem feche venda sozinha.
Tom: brasileiro, informal, caloroso, mensagens curtas (2-4 linhas), no máximo 1 emoji por mensagem. Nunca mencione que é uma IA a menos que perguntem diretamente.`;

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
  if (!r.ok) return true; // sem linha ainda = lead novo, Cris atende
  const rows = await r.json();
  return !rows.length || rows[0].ia_ativa !== false;
}

async function historico(numero: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&select=direcao,texto,enviado_por&order=criado_em.asc&limit=20`,
    { headers: svcHeaders },
  );
  return r.ok ? await r.json() : [];
}

async function crisResponde(msgsHist: any[]): Promise<string | null> {
  const msgs = msgsHist
    .filter((m: any) => m.texto)
    .map((m: any) => ({ role: m.direcao === "recebida" ? "user" : "assistant", content: m.texto }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null; // só responde se a última for do lead

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, system: CRIS_SYSTEM, messages: msgs }),
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

async function contarRespostasCris(numero: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&direcao=eq.enviada&enviado_por=is.null&select=id`,
    { headers: svcHeaders },
  );
  const rows = r.ok ? await r.json() : [];
  return rows.length;
}

async function deixarCrisResponder(numero: string) {
  if (!(await iaAtiva(numero))) return;
  const hist = await historico(numero);
  const texto = await crisResponde(hist);
  if (!texto) return;
  const waId = await mandarWhatsapp(numero, texto);
  await fetch(`${SUPABASE_URL}/rest/v1/mensagens?on_conflict=wa_message_id`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      wa_message_id: waId, lead_whatsapp: numero, direcao: "enviada",
      tipo: "text", texto, status: "sent", wa_timestamp: new Date().toISOString(),
      enviado_por: null, raw: {},
    }]),
  });
  // depois de 3 respostas da Cris, entrega pra um humano continuar
  if ((await contarRespostasCris(numero)) >= 3) {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ whatsapp: numero, ia_ativa: false }]),
    });
  }
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
  const numerosRecebidos = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        linhas.push({
          wa_message_id: m.id,
          lead_whatsapp: m.from,
          direcao: "recebida",
          tipo: m.type ?? null,
          texto: m.text?.body ?? m.button?.text ??
                 m.interactive?.button_reply?.title ??
                 m.interactive?.list_reply?.title ?? null,
          wa_timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          raw: m,
        });
        numerosRecebidos.add(m.from);
      }
      for (const s of v.statuses ?? []) {
        linhas.push({
          wa_message_id: s.id,
          lead_whatsapp: s.recipient_id,
          direcao: "enviada",
          status: s.status ?? null,
          wa_timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
        });
      }
    }
  }

  if (linhas.length) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/mensagens?on_conflict=wa_message_id`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linhas),
    });
    // nunca devolve erro pra Meta (ela reenvia em loop) — só loga
    if (!resp.ok) console.error("insert mensagens:", resp.status, await resp.text());
  }

  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
```

**Deploy.** Continua igual (`whatsapp-webhook` já existe) — só substitui o
código e clica em **Deploy**. Não muda nenhuma config: "Verify JWT with
legacy secret" continua **desligado**, os secrets `WHATSAPP_VERIFY_TOKEN`/
`WHATSAPP_APP_SECRET` continuam os mesmos, e os novos
(`WHATSAPP_PERMANENT_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `ANTHROPIC_API_KEY`)
já foram cadastrados em §14.6/16 do processo de setup.

**Modelo usado:** `claude-haiku-4-5-20251001` — rápido e barato o bastante
pra qualificação (poucas linhas por resposta). Trocar por um Sonnet se um
dia a Cris precisar ser mais sofisticada.

### 16.3. `crm.html` — o que mudou

- Balão de mensagem "enviada" mostra a etiqueta **"Cris"** quando
  `enviado_por` é nulo (senão é presumido "Você", ou seja, alguém da
  equipe).
- Faixa no topo da conversa: **"🤖 Cris está respondendo"** com botão
  **Assumir conversa**, ou **"👤 Você está no controle"** com botão
  **Devolver pra Cris** — lê/grava `lead_status.ia_ativa` (chave = número
  em dígitos, ver nota do início da seção).
- Mandar uma resposta manual pelo `whatsapp-send` já desliga a Cris
  automaticamente pra aquele lead (handoff), sem precisar clicar em nada.

### 16.4. Handoff — quando a Cris para de falar

1. Alguém da equipe manda uma resposta manual pelo CRM → `whatsapp-send`
   marca `ia_ativa = false`.
2. Alguém da equipe clica em **"Assumir conversa"** no `crm.html`.
3. A própria Cris já mandou 3 respostas pro mesmo lead → o webhook desliga
   sozinho, presumindo que já qualificou o suficiente.

Devolver o controle pra Cris (botão **"Devolver pra Cris"**) é manual, pra
não devolver sem querer uma conversa que um vendedor já está tocando.

## 17. CRM — visibilidade aberta + "assumir lead" (venda conjunta)

Mudança de regra: **todo vendedor ativo vê qualquer conversa que chega no
CRM**, não só a carteira dele. Isso é o modelo "Fila da Cris" que já estava
desenhado como simulação no `novva-crm.html` — venda conjunta, quem
assumir primeiro atende. Depois que a Cris faz o primeiro contato, cabe a
qualquer vendedor pedir pra assumir aquele lead; o primeiro que clicar
"Assumir conversa" vira o dono, e mais ninguém rouba depois.

### 17.1. SQL — migração

```sql
-- mensagens: qualquer membro ativo da equipe vê tudo (não só a carteira dele)
drop policy if exists "equipe vê mensagens" on public.mensagens;
create policy "equipe vê mensagens" on public.mensagens
  for select to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

-- lead_status: todo mundo enxerga também os leads ainda sem dono (fila aberta)
drop policy if exists "vê lead_status" on public.lead_status;
create policy "vê lead_status" on public.lead_status
  for select to authenticated
  using (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true or atribuido_a is null);

-- permite abrir (fazer UPDATE) numa linha ainda sem dono, pra poder reivindicar
drop policy if exists "edita lead_status" on public.lead_status;
create policy "edita lead_status" on public.lead_status
  for update to authenticated
  using (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true or atribuido_a is null)
  with check (public.eh_gestor() or atribuido_a = auth.uid() or urgente = true);

-- trigger: continua só gestor pra REATRIBUIR, mas libera autoatribuição
-- (pegar um lead livre) e autoliberação (devolver um lead que é seu)
create or replace function public.guarda_lead_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.atribuido_a is distinct from old.atribuido_a
     and not public.eh_gestor()
     and not (new.atribuido_a = auth.uid())               -- qualquer um pode assumir pra si, mesmo já tendo dono
     and not (old.atribuido_a = auth.uid() and new.atribuido_a is null) -- e liberar o que é seu
  then
    raise exception 'só gestor pode passar o lead pra outra pessoa (que não seja você mesmo)';
  end if;
  new.atualizado_por := auth.uid();
  new.atualizado_em  := now();
  return new;
end;
$$;

-- RPC: "assumir lead" — pega um lead livre (ou já seu) e desliga a Cris;
-- se já for de outro vendedor, recusa (evita corrida/roubo de lead)
create or replace function public.rpc_assumir_lead(p_whatsapp text)
returns void language plpgsql security definer set search_path = public as $$
declare
  achado public.lead_status;
begin
  if not exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo) then
    raise exception 'não autorizado';
  end if;

  select * into achado from public.lead_status
    where public.wa_norm(whatsapp) = public.wa_norm(p_whatsapp)
    limit 1;

  if achado.whatsapp is null then
    insert into public.lead_status (whatsapp, atribuido_a, ia_ativa, etapa)
      values (p_whatsapp, auth.uid(), false, 'conversando');
    return;
  end if;

  if achado.atribuido_a is not null and achado.atribuido_a <> auth.uid() then
    raise exception 'esse lead já está com outro vendedor';
  end if;

  update public.lead_status
    set atribuido_a = auth.uid(), ia_ativa = false,
        etapa = case when etapa = 'novo' then 'conversando' else etapa end
    where whatsapp = achado.whatsapp;
end;
$$;
revoke execute on function public.rpc_assumir_lead(text) from public, anon;
grant execute on function public.rpc_assumir_lead(text) to authenticated;

notify pgrst, 'reload schema';
```

### 17.2. Horário comercial — Cris muda de comportamento

- **8h–17h, seg-sex (horário de Brasília):** Cris manda só uma saudação
  curta avisando que já vai chamar alguém da equipe, e desliga a IA na
  hora (handoff imediato, não espera 3 respostas).
- **Fora desse horário** (noite, manhã cedo, fim de semana): Cris conversa
  de verdade — tira dúvida sobre o congresso, fala preço (só Lote VIP e
  Lote 1, que são os que têm inscrição aberta) e manda o link de compra,
  mas não fecha venda nem inventa data/palestrante (isso ainda é
  hipótese de 2025, ver `docs/persona.md`). Handoff automático continua
  existindo, só que com um teto maior (8 respostas em vez de 3).

Código completo (substitui o `whatsapp-webhook` de novo) em **§17.3**.

### 17.3. Edge Function `whatsapp-webhook` (versão com horário comercial)

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN    = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET      = Deno.env.get("WHATSAPP_APP_SECRET")?.trim();
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SVC_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;

const svcHeaders = { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": "application/json" };

const BOAS_VINDAS_COMERCIAL =
  "Oi! Tudo bem? Aqui é da equipe do Congresso Câncer 2026 😊 " +
  "Recebi sua mensagem — já vou chamar alguém do nosso time pra te atender direitinho, só um instante!";

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). É fora do horário comercial (8h-17h, seg-sex), então você mesma pode conversar de verdade com o lead: tirar dúvidas, explicar do que se trata o congresso, falar preço e mandar o link de inscrição.

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes:
- Use SOMENTE as informações da seção "CONTEÚDO ATUAL DO SITE" abaixo pra falar de preço, lote, data, palestrante, programação ou qualquer outro dado factual do congresso — é a fonte de verdade, sempre atualizada. Nunca invente ou complete com dado que não estiver lá.
- Se perguntarem algo que não está no conteúdo do site, diga que vai confirmar com a equipe e chama pra ver as novidades direto no site.
- Não empurre a venda de forma agressiva nem finja urgência falsa. Pode mandar o link de compra quando fizer sentido na conversa.
- Se a pessoa pedir explicitamente pra falar com um humano, avise que vai chamar alguém assim que o time abrir (comercial 8h-17h) e pare de insistir em vender.
- Tom: brasileiro, informal, caloroso, mensagens curtas (2-5 linhas), no máximo 1 emoji por mensagem. Nunca mencione que é uma IA a menos que perguntem diretamente.`;

const SITE_URL = "https://congressocancer.novvasaudeintegrativa.com.br/";
const SITE_TTL_MS = 30 * 60 * 1000; // 30 min de cache — evita bater no site a cada mensagem
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
      .slice(0, 9000); // teto de tamanho pra não estourar tokens
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

async function historico(numero: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mensagens?lead_whatsapp=eq.${numero}&select=direcao,texto,enviado_por&order=criado_em.asc&limit=20`,
    { headers: svcHeaders },
  );
  return r.ok ? await r.json() : [];
}

async function crisResponde(msgsHist: any[]): Promise<string | null> {
  const msgs = msgsHist
    .filter((m: any) => m.texto)
    .map((m: any) => ({ role: m.direcao === "recebida" ? "user" : "assistant", content: m.texto }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;

  const site = await textoDoSite();
  const system = CRIS_INSTRUCOES + "\n\nCONTEÚDO ATUAL DO SITE (extraído agora, é a fonte de verdade):\n" + site;

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

async function desligarIa(numero: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero, ia_ativa: false }]),
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

async function deixarCrisResponder(numero: string) {
  if (!(await iaAtiva(numero))) return;

  if (dentroComercial()) {
    // já mandou a saudação de horário comercial pra esse lead? não manda de novo.
    if ((await contarRespostasCris(numero)) > 0) return;
    const waId = await mandarWhatsapp(numero, BOAS_VINDAS_COMERCIAL);
    await gravarEnviada(numero, waId, BOAS_VINDAS_COMERCIAL);
    await desligarIa(numero); // handoff imediato pro time humano
    return;
  }

  const hist = await historico(numero);
  const texto = await crisResponde(hist);
  if (!texto) return;
  const waId = await mandarWhatsapp(numero, texto);
  await gravarEnviada(numero, waId, texto);
  if ((await contarRespostasCris(numero)) >= 8) await desligarIa(numero);
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
  const numerosRecebidos = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        linhas.push({
          wa_message_id: m.id,
          lead_whatsapp: m.from,
          direcao: "recebida",
          tipo: m.type ?? null,
          texto: m.text?.body ?? m.button?.text ??
                 m.interactive?.button_reply?.title ??
                 m.interactive?.list_reply?.title ?? null,
          wa_timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          raw: m,
        });
        numerosRecebidos.add(m.from);
      }
      for (const s of v.statuses ?? []) {
        linhas.push({
          wa_message_id: s.id,
          lead_whatsapp: s.recipient_id,
          direcao: "enviada",
          status: s.status ?? null,
          wa_timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
        });
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

  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
```

### 17.4. Cris lembra quem é o lead (cruza com o cadastro do quiz)

A Cris já enxergava o **histórico de mensagens** daquele número (até 20
últimas, sem limite de tempo — se a pessoa já conversou antes, ela lê tudo
de novo). O que faltava: se a pessoa já preencheu o quiz do site antes
(nome, profissão, nível), a Cris não sabia disso na primeira mensagem por
WhatsApp — só descobriria conversando de novo.

Agora ela cruza o número com `crm_leads` (via `wa_norm`, porque o quiz
grava o número como a pessoa digitou, formato diferente do que a Meta
manda) e, se achar, já entra sabendo nome/profissão/nível — trata com
familiaridade, chama pelo nome e não repete pergunta que já sabe a
resposta. Se não achar (número novo, nunca fez o quiz), segue qualificando
do zero, igual antes.

**SQL** (roda no SQL Editor):

```sql
create or replace function public.rpc_lead_conhecido(p_whatsapp text)
returns table(nome text, profissao text, nivel text, pontuacao numeric, captado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select nome, profissao, nivel, pontuacao, captado_em
  from public.crm_leads
  where public.wa_norm(whatsapp) = public.wa_norm(p_whatsapp)
  limit 1;
$$;
revoke execute on function public.rpc_lead_conhecido(text) from public, anon;
grant execute on function public.rpc_lead_conhecido(text) to authenticated;

notify pgrst, 'reload schema';
```

**Edge Function:** o `whatsapp-webhook` completo com isso embutido está em
**§17.5** — substitui de novo o código inteiro.

### 17.5. Edge Function `whatsapp-webhook` (com memória do lead)

Cola por cima, substituindo o de §17.3:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN    = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET      = Deno.env.get("WHATSAPP_APP_SECRET")?.trim();
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SVC_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;

const svcHeaders = { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": "application/json" };

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Sua função é criar uma conexão inicial calorosa com o lead e levar ele pra nossa página oficial — é lá que tem a apresentação completa (inclusive vídeo), que já responde as dúvidas mais comuns e foi feita pra converter. O site é: https://congressocancer.novvasaudeintegrativa.com.br/time-comercial.html

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes (decisão da empresa, 11/09/2026):
- NÃO informe valores, preço de lote, datas, programação, nomes de palestrantes, certificado ou qualquer detalhe aprofundado do congresso diretamente na conversa — pra qualquer pergunta desse tipo, responda breve e sempre mande pra página: "Isso está bem explicadinho na nossa página, com todos os detalhes — dá uma olhada: https://congressocancer.novvasaudeintegrativa.com.br/time-comercial.html". Nunca cite valor em R$ na conversa, nem repita o que está no "CONTEÚDO ATUAL DO SITE" abaixo — esse conteúdo é só pra você mesma saber do que se trata o congresso, não pra repassar em detalhe.
- Pode confirmar o básico/geral sem detalhar (ex: "sim, é sobre práticas integrativas em oncologia", "é em São Paulo, 2 dias"), mas sempre fechando com o convite pra ver tudo na página.
- Se souber quem é o lead (seção "QUEM É ESSE CONTATO"), trate com familiaridade e chame pelo nome.
- Não empurre a venda de forma agressiva nem finja urgência falsa — só reforce com naturalidade que vale a pena conferir a página agora.
- Se a pessoa pedir explicitamente pra falar com um humano: se for dentro do horário comercial (8h-17h, seg-sex), diga que já chamou alguém do time e a pessoa deve aparecer a qualquer momento; se for fora desse horário, diga que chama assim que o time abrir. Nos dois casos, continue reforçando a página enquanto isso.
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

async function crisResponde(msgsHist: any[], conhecido: { nome: string; profissao: string | null; nivel: string | null } | null, emComercial: boolean): Promise<string | null> {
  const msgs = msgsHist
    .filter((m: any) => m.texto)
    .map((m: any) => ({ role: m.direcao === "recebida" ? "user" : "assistant", content: m.texto }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;

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

async function desligarIa(numero: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero, ia_ativa: false }]),
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
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero }]),
  });
}

async function deixarCrisResponder(numero: string) {
  await garantirLeadStatus(numero); // garante que todo contato aparece no Kanban, em qualquer horário
  if (!(await iaAtiva(numero))) return;
  const conhecido = await leadConhecido(numero);
  const emComercial = dentroComercial();

  if (emComercial && !(await crisFalouRecentemente(numero, 6))) {
    // primeiro contato (ou faz +6h do último) em horário comercial — saudação curta avisando o time
    const texto = conhecido
      ? `Oi, ${conhecido.nome}! Tudo bem? Aqui é da equipe do Congresso Câncer 2026 😊 Já vou chamar alguém do nosso time pra continuar com você, só um instante!`
      : "Oi! Tudo bem? Aqui é da equipe do Congresso Câncer 2026 😊 Recebi sua mensagem — já vou chamar alguém do nosso time pra te atender direitinho, só um instante!";
    const waId = await mandarWhatsapp(numero, texto);
    if (!waId) return;
    await gravarEnviada(numero, waId, texto);
    await marcarUrgente(numero); // já sinaliza pro time desde a primeira mensagem
    return;
  }

  if (emComercial) {
    await marcarUrgente(numero); // continua sinalizando enquanto ninguém assumiu
    const jaAjudouDeVerdade = (await contarRespostasCris(numero)) >= 2; // já passou da fase "só saudação" alguma vez
    if (!jaAjudouDeVerdade && (await crisFalouRecentemente(numero, 0.25))) {
      // ainda dentro dos 15 min de tolerância pro vendedor aparecer — fica quieta, só sinalizando urgente
      return;
    }
    // passou de 15 min sem ninguém assumir (ou já estava ajudando de verdade) — não deixa a
    // conversa esfriar, a Cris continua ajudando até um humano realmente assumir
  }

  const hist = await historico(numero);
  const texto = await crisResponde(hist, conhecido, emComercial);
  if (!texto) return;
  const waId = await mandarWhatsapp(numero, texto);
  if (!waId) return; // não grava se não foi entregue
  await gravarEnviada(numero, waId, texto);
  // sem desligamento automático — só humano desliga a Cris (assumir conversa ou responder manualmente)
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
  const numerosRecebidos = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        const midia = m.image || m.video || m.audio || m.document || m.sticker;
        const midiaUrl = midia?.id ? await baixarEArmazenarMidia(midia.id, midia.mime_type) : null;
        linhas.push({
          wa_message_id: m.id,
          lead_whatsapp: m.from,
          direcao: "recebida",
          tipo: m.type ?? null,
          texto: m.text?.body ?? m.button?.text ??
                 m.interactive?.button_reply?.title ??
                 m.interactive?.list_reply?.title ?? midia?.caption ?? null,
          midia_url: midiaUrl,
          wa_timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
          raw: m,
        });
        numerosRecebidos.add(m.from);
      }
      for (const s of v.statuses ?? []) {
        linhas.push({
          wa_message_id: s.id,
          lead_whatsapp: s.recipient_id,
          direcao: "enviada",
          status: s.status ?? null,
          wa_timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
        });
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

  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
```

> §17.3 fica só de histórico — usa sempre esta versão (§17.5) daqui pra frente.

### 17.6. `crm.html` — botão "Assumir conversa" agora reivindica o lead

Antes só desligava a Cris (`ia_ativa=false`); agora chama
`rpc_assumir_lead`, que também tenta virar o `atribuido_a` — se outro
vendedor já assumiu antes, a chamada falha com "esse lead já está com
outro vendedor" e o botão mostra esse erro em vez de assumir silenciosamente.

> **Superado por §15.7/§18** — não tem mais botão "Assumir conversa" (a
> própria resposta manual já reivindica), e qualquer um pode assumir a
> responsabilidade a qualquer momento, mesmo já tendo dono. Fica aqui só
> de histórico.

## 18. CRM — notificações push (PWA no celular)

Motivação (11/09/2026): o número do WhatsApp é 100% via Cloud API (Meta),
sem chip físico nem app instalado em celular nenhum — então não existe
notificação nativa do WhatsApp pra receber. A solução: transformar o
`crm.html` num **PWA** (instalável na tela inicial, Android e
iPhone) com **push notification** de verdade, disparada pelo próprio
`whatsapp-webhook` toda vez que chega mensagem nova.

**Limitação da Apple:** no iPhone, push só funciona se o iOS for
**16.4+** *e* o site estiver instalado na tela inicial (não vale abrir
pelo Safari direto). Sem isso, não tem contorno — é regra da Apple.

Arquivos novos, já no repositório: `Ads/manifest.json`, `Ads/sw.js`,
`Ads/icons/*.png` (ícone "CC" gerado a partir da marca que já existe no
CRM). O `crm.html` já tem os links do manifest, registro do service
worker, e um botão **"🔔 Ativar notificações neste aparelho"**.

### 18.1. Chaves VAPID (já geradas)

Web Push exige um par de chaves VAPID (identifica o servidor que manda a
notificação). Já geradas pra este projeto:

- **Pública** (já embutida no `crm.html`, pode ficar exposta):
  `BGEEfwa8xAK4IW_Gfx7M6fuoo-F6ykcpIaw7tehbgfbgKEdQoeuaYv7bRzhYH6XYYU-_V0zZRE7i9sPWmG6Ubf0`
- **Privada** (secret, só no servidor):
  `D2pKQ7y_KoRv9szHrDdzAdu8cZ4Lc4EtWBuzPt1RMXs`

Cadastra a privada como secret no Supabase: `VAPID_PRIVATE_KEY`. A
pública também vira secret (`VAPID_PUBLIC_KEY`), só pra função de envio
não precisar hardcodar de novo.

### 18.2. SQL — tabela de inscrições

```sql
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "usuario gerencia suas inscricoes" on public.push_subscriptions;
create policy "usuario gerencia suas inscricoes" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
```

(A leitura de todas as inscrições pra mandar o push é feita pelo
`whatsapp-webhook` com a service role key, que ignora RLS — não precisa
de policy extra pra isso.)

### 18.3. Envio — adiciona no `whatsapp-webhook`

Usa a biblioteca `web-push` via `npm:` (Deno/Supabase Edge Functions
suportam import de pacotes npm direto). Adiciona no topo do arquivo,
junto dos outros `const`:

```ts
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails("mailto:novvasaudeintegrativa@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function notificarPush(titulo: string, corpo: string, url: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth`, { headers: svcHeaders });
    const subs = r.ok ? await r.json() : [];
    await Promise.all(subs.map((s: any) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: titulo, body: corpo, url }),
      ).catch(async (e: any) => {
        console.error("push falhou:", s.endpoint, e?.statusCode || e);
        // inscrição morta (410/404) — apaga pra não tentar de novo
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: svcHeaders });
        }
      })
    ));
  } catch (e) { console.error("notificarPush:", e); }
}
```

E dentro do loop `for (const m of v.messages ?? [])`, logo depois de montar
`texto`/`midiaUrl` e antes do `linhas.push(...)`, dispara a notificação:

```ts
await notificarPush(
  "Nova mensagem no WhatsApp",
  `+${m.from}: ${texto || (m.type ? "(" + m.type + ")" : "mensagem")}`,
  "https://congressocancer.novvasaudeintegrativa.com.br/Ads/crm.html",
);
```

Código completo do `whatsapp-webhook` com tudo isso já embutido, pronto
pra colar, está em **§18.4**.

### 18.4. Edge Function `whatsapp-webhook` (versão completa e atual — atualizada em 17/09/2026 com marcação de origem de campanha e link `time-comercial.html`; substitui os trechos avulsos de §23.3, §24.2 e §25.7)

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

const VERIFY_TOKEN     = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim();
const APP_SECRET       = Deno.env.get("WHATSAPP_APP_SECRET")?.trim();
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SVC_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN         = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID  = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;
const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

// Push e so um "extra" (aviso no celular) — se as chaves VAPID nao
// estiverem cadastradas como secret ou forem invalidas, so desativa o
// push; NUNCA deixa isso derrubar a funcao inteira. webpush.setVapidDetails
// lanca erro SINCRONO na inicializacao do modulo (fora de qualquer
// try/catch de request), o que travava a funcao inteira com
// "WORKER_ERROR: Function exited due to an error" em TODA chamada —
// inclusive receber mensagem e a Cris responder, nada relacionado a
// push. Corrigido 16/09/2026.
let pushHabilitado = false;
try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails("mailto:novvasaudeintegrativa@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushHabilitado = true;
  } else {
    console.error("push desativado: faltam os secrets VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY");
  }
} catch (e) {
  console.error("push desativado: setVapidDetails falhou:", e);
}

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

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Sua função é criar uma conexão inicial calorosa com o lead e levar ele pra nossa página oficial — é lá que tem a apresentação completa (inclusive vídeo), que já responde as dúvidas mais comuns e foi feita pra converter. O site é: https://congressocancer.novvasaudeintegrativa.com.br

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes (decisão da empresa, 11/09/2026; escopo reforçado em 18/09/2026):
- Você é EXCLUSIVAMENTE uma atendente do Congresso Câncer 2026. Só existe pra falar sobre o congresso (o que é, pra quem é, e levar a pessoa pra página). Não é terapeuta, não é médica, não dá conselho de saúde, não opina sobre tratamento, medicamento, substância, exame ou diagnóstico de ninguém — nem "só uma orientação geral".
- Se o lead trouxer qualquer assunto fora do congresso (dúvida sobre o tratamento dele, pedido de indicação/opinião sobre medicamento ou substância — incluindo ivermectina, própolis, canabidiol ou qualquer outra —, ajuda pra comprar/importar/obter algo, diagnóstico, prognóstico, ou qualquer outro tema pessoal/médico/legal), NÃO desenvolva esse assunto: não faça lista, não dê passo a passo, não recomende "conversar com o médico sobre X" nem cite de volta as substâncias que a pessoa mencionou. NÃO diga que vai chamar alguém do time pra essa parte — a equipe é só de organizadores do evento, ninguém aqui está habilitado a orientar sobre tratamento/medicamento, então nunca prometa isso. Responda em no máximo 2 linhas, com empatia genuína e honestidade (ex: "essa parte do tratamento eu não tenho como te orientar, viu — isso é com a sua médica mesmo"), sem entrar no mérito, e traga de volta com naturalidade pro congresso (ex: comentar que lá ela vai poder trocar direto com especialistas em oncologia integrativa, que lidam com esse tipo de dúvida no dia a dia deles).
- NÃO informe valores, preço de lote, datas, programação, nomes de palestrantes, certificado ou qualquer detalhe aprofundado do congresso diretamente na conversa — pra qualquer pergunta desse tipo, responda breve e sempre mande pra página: "Isso está bem explicadinho na nossa página, com todos os detalhes — dá uma olhada: https://congressocancer.novvasaudeintegrativa.com.br". Nunca cite valor em R$ na conversa, nem repita o que está no "CONTEÚDO ATUAL DO SITE" abaixo — esse conteúdo é só pra você mesma saber do que se trata o congresso, não pra repassar em detalhe.
- Sempre que passar o link da página pro lead, use exatamente https://congressocancer.novvasaudeintegrativa.com.br (sem `/time-comercial.html` no final) — esse sufixo é só um redirecionamento interno do site, não deve aparecer na conversa.
- Pode confirmar o básico/geral sem detalhar (ex: "sim, é sobre práticas integrativas em oncologia", "é em São Paulo, 2 dias"), mas sempre fechando com o convite pra ver tudo na página.
- Se souber quem é o lead (seção "QUEM É ESSE CONTATO"), trate com familiaridade e chame pelo nome.
- Não empurre a venda de forma agressiva nem finja urgência falsa — só reforce com naturalidade que vale a pena conferir a página agora.
- Se a pessoa pedir explicitamente pra falar com um humano (sobre assunto do congresso — inscrição, pagamento, dúvida específica): se for dentro do horário comercial (8h-17h, seg-sex), diga que já chamou alguém do time e a pessoa deve aparecer a qualquer momento; se for fora desse horário, diga que chama assim que o time abrir. Nos dois casos, continue reforçando a página enquanto isso.
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

async function crisResponde(msgsHist: any[], conhecido: { nome: string; profissao: string | null; nivel: string | null } | null, emComercial: boolean): Promise<string | null> {
  const msgs = msgsHist
    .filter((m: any) => m.texto)
    .map((m: any) => ({ role: m.direcao === "recebida" ? "user" : "assistant", content: m.texto }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;

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

async function notificarPush(titulo: string, corpo: string, url: string) {
  if (!pushHabilitado) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth`, { headers: svcHeaders });
    const subs = r.ok ? await r.json() : [];
    await Promise.all(subs.map((s: any) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: titulo, body: corpo, url }),
      ).catch(async (e: any) => {
        console.error("push falhou:", s.endpoint, e?.statusCode || e);
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: svcHeaders });
        }
      })
    ));
  } catch (e) { console.error("notificarPush:", e); }
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
  await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ whatsapp: numero }]),
  });
}

async function deixarCrisResponder(numero: string) {
  await garantirLeadStatus(numero);
  if (!(await iaAtiva(numero))) return;
  const conhecido = await leadConhecido(numero);
  const emComercial = dentroComercial();

  if (emComercial && !(await crisFalouRecentemente(numero, 6))) {
    const texto = conhecido
      ? `Oi, ${conhecido.nome}! Tudo bem? Aqui é da equipe do Congresso Câncer 2026 😊 Já vou chamar alguém do nosso time pra continuar com você, só um instante!`
      : "Oi! Tudo bem? Aqui é da equipe do Congresso Câncer 2026 😊 Recebi sua mensagem — já vou chamar alguém do nosso time pra te atender direitinho, só um instante!";
    const waId = await mandarWhatsapp(numero, texto);
    if (!waId) return;
    await gravarEnviada(numero, waId, texto);
    await marcarUrgente(numero);
    return;
  }

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
  const statusUpdates: { id: string; status: string }[] = [];
  const numerosRecebidos = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        const midia = m.image || m.video || m.audio || m.document || m.sticker;
        const midiaUrl = midia?.id ? await baixarEArmazenarMidia(midia.id, midia.mime_type) : null;
        const texto = m.text?.body ?? m.button?.text ??
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
        await registrarOptinWhatsapp(m.from, texto);
        await marcarOrigemCampanha(m.from);
        numerosRecebidos.add(m.from);
        await notificarPush(
          "Nova mensagem no WhatsApp",
          `+${m.from}: ${texto || (m.type ? "(" + m.type + ")" : "mensagem")}`,
          "https://congressocancer.novvasaudeintegrativa.com.br/Ads/crm.html",
        );
      }
      // Atualizacoes de status (sent/delivered/read/failed) NAO entram em
      // `linhas` — ver correcao abaixo (16/09/2026).
      for (const s of v.statuses ?? []) {
        if (s.id && s.status) statusUpdates.push({ id: s.id, status: s.status });
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

  // PATCH em vez de upsert em lote: uma atualizacao de status
  // (sent/delivered/read) so leva wa_message_id + status. Se ela fosse
  // misturada num upsert em lote junto com linhas que TEM `texto` (uma
  // mensagem recebida de outro numero, por exemplo), o Postgrest monta
  // um UNICO INSERT...ON CONFLICT DO UPDATE cobrindo a uniao de colunas
  // do lote inteiro — e a linha de status, que nao manda `texto`, acaba
  // regravando esse campo como NULL na mensagem que ja tinha o texto
  // certo (apagando o conteudo real que a Cris mandou, so na nossa
  // copia salva — a mensagem de verdade ja tinha ido pro WhatsApp da
  // pessoa antes disso). PATCH so mexe na coluna que a gente realmente
  // manda, sem tocar em `texto`.
  for (const s of statusUpdates) {
    await fetch(`${SUPABASE_URL}/rest/v1/mensagens?wa_message_id=eq.${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify({ status: s.status }),
    }).catch((e) => console.error("status update:", s.id, e));
  }

  for (const numero of numerosRecebidos) {
    try { await deixarCrisResponder(numero); }
    catch (e) { console.error("cris:", numero, e); }
  }

  return new Response("ok", { status: 200 });
});
```

> **Correção (16/09/2026) — mensagem da Cris aparecendo "(sem texto)" no
> CRM.** Confirmação de entrega/leitura ("delivered"/"read") chegava
> misturada num upsert em lote com mensagens que têm `texto`, e o
> Postgrest sobrescrevia o `texto` já salvo com `NULL` (a mensagem de
> verdade já tinha sido entregue no WhatsApp da pessoa — só a nossa
> cópia salva no banco que ficava em branco). Corrigido separando
> atualização de status (`PATCH`, só a coluna `status`) do insert de
> mensagens novas (`POST` upsert, como antes). Precisa **redeploy do
> `whatsapp-webhook`** com o código acima pra parar de acontecer.

## 19. Apagar usuário de teste — "Database error deleting user"

O botão **Delete** em Authentication → Users (e o Admin API do GoTrue por
trás dele) pode falhar com **"Database error deleting user"** mesmo sem
nenhuma linha real travando — checamos todas as tabelas com FK pra
`auth.users` (inclusive as internas do Supabase e as do CRM antigo:
`workspace_members`, `contacts`, `leads`, `activities`, `tasks`) e nenhuma
tinha registro para o usuário problemático. Causa raiz não identificada
(algo no caminho interno do GoTrue, não no schema).

**O que funciona de verdade** — apagar direto por SQL, no SQL Editor:

```sql
delete from auth.users where id = 'UID_DO_USUARIO';
```

O `perfis` (FK com `on delete cascade`) some junto automaticamente. Se o
usuário tiver linha em `lead_status`/`mensagens` como responsável, essas
colunas não têm cascade — rodar antes, se precisar:

```sql
update public.lead_status set atribuido_a = null where atribuido_a = 'UID_DO_USUARIO';
update public.lead_status set atualizado_por = null where atualizado_por = 'UID_DO_USUARIO';
update public.mensagens set enviado_por = null where enviado_por = 'UID_DO_USUARIO';
```

Confirmado na prática (12/09/2026): apagar um vendedor que já respondeu
mensagem pelo CRM falha com `violates foreign key constraint
"mensagens_enviado_por_fkey"` se pular a última linha acima.

## 20. Novva Controle Financeiro — painel financeiro do evento

Painel novo (`Ads/financeiro.html`), **mesmo login da equipe** (Supabase
Auth, mesma tabela `perfis`), mas **só gestor entra** — dado financeiro não
é pra vendedor ver. Cobre: receita de expositores (por categoria/valor) e
despesas do evento organizadas por grupo (marketing digital, profissionais,
infraestrutura, evento/logística).

### 20.1. SQL — rodar no SQL Editor

```sql
-- ---------- categorias de expositor (valor por categoria) ----------
create table if not exists public.fin_categorias_expositor (
  id        bigint generated always as identity primary key,
  nome      text not null,
  valor     numeric(10,2) not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------- receitas (hoje: expositores; "outro" cobre o resto) ----------
create table if not exists public.fin_receitas (
  id             bigint generated always as identity primary key,
  criado_em      timestamptz not null default now(),
  data           date not null default current_date,
  tipo           text not null default 'expositor' check (tipo in ('expositor','investimento','outro')),
  expositor_nome text,
  categoria_id   bigint references public.fin_categorias_expositor(id),
  descricao      text,
  valor          numeric(10,2) not null,
  status         text not null default 'pago' check (status in ('pago','pendente','cancelado')),
  criado_por     uuid references auth.users(id)
);

-- ---------- despesas, por grupo + item ----------
create table if not exists public.fin_despesas (
  id          bigint generated always as identity primary key,
  criado_em   timestamptz not null default now(),
  data        date not null default current_date,
  grupo       text not null,   -- 'Marketing Digital' | 'Profissionais' | 'Equipe' | 'Infraestrutura' | 'Evento'
  item        text not null,   -- ex: 'Editor de Imagens', 'Hospedagem Hotel', 'Refeições — Almoço'...
  descricao   text,
  valor       numeric(10,2) not null,
  recorrente  boolean not null default false,
  status      text not null default 'pago' check (status in ('pago','pendente','cancelado')),
  criado_por  uuid references auth.users(id)
);

create index if not exists fin_receitas_data_idx on public.fin_receitas (data desc);
create index if not exists fin_despesas_data_idx on public.fin_despesas (data desc);
create index if not exists fin_despesas_grupo_idx on public.fin_despesas (grupo);

alter table public.fin_categorias_expositor enable row level security;
alter table public.fin_receitas enable row level security;
alter table public.fin_despesas enable row level security;

-- só gestor lê/escreve nas 3 tabelas (eh_gestor() já existe — seção 13)
drop policy if exists "gestor tudo categorias" on public.fin_categorias_expositor;
create policy "gestor tudo categorias" on public.fin_categorias_expositor
  for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

drop policy if exists "gestor tudo receitas" on public.fin_receitas;
create policy "gestor tudo receitas" on public.fin_receitas
  for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

drop policy if exists "gestor tudo despesas" on public.fin_despesas;
create policy "gestor tudo despesas" on public.fin_despesas
  for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

revoke all on public.fin_categorias_expositor from anon;
revoke all on public.fin_receitas from anon;
revoke all on public.fin_despesas from anon;

-- ---------- RPC: resumo pronto pro painel ----------
create or replace function public.rpc_financeiro_resumo()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total_receitas', (select coalesce(sum(valor),0) from public.fin_receitas where status = 'pago' and public.eh_gestor()),
    'total_despesas', (select coalesce(sum(valor),0) from public.fin_despesas where status = 'pago' and public.eh_gestor()),
    'pendente_receitas', (select coalesce(sum(valor),0) from public.fin_receitas where status = 'pendente' and public.eh_gestor()),
    'pendente_despesas', (select coalesce(sum(valor),0) from public.fin_despesas where status = 'pendente' and public.eh_gestor()),
    'qtd_expositores_pagos', (select count(*) from public.fin_receitas where status = 'pago' and tipo = 'expositor' and public.eh_gestor()),
    'despesas_por_grupo', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select grupo, sum(valor) as total
        from public.fin_despesas where status = 'pago' and public.eh_gestor()
        group by grupo) t),
    'despesas_por_mes', (select coalesce(json_agg(t order by t.mes), '[]'::json) from (
        select to_char(data,'YYYY-MM') as mes,
          sum(valor) filter (where status='pago') as pago,
          sum(valor) filter (where status='pendente') as pendente
        from public.fin_despesas where status in ('pago','pendente') and public.eh_gestor()
        group by 1) t),
    'receitas_por_tipo', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select tipo, count(*) as qtd, sum(valor) as total
        from public.fin_receitas where status = 'pago' and public.eh_gestor()
        group by tipo) t),
    'receitas_por_categoria', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
        select coalesce(c.nome, r.tipo) as categoria, count(*) as qtd, sum(r.valor) as total
        from public.fin_receitas r
        left join public.fin_categorias_expositor c on c.id = r.categoria_id
        where r.status = 'pago' and public.eh_gestor()
        group by 1) t)
  );
$$;
revoke execute on function public.rpc_financeiro_resumo() from public, anon;
grant execute on function public.rpc_financeiro_resumo() to authenticated;

notify pgrst, 'reload schema';
```

> A checagem `and public.eh_gestor()` **dentro** de cada subquery da RPC é
> de propósito: se um vendedor autenticado chamar essa função (ela é
> `security definer`, então ignora RLS por padrão), cada soma vira `0`/`[]`
> em vez de vazar dado financeiro. Defesa em profundidade, não confia só na
> policy das tabelas.

### 20.2. Categorias de expositor iniciais (ajustar valores reais)

```sql
insert into public.fin_categorias_expositor (nome, valor) values
  ('Categoria Bronze', 800.00),
  ('Categoria Prata',  1500.00),
  ('Categoria Ouro',   2500.00)
on conflict do nothing;
```

### 20.3. Taxonomia de despesas (grupo → itens fixos no painel)

> Revisado — evento tem sócio, então a categorização precisa bater exata
> com o que foi combinado, sem juntar grupos que o usuário pediu separados.

- **Marketing Digital:** Editor de Imagens, Editor de Vídeo, IA de Pesquisa (SEO), IA Generativa, E-mail Marketing, Disparo de WhatsApp
- **Profissionais:** Webdesigner, Copywriter, Social Media, Gestor de Tráfego
- **Equipe:** Equipe Comercial, Trackeamento de Dados Avançado
- **Infraestrutura:** Hospedagem TurboCloud (4 meses), Domínio (Anual)
- **Evento:** Hospedagem Hotel, Refeições — Café da Manhã, Refeições — Almoço, Refeições — Café da Tarde, Refeições — Janta

Sempre tem opção **"Outro"** com descrição livre, pra não travar o
lançamento em algo fora da lista. "Profissionais" (prestadores pagos por
serviço/projeto) e "Equipe" (papéis fixos da operação comercial) ficam em
grupos separados de propósito — eram um grupo só ("Profissionais & Equipe")
antes desta revisão.

### 20.3.1. Receitas — "entrada" inclui o aporte do sócio

`fin_receitas.tipo` tem 3 valores: **`expositor`** (venda por categoria de
valor), **`investimento`** (aporte/injeção de capital do sócio do evento —
usa o mesmo campo `expositor_nome` pra guardar o nome do sócio/investidor)
e **`outro`** (qualquer outra entrada, ex: patrocínio avulso). Os três
contam pra "Total recebido" — a distinção existe só pra dar visibilidade de
**composição** da receita pro sócio (o painel mostra um resumo por tipo
logo acima da lista de categorias). Já **Despesas** representa toda a
"saída" do evento, sem essa distinção — não tem contrapartida de "tipo"
do lado de despesa.

**Migração pra quem já rodou o SQL da seção 20.1 antes desta revisão**
(adiciona `investimento` ao check constraint existente — grupo/item de
despesa não precisa de migração porque são `text` livre, sem `check`):

```sql
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.fin_receitas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%';
  if c is not null then
    execute format('alter table public.fin_receitas drop constraint %I', c);
  end if;
end $$;
alter table public.fin_receitas add constraint fin_receitas_tipo_check
  check (tipo in ('expositor','investimento','outro'));

-- reaplicar a RPC inteira da seção 20.1 (ganhou os campos
-- qtd_expositores_pagos e receitas_por_tipo)
```

### 20.3.2. Editar lançamento (não só apagar)

Cada linha das tabelas de receita/despesa tem um botão **"Editar"** ao
lado de "Apagar" — transforma as células de Status e Valor em campos
editáveis (select + input) com Salvar/Cancelar, sem precisar apagar e
relançar. Útil pro caso comum de marcar uma despesa/receita que estava
"pendente" como "paga" quando o pagamento efetivamente sai. Faz `PATCH`
direto em `fin_receitas`/`fin_despesas` pelo `id` (RLS já garante que só
gestor consegue).

### 20.3.3. Despesas por mês + total geral até o evento

A seção "Despesas por grupo" ganhou uma segunda tabela, **"Despesas por
mês"**, agrupando por `to_char(data,'YYYY-MM')` com pago/pendente/total
por mês e uma linha de **Total geral** somando tudo (pago + pendente,
excluindo cancelado) — dá a visão de fluxo de caixa mês a mês até a data
do evento, que a RPC já retorna pronta em `despesas_por_mes`.

### 20.4. Acesso

`Ads/financeiro.html` — mesmo login/senha da equipe (`crm.html`), mas com
checagem extra: só quem tem `papel = 'gestor'` na `perfis` entra; vendedor
vê mensagem de acesso restrito e é deslogado. Mesma base de código (fetch
direto pra API REST, evitando o lock do supabase-js — ver seção 13.3).

## 21. CRM — enviar e-mail pro lead (Resend)

**Domínio verificado no Resend (16/09/2026):** `novvasaudeintegrativa.com.br`
— DKIM, SPF (`rsend`/`send`) e DMARC com check verde, "Enable Sending"
ligado. "Enable Receiving" **desligado de propósito**: o CRM só dispara
e-mail, nunca recebe/processa resposta por e-mail (quem responde, responde
pelo WhatsApp normal, que já está coberto pelo §14).

**Remetente:** `Novva Saúde Integrativa <contato@novvasaudeintegrativa.com.br>`.

Botão ✉️ no card do lead (que antes era só um `mailto:`) agora abre um
modal no próprio `crm.html` (assunto + mensagem) e dispara pela Edge
Function `email-send`, que chama a API do Resend — mesmo padrão de auth do
`whatsapp-send` (§14.6): exige o JWT do usuário logado e confere
`perfis.ativo`. Cada envio fica logado em `emails_enviados` (pra auditoria/
histórico — hoje sem exibição de thread, ao contrário do WhatsApp).

### 21.1. SQL — rodar uma vez no SQL Editor

```sql
create table if not exists public.emails_enviados (
  id             bigint generated always as identity primary key,
  criado_em      timestamptz not null default now(),
  lead_whatsapp  text,
  destinatario   text not null,
  assunto        text not null,
  corpo          text not null,
  resend_id      text,
  status         text,
  enviado_por    uuid references auth.users(id),
  raw            jsonb not null default '{}'::jsonb
);
create index if not exists emails_enviados_lead_idx on public.emails_enviados (lead_whatsapp, criado_em);
alter table public.emails_enviados enable row level security;

-- mesmo modelo de visibilidade aberta do §17: qualquer membro ativo vê tudo
drop policy if exists "equipe vê emails" on public.emails_enviados;
create policy "equipe vê emails" on public.emails_enviados
  for select to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

-- ninguém escreve por aqui a não ser a Edge Function (service role)
revoke insert, update, delete on public.emails_enviados from anon, authenticated;

notify pgrst, 'reload schema';
```

### 21.2. Edge Function `email-send`

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`email-send`** → editor no navegador → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Novva Saúde Integrativa <contato@novvasaudeintegrativa.com.br>";

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

  const email = String(body.email || "").trim();
  const assunto = String(body.assunto || "").trim();
  const corpo = String(body.corpo || "").trim();
  const leadWhatsapp = body.lead_whatsapp ? String(body.lead_whatsapp).replace(/\D/g, "") : null;
  if (!email || !assunto || !corpo) return j({ erro: "email, assunto e corpo obrigatórios" }, 400);

  // corpo vem em texto puro do textarea do CRM — vira HTML simples (parágrafo por linha em branco)
  const html = corpo.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: assunto, html, text: corpo }),
  });
  const resendBody = await resendResp.json();
  if (!resendResp.ok) return j({ erro: resendBody.message || "falha ao enviar" }, 502);

  await fetch(`${URL_}/rest/v1/emails_enviados`, {
    method: "POST",
    headers: { ...svcHeaders, prefer: "return=minimal" },
    body: JSON.stringify([{
      lead_whatsapp: leadWhatsapp, destinatario: email, assunto, corpo,
      resend_id: resendBody.id || null, status: "sent", enviado_por: u.id, raw: resendBody,
    }]),
  });

  return j({ ok: true, resend_id: resendBody.id });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO** (o CRM manda
o JWT do usuário logado, igual o `whatsapp-send`/`equipe-admin`).

**Secrets** (Edge Functions → Secrets):
- `RESEND_API_KEY` — Resend → **API Keys** → **Create API Key** (permissão
  "Sending access" já basta, não precisa "Full access").

### 21.3. O que o `crm.html` faz

- Botão ✉️ no card (só aparece se o lead tiver e-mail) abre um modal com
  campos **Assunto** e **Mensagem**.
- Enviar chama `email-send`, que dispara pelo Resend e grava o log em
  `emails_enviados`.
- Sem thread de e-mail no CRM (diferente do WhatsApp) — é disparo avulso,
  não conversa. Se um dia precisar de histórico visível por lead, dá pra
  listar `emails_enviados` na mesma view do card.

### 21.4. Conferir

- Resend → **Logs** (ou **Emails**) → deve aparecer o envio com status
  "delivered" (pode levar alguns segundos).
- Supabase → **Table Editor → emails_enviados** → linha gravada com
  `resend_id` preenchido.
- Se o botão der erro "usuário inativo" ou 401: confere se o usuário
  logado tem linha ativa em `perfis` (mesma checagem do `whatsapp-send`).

## 22. CRM — Campanhas de e-mail pra listas antigas (compradores VIP/Lote 1-3)

Diferente do §21 (e-mail avulso pra 1 lead direto do card), isso é **disparo
em massa pra uma lista importada** — ex.: compradores de edições anteriores
do congresso, exportados da Eduzz em CSV/Excel. **Só o Gestor** cria/dispara
campanhas (vendedor não vê essa seção).

**Decisões (16/09/2026):**
- **Sem agendamento automático** — o Gestor entra no CRM e clica em "Enviar
  próximo lote" quando quiser. Nada dispara sozinho.
- **Lote de até 100 por clique** — é a recomendação do Resend pra domínio
  novo (esquenta a reputação aos poucos em vez de estourar tudo de uma vez).
  Clicando várias vezes em dias diferentes, a lista inteira vai sendo
  enviada aos poucos.
- **Importação por CSV** — Gestor sobe um arquivo com colunas `nome`,
  `email`, `lote` (aceita `,` ou `;` como separador, cabeçalho
  case-insensitive) exportado do Excel/Eduzz.
- **Personalização simples** — se o assunto ou corpo tiver `{{nome}}`, é
  substituído pelo nome do contato na hora do envio.

### 22.1. SQL — rodar uma vez no SQL Editor

```sql
create table if not exists public.campanhas_email (
  id          bigint generated always as identity primary key,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id),
  nome        text not null,
  assunto     text not null,
  corpo       text not null
);
alter table public.campanhas_email enable row level security;

drop policy if exists "gestor ve campanhas" on public.campanhas_email;
create policy "gestor ve campanhas" on public.campanhas_email
  for select to authenticated using (public.eh_gestor());

drop policy if exists "gestor cria campanhas" on public.campanhas_email;
create policy "gestor cria campanhas" on public.campanhas_email
  for insert to authenticated with check (public.eh_gestor());

drop policy if exists "gestor apaga campanhas" on public.campanhas_email;
create policy "gestor apaga campanhas" on public.campanhas_email
  for delete to authenticated using (public.eh_gestor());

revoke update on public.campanhas_email from authenticated;

create table if not exists public.campanha_contatos (
  id           bigint generated always as identity primary key,
  campanha_id  bigint not null references public.campanhas_email(id) on delete cascade,
  nome         text,
  email        text not null,
  lote         text,
  status       text not null default 'pendente' check (status in ('pendente','enviado','falhou')),
  enviado_em   timestamptz,
  resend_id    text,
  erro         text
);
create index if not exists campanha_contatos_campanha_idx on public.campanha_contatos (campanha_id, status);
alter table public.campanha_contatos enable row level security;

drop policy if exists "gestor ve contatos" on public.campanha_contatos;
create policy "gestor ve contatos" on public.campanha_contatos
  for select to authenticated using (public.eh_gestor());

drop policy if exists "gestor importa contatos" on public.campanha_contatos;
create policy "gestor importa contatos" on public.campanha_contatos
  for insert to authenticated with check (public.eh_gestor());

drop policy if exists "gestor apaga contatos" on public.campanha_contatos;
create policy "gestor apaga contatos" on public.campanha_contatos
  for delete to authenticated using (public.eh_gestor());

-- status só muda pela Edge Function (service role) — ninguém faz UPDATE direto
revoke update on public.campanha_contatos from authenticated;

-- resumo por campanha (total/pendentes/enviados/falhas), pronto pro painel
create or replace view public.campanhas_resumo with (security_invoker = true) as
select
  c.id, c.criado_em, c.nome, c.assunto, c.corpo,
  count(k.id) as total,
  count(k.id) filter (where k.status = 'pendente') as pendentes,
  count(k.id) filter (where k.status = 'enviado')  as enviados,
  count(k.id) filter (where k.status = 'falhou')   as falhas
from public.campanhas_email c
left join public.campanha_contatos k on k.campanha_id = c.id
group by c.id
order by c.criado_em desc;

grant select on public.campanhas_resumo to authenticated;

notify pgrst, 'reload schema';
```

### 22.2. Edge Function `campanha-email-lote`

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`campanha-email-lote`** → editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Novva Saúde Integrativa <contato@novvasaudeintegrativa.com.br>";
const LOTE_MAX = 100;

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

function preencher(txt: string, nome: string) {
  return String(txt || "").replace(/\{\{nome\}\}/g, nome || "");
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
  if (!(await ehGestor(u.id))) return j({ erro: "só o gestor pode disparar campanhas" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
  const campanhaId = Number(body.campanha_id);
  const lote = Math.min(Number(body.lote) || LOTE_MAX, LOTE_MAX);
  if (!campanhaId) return j({ erro: "campanha_id obrigatório" }, 400);

  const campResp = await fetch(`${URL_}/rest/v1/campanhas_email?id=eq.${campanhaId}&select=assunto,corpo`, { headers: svcHeaders });
  const campRows = await campResp.json();
  const camp = campRows && campRows[0];
  if (!camp) return j({ erro: "campanha não encontrada" }, 404);

  const pendResp = await fetch(
    `${URL_}/rest/v1/campanha_contatos?campanha_id=eq.${campanhaId}&status=eq.pendente&select=id,nome,email&order=id.asc&limit=${lote}`,
    { headers: svcHeaders }
  );
  const pendentes = await pendResp.json();

  let enviados = 0, falhas = 0;
  for (const c of pendentes) {
    const assunto = preencher(camp.assunto, c.nome);
    const corpoTxt = preencher(camp.corpo, c.nome);
    const html = corpoTxt.split(/\n{2,}/).map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [c.email], subject: assunto, html, text: corpoTxt }),
      });
      const rb = await r.json();
      if (!r.ok) throw new Error(rb.message || "falha resend");
      await fetch(`${URL_}/rest/v1/campanha_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "enviado", enviado_em: new Date().toISOString(), resend_id: rb.id || null }),
      });
      enviados++;
    } catch (e) {
      await fetch(`${URL_}/rest/v1/campanha_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "falhou", erro: String(e) }),
      });
      falhas++;
    }
  }

  return j({ ok: true, enviados, falhas, tentativas: pendentes.length });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO** (mesmo padrão
do `email-send`/`whatsapp-send`) — não precisa de secret novo, reusa o
`RESEND_API_KEY` já configurado no §21.2.

### 22.3. Edge Function `gerar-texto-campanha` (botão "✨ Gerar com IA")

Reusa o secret `ANTHROPIC_API_KEY` que já existe no projeto (mesmo usado
pela Cris, §16) — não precisa criar de novo. Gestor descreve em 1 frase o
que o e-mail deve dizer, a IA devolve assunto + corpo já no tom da marca
(persona em `docs/persona.md`), prontos pra revisar antes de criar a
campanha.

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`gerar-texto-campanha`** → editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Você escreve e-mails de campanha pro Congresso Câncer 2026, evento de 2 dias em São Paulo sobre práticas integrativas oncológicas.

Público-alvo: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos. Dores: insegurança pra responder sobre terapia complementar, sensação de estagnação técnica, medo de responsabilização ética/legal. Desejos: ampliar repertório técnico, ganhar autoridade e networking com nomes de peso da área, encontrar comunidade de pares.

Essas listas são de PESSOAS QUE JÁ COMPRARAM em edições anteriores do congresso — trate como reengajamento/reconexão com quem já conhece o evento, não como primeiro contato frio.

Regras:
- Tom brasileiro, caloroso, direto, sem exagero de urgência falsa.
- Pode (e deve) usar {{nome}} no assunto ou no corpo pra personalizar — o sistema substitui pelo nome de cada contato na hora do envio.
- Não invente data, preço, lote ou palestrante — se precisar citar algo assim, deixe um placeholder claro tipo [DATA] ou [LINK] pro Gestor completar antes de mandar.
- Corpo em texto simples, parágrafos curtos (o sistema converte quebra de linha dupla em parágrafo).
- Responda SOMENTE com um JSON válido, sem markdown, no formato exato: {"assunto": "...", "corpo": "..."}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return j({ erro: "method" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const r1 = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!r1.ok) return j({ erro: "não autenticado" }, 401);
  const u = await r1.json();
  if (!u || !u.id) return j({ erro: "não autenticado" }, 401);
  const rp = await fetch(`${URL_}/rest/v1/perfis?id=eq.${u.id}&select=papel,ativo`, { headers: svcHeaders });
  const perfis = await rp.json();
  const meu = perfis && perfis[0];
  if (!meu || !meu.ativo || meu.papel !== "gestor") return j({ erro: "só o gestor pode gerar texto" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
  const brief = String(body.brief || "").trim();
  if (!brief) return j({ erro: "descreva o que o e-mail deve dizer" }, 400);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 800, system: SYSTEM,
      messages: [{ role: "user", content: brief }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("anthropic error", resp.status, errBody);
    return j({ erro: "falha ao gerar texto (" + resp.status + "): " + errBody.slice(0, 300) }, 502);
  }
  const data = await resp.json();
  const texto = (data.content || []).map((b: any) => b.text || "").join("");
  let parsed: any;
  try { parsed = JSON.parse(texto); } catch { return j({ erro: "IA respondeu em formato inesperado, tenta de novo" }, 502); }
  if (!parsed.assunto || !parsed.corpo) return j({ erro: "IA não retornou assunto/corpo" }, 502);

  return j({ ok: true, assunto: parsed.assunto, corpo: parsed.corpo });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO**.

### 22.4. O que o `crm.html` faz

Seção **"Campanhas"** no fim da página, **só visível pro Gestor**:

- Campo "Descreva o que o e-mail deve dizer" + botão **✨ Gerar com IA**,
  que chama `gerar-texto-campanha` e preenche Assunto/Corpo — o Gestor
  revisa/edita antes de criar a campanha (a IA nunca dispara nada sozinha).
- Formulário: nome da campanha, assunto, corpo (aceita `{{nome}}`) e um
  arquivo CSV (`nome,email,lote`) — ao criar, insere a campanha e importa
  todos os contatos como `pendente`. **Um único assunto/corpo por
  campanha** — o CSV pode misturar Lote 1, 2, 3 e VIP juntos, todo mundo
  recebe o mesmo e-mail (a coluna `lote` fica só pra referência/relatório).
- Lista de campanhas com contagem (total / pendentes / enviados / falhas)
  vinda de `campanhas_resumo`.
- Botão **"Enviar próximo lote"** em cada campanha, chama
  `campanha-email-lote` (até 100 pendentes por clique) e atualiza a
  contagem.

### 22.5. Conferir

- Supabase → **Table Editor → campanhas_email / campanha_contatos** →
  depois de importar o CSV, os contatos devem aparecer com
  `status = 'pendente'`.
- Depois de clicar "Enviar próximo lote": linhas viram `enviado` (com
  `resend_id`) ou `falhou` (com `erro` preenchido — confere o texto do erro,
  geralmente é e-mail inválido no CSV).
- Resend → **Logs** deve mostrar os envios um a um.

## 23. Medidor de gasto de IA (Cris + Campanhas)

**Por quê (16/09/2026):** a conta da Anthropic ficou sem crédito
(-US$ 0,01) sem ninguém perceber, e isso quebra silenciosamente **dois**
recursos que usam a mesma `ANTHROPIC_API_KEY`: a Cris respondendo no
WhatsApp (§16) e o "Gerar com IA" das campanhas (§22.3). Recarga automática
na Anthropic resolve o "ficar sem crédito do nada", mas o Gestor pediu
**precisão** de quanto cada coisa gasta — não estimativa, e sim o custo
real calculado a partir dos tokens que cada chamada devolve
(`usage.input_tokens`/`usage.output_tokens` na resposta da Anthropic).

**Preço usado no cálculo (Claude Haiku 4.5, modelo usado nas duas
funções):** US$ 1,00 por milhão de tokens de entrada, US$ 5,00 por milhão
de tokens de saída.

### 23.1. SQL — rodar uma vez no SQL Editor

```sql
create table if not exists public.ia_uso (
  id             bigint generated always as identity primary key,
  criado_em      timestamptz not null default now(),
  origem         text not null check (origem in ('cris_whatsapp','campanha_ia')),
  modelo         text not null,
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  custo_usd      numeric(10,4) not null default 0
);
create index if not exists ia_uso_criado_idx on public.ia_uso (criado_em);
alter table public.ia_uso enable row level security;

drop policy if exists "gestor ve ia uso" on public.ia_uso;
create policy "gestor ve ia uso" on public.ia_uso
  for select to authenticated using (public.eh_gestor());

-- ninguém escreve por aqui a não ser as Edge Functions (service role)
revoke insert, update, delete on public.ia_uso from anon, authenticated;

-- resumo por mês/origem, pronto pro painel
create or replace view public.ia_uso_resumo with (security_invoker = true) as
select
  to_char(criado_em, 'YYYY-MM') as mes,
  origem,
  count(*) as chamadas,
  sum(tokens_entrada) as tokens_entrada,
  sum(tokens_saida) as tokens_saida,
  sum(custo_usd) as custo_usd
from public.ia_uso
group by 1, 2
order by 1 desc, 2;

grant select on public.ia_uso_resumo to authenticated;

notify pgrst, 'reload schema';
```

### 23.2. Atualizar `gerar-texto-campanha` (loga cada geração)

No editor da função (Edge Functions → gerar-texto-campanha), troca o final
da função — de `const data = await resp.json();` até o final — por isso
(adiciona o log de uso antes do `return`):

```ts
  const data = await resp.json();
  const texto = (data.content || []).map((b: any) => b.text || "").join("");
  let parsed: any;
  try {
    // às vezes o modelo embrulha em ```json ... ``` mesmo pedindo só JSON —
    // tira a cerca de markdown e pega só o trecho entre { } antes de parsear
    const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = limpo.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : limpo);
  } catch { return j({ erro: "IA respondeu em formato inesperado, tenta de novo" }, 502); }
  if (!parsed.assunto || !parsed.corpo) return j({ erro: "IA não retornou assunto/corpo" }, 502);

  try {
    const u2 = data.usage || {};
    const custo = ((u2.input_tokens || 0) / 1e6) * 1.0 + ((u2.output_tokens || 0) / 1e6) * 5.0;
    await fetch(`${URL_}/rest/v1/ia_uso`, {
      method: "POST", headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify([{ origem: "campanha_ia", modelo: "claude-haiku-4-5-20251001", tokens_entrada: u2.input_tokens || 0, tokens_saida: u2.output_tokens || 0, custo_usd: custo }]),
    });
  } catch (e) { console.error("log ia_uso:", e); }

  try {
    await fetch(`${URL_}/rest/v1/campanha_ia_geracoes`, {
      method: "POST", headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify([{ criado_por: u.id, brief, assunto: parsed.assunto, corpo: parsed.corpo }]),
    });
  } catch (e) { console.error("log geracao ia:", e); }

  return j({ ok: true, assunto: parsed.assunto, corpo: parsed.corpo });
});
```

**Deploy.**

### 23.3. Atualizar `whatsapp-webhook` (loga cada resposta da Cris)

**Não repaste a função inteira** — é grande e já quebrou 2x por edição
manual (ver histórico no §14.4/§18.4). São só 3 adições pequenas e
pontuais no editor da função (Edge Functions → whatsapp-webhook):

**1.** Logo abaixo da linha `const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;`, adiciona:

```ts
const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;
```

**2.** Logo abaixo da linha `const svcHeaders = { apikey: SVC_KEY, authorization: ... };`, adiciona essa função nova:

```ts
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
```

**3.** Dentro de `crisResponde()`, logo depois da linha
`const data = await resp.json();` (a que já existe, dentro dessa função,
depois do `fetch` pra Anthropic), adiciona uma linha:

```ts
  const data = await resp.json();
  await logarUsoIA(data.usage);
```

(a linha `await logarUsoIA(data.usage);` é a única linha nova ali — o
resto do `crisResponde()` continua igual.)

**Deploy.**

### 23.4. O que o `crm.html` mostra

No topo da seção "Campanhas", uma linha com o gasto de IA do mês atual
(Cris + Campanhas somados, e quebrado por origem), lida de
`ia_uso_resumo`. Só o Gestor vê.

### 23.5. Conferir

- Manda uma mensagem de teste pro WhatsApp do congresso (Cris deve
  responder) e clica em "Gerar com IA" numa campanha — depois olha
  **Table Editor → ia_uso**: devem aparecer linhas novas com
  `tokens_entrada`/`tokens_saida`/`custo_usd` preenchidos (não zerados).
- O total mostrado no CRM deve bater com a soma dessas linhas do mês
  atual.
- Isso é uma estimativa **nossa**, calculada localmente pelo preço do
  Haiku 4.5 — não é o saldo oficial da conta Anthropic (esse só aparece
  no console.anthropic.com). Serve pra acompanhar tendência e detectar
  gasto fora do normal, não substitui olhar o console de vez em quando.

## 24. Captura de opt-in de WhatsApp (pré-requisito pra campanha de marketing por lá)

**Por quê (16/09/2026):** o Gestor queria disparo de marketing em massa
pelo WhatsApp pra lista de compradores antigos (igual §22, mas por
WhatsApp). Pesquisei a política atual da Meta antes de construir isso:

- Mensagem de marketing custa ~R$ 0,31/disparo no Brasil (vs. ~R$ 0,034
  de utilidade), sem desconto por volume, cobrada mesmo dentro da janela
  de 24h.
- **Precisa de opt-in específico pro WhatsApp** — a documentação oficial
  da Meta diz que uma relação de cliente já existente (ex.: comprou
  ingresso em edição passada) **não conta automaticamente** como opt-in.
  Precisa de uma ação afirmativa da pessoa, nomeando o negócio, nesse
  canal.
- A lista de compradores antigos (Eduzz) **não tem esse opt-in
  documentado** — só sabemos que compraram, não que aceitaram receber
  WhatsApp de marketing.

Mandar campanha de marketing sem esse opt-in arrisca a **qualidade do
número** — e é o mesmo número que a Cris usa pra atender lead de verdade
(§16/§18), então uma restrição ali quebra os dois recursos. Por isso, o
disparo de marketing em massa por WhatsApp **fica pra depois**, só depois
de existir uma lista de gente que realmente optou. Esta seção constrói só
a **captura desse opt-in**, usando o e-mail (canal sem essa exigência da
Meta) como ponte.

**Mecânica:** o corpo do e-mail de campanha ganha um link
`https://wa.me/5511934873737?text=...` com uma mensagem pronta. Quando a
pessoa clica e manda essa mensagem, isso chega como mensagem normal no
`whatsapp-webhook` — a mesma frase é detectada e a pessoa é registrada
numa tabela própria de opt-in, com timestamp e o texto recebido (auditoria
de que o consentimento existe, se um dia precisar comprovar pra Meta).

### 24.1. SQL — rodar uma vez no SQL Editor

```sql
create table if not exists public.whatsapp_marketing_optin (
  whatsapp       text primary key,
  criado_em      timestamptz not null default now(),
  origem         text,
  texto_recebido text
);
alter table public.whatsapp_marketing_optin enable row level security;

drop policy if exists "gestor ve optin whatsapp" on public.whatsapp_marketing_optin;
create policy "gestor ve optin whatsapp" on public.whatsapp_marketing_optin
  for select to authenticated using (public.eh_gestor());

-- ninguém escreve por aqui a não ser o whatsapp-webhook (service role)
revoke insert, update, delete on public.whatsapp_marketing_optin from anon, authenticated;

notify pgrst, 'reload schema';
```

### 24.2. Atualizar `whatsapp-webhook` (detecta a frase de opt-in)

De novo, **não repaste a função inteira** — só 3 adições pontuais.

**1.** Logo abaixo da linha `const svcHeaders = { apikey: SVC_KEY, ... };`
(a mesma região onde entrou a `logarUsoIA` do §23.3), adiciona:

```ts
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
```

**2.** Dentro do `Deno.serve`, no loop principal, acha o trecho (é dentro de
`for (const m of v.messages ?? []) { ... }`):

```ts
        numerosRecebidos.add(m.from);
```

e adiciona uma linha **logo acima** dela:

```ts
        await registrarOptinWhatsapp(m.from, texto);
        numerosRecebidos.add(m.from);
```

(só essa linha nova — `numerosRecebidos.add(m.from);` continua exatamente
igual, só ganhou uma linha acima.)

**Deploy.**

### 24.3. O que o `crm.html` faz

- Na seção **Campanhas**, um botão **📱 Inserir CTA de opt-in WhatsApp**
  perto do corpo do e-mail — adiciona automaticamente o parágrafo com o
  link `wa.me` pronto no fim do texto.
- Nova seção **"Opt-in WhatsApp"** (só Gestor): mostra quantas pessoas já
  optaram, com tabela (número, data) e botão de exportar CSV — essa lista
  exportada é o material bruto pra, no futuro, montar a campanha de
  marketing por WhatsApp de verdade (igual §22, mas com a lista certa).

### 24.4. Conferir

- Manda a mensagem "Quero receber novidades do Congresso Câncer 2026 por
  WhatsApp" pro número do congresso (simulando o clique no link).
- Confere **Table Editor → whatsapp_marketing_optin** → deve aparecer uma
  linha nova.
- Confere no CRM, seção "Opt-in WhatsApp", se a contagem aumentou.

## 25. Campanhas de marketing por WhatsApp (template aprovado)

**Pré-requisito que não dá pra pular:** WhatsApp só aceita mensagem
business-iniciada fora da janela de 24h se for um **template aprovado pela
Meta**. O CRM não cria nem aprova template — isso é feito manualmente em
**business.facebook.com → WhatsApp Manager → Modelos de mensagem**,
categoria **Marketing**. O que o CRM faz: ajuda a *rascunhar* o texto (IA),
guarda a lista de contatos, e dispara usando o **nome exato** do template
depois de aprovado.

**Só use contatos de `whatsapp_marketing_optin` (§24)** — a base geral
(Eduzz, quiz) não tem o opt-in específico exigido pra Marketing (ver
discussão de compliance em 16-17/09/2026: risco real de banimento do
mesmo número que a Cris usa).

### 25.1. SQL — rodar uma vez no SQL Editor

```sql
create table if not exists public.campanhas_whatsapp (
  id             bigint generated always as identity primary key,
  criado_em      timestamptz not null default now(),
  criado_por     uuid references auth.users(id),
  nome           text not null,
  template_nome  text not null,
  idioma         text not null default 'pt_BR',
  variavel_nome  boolean not null default true
);
alter table public.campanhas_whatsapp enable row level security;

drop policy if exists "gestor ve campanhas whatsapp" on public.campanhas_whatsapp;
create policy "gestor ve campanhas whatsapp" on public.campanhas_whatsapp
  for select to authenticated using (public.eh_gestor());
drop policy if exists "gestor cria campanhas whatsapp" on public.campanhas_whatsapp;
create policy "gestor cria campanhas whatsapp" on public.campanhas_whatsapp
  for insert to authenticated with check (public.eh_gestor());
drop policy if exists "gestor apaga campanhas whatsapp" on public.campanhas_whatsapp;
create policy "gestor apaga campanhas whatsapp" on public.campanhas_whatsapp
  for delete to authenticated using (public.eh_gestor());

grant select, insert, delete on public.campanhas_whatsapp to authenticated;
revoke update on public.campanhas_whatsapp from authenticated;

create table if not exists public.campanha_whatsapp_contatos (
  id            bigint generated always as identity primary key,
  campanha_id   bigint not null references public.campanhas_whatsapp(id) on delete cascade,
  numero        text not null,
  nome          text,
  lote          text,
  status        text not null default 'pendente' check (status in ('pendente','enviado','falhou')),
  enviado_em    timestamptz,
  wa_message_id text,
  erro          text
);
create index if not exists campanha_wa_contatos_campanha_idx on public.campanha_whatsapp_contatos (campanha_id, status);
alter table public.campanha_whatsapp_contatos enable row level security;

drop policy if exists "gestor ve contatos whatsapp" on public.campanha_whatsapp_contatos;
create policy "gestor ve contatos whatsapp" on public.campanha_whatsapp_contatos
  for select to authenticated using (public.eh_gestor());
drop policy if exists "gestor importa contatos whatsapp" on public.campanha_whatsapp_contatos;
create policy "gestor importa contatos whatsapp" on public.campanha_whatsapp_contatos
  for insert to authenticated with check (public.eh_gestor());
drop policy if exists "gestor apaga contatos whatsapp" on public.campanha_whatsapp_contatos;
create policy "gestor apaga contatos whatsapp" on public.campanha_whatsapp_contatos
  for delete to authenticated using (public.eh_gestor());

grant select, insert, delete on public.campanha_whatsapp_contatos to authenticated;
revoke update on public.campanha_whatsapp_contatos from authenticated;

create or replace view public.campanhas_whatsapp_resumo with (security_invoker = true) as
select
  c.id, c.criado_em, c.nome, c.template_nome, c.idioma,
  count(k.id) as total,
  count(k.id) filter (where k.status = 'pendente') as pendentes,
  count(k.id) filter (where k.status = 'enviado')  as enviados,
  count(k.id) filter (where k.status = 'falhou')   as falhas
from public.campanhas_whatsapp c
left join public.campanha_whatsapp_contatos k on k.campanha_id = c.id
group by c.id
order by c.criado_em desc;

grant select on public.campanhas_whatsapp_resumo to authenticated;

alter table public.ia_uso drop constraint if exists ia_uso_origem_check;
alter table public.ia_uso add constraint ia_uso_origem_check
  check (origem in ('cris_whatsapp','campanha_ia','campanha_ia_whatsapp'));

notify pgrst, 'reload schema';
```

> **Pegadinha (16/09/2026):** ao criar a tabela já **revogamos**
> insert/update/delete do papel `authenticated` por hábito (padrão usado
> em outras tabelas) e isso quebrou o apagar até virem os `grant`
> explícitos junto com a policy — RLS sozinha não basta, precisa do
> `grant` na tabela também. Por isso aqui já vem com `grant` desde o
> início.

### 25.2. Edge Function `gerar-texto-whatsapp` (rascunha o template, não envia nada)

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = `Você escreve o RASCUNHO de um template de mensagem do WhatsApp Business Platform (Meta), pro Congresso Câncer 2026 (evento de práticas integrativas oncológicas, São Paulo — público B2B: profissional de saúde, não paciente).

Regras estruturais obrigatórias (reduzem risco de rejeição pela Meta, mas não garantem aprovação — a revisão final é sempre da Meta):
- Texto simples, sem markdown, sem emoji em excesso (no máximo 1-2), sem CAIXA ALTA, sem excesso de pontuação/exclamação.
- Pode usar exatamente UMA variável, escrita como {{1}}, representando o nome da pessoa. NÃO comece nem termine a mensagem com {{1}}. Não crie outras variáveis.
- Não inclua links/URLs no corpo do texto — links em template viram botão separado, configurado depois no WhatsApp Manager. Se precisar referenciar, deixe [LINK] como placeholder.
- Até 1024 caracteres, de preferência bem mais curto (3-5 linhas).
- Não invente data, preço ou link — se precisar citar algo assim, deixe [LINK] ou [DATA] como placeholder pro Gestor completar depois de aprovado.
- Evite linguagem que pareça fazer promessa/alegação de saúde (é evento B2B de capacitação profissional, não produto de saúde pro consumidor final).
- Tom brasileiro, direto.
- Responda SOMENTE com um JSON válido, sem markdown, no formato exato: {"corpo": "..."}`;

const REGRAS_POR_CATEGORIA: Record<string, string> = {
  marketing: `Categoria: MARKETING (promocional/convite).
- É pra reengajar quem JÁ comprou em edição anterior E JÁ autorizou especificamente receber esse tipo de mensagem — trate como reconexão com quem conhece o evento, não como contato frio nem venda agressiva.
- Tom caloroso, sem urgência falsa.`,
  utility: `Categoria: UTILITY (atualização/transacional).
- Regra crítica: NÃO pode ter absolutamente NENHUM tom promocional, convite pra comprar, oferta ou venda — se tiver qualquer traço promocional, a Meta reclassifica o template inteiro como Marketing e derruba o propósito dele.
- É só pra informar algo objetivo sobre algo que a pessoa JÁ iniciou/já faz parte (ex: confirmação de inscrição, lembrete de data/horário de algo que ela já vai, atualização de status). Não convide pra comprar nem para se inscrever pela primeira vez.
- Tom neutro, informativo, direto ao ponto.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return j({ erro: "method" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const r1 = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!r1.ok) return j({ erro: "não autenticado" }, 401);
  const u = await r1.json();
  if (!u || !u.id) return j({ erro: "não autenticado" }, 401);
  const rp = await fetch(`${URL_}/rest/v1/perfis?id=eq.${u.id}&select=papel,ativo`, { headers: svcHeaders });
  const perfis = await rp.json();
  const meu = perfis && perfis[0];
  if (!meu || !meu.ativo || meu.papel !== "gestor") return j({ erro: "só o gestor pode gerar texto" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
  const brief = String(body.brief || "").trim();
  const categoria = String(body.categoria || "marketing").trim().toLowerCase();
  if (!brief) return j({ erro: "descreva o que a mensagem deve dizer" }, 400);
  if (categoria === "authentication") {
    return j({ erro: "Template de Authentication (código de verificação) é gerado automaticamente pela Meta — não tem texto customizado pra rascunhar aqui" }, 400);
  }
  const regras = REGRAS_POR_CATEGORIA[categoria] || REGRAS_POR_CATEGORIA.marketing;
  const SYSTEM = `${BASE}\n\n${regras}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 400, system: SYSTEM,
      messages: [{ role: "user", content: brief }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("anthropic error", resp.status, errBody);
    return j({ erro: "falha ao gerar texto (" + resp.status + "): " + errBody.slice(0, 300) }, 502);
  }
  const data = await resp.json();
  const texto = (data.content || []).map((b: any) => b.text || "").join("");
  let parsed: any;
  try {
    const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = limpo.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : limpo);
  } catch { return j({ erro: "IA respondeu em formato inesperado, tenta de novo" }, 502); }
  if (!parsed.corpo) return j({ erro: "IA não retornou o texto" }, 502);

  try {
    const u2 = data.usage || {};
    const custo = ((u2.input_tokens || 0) / 1e6) * 1.0 + ((u2.output_tokens || 0) / 1e6) * 5.0;
    await fetch(`${URL_}/rest/v1/ia_uso`, {
      method: "POST", headers: { ...svcHeaders, prefer: "return=minimal" },
      body: JSON.stringify([{ origem: "campanha_ia_whatsapp", modelo: "claude-haiku-4-5-20251001", tokens_entrada: u2.input_tokens || 0, tokens_saida: u2.output_tokens || 0, custo_usd: custo }]),
    });
  } catch (e) { console.error("log ia_uso:", e); }

  return j({ ok: true, corpo: parsed.corpo });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO**.

### 25.3. Edge Function `campanha-whatsapp-lote` (dispara de verdade)

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const LOTE_MAX = 100;

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

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const u = await quemChamou(token);
  if (!u) return j({ erro: "não autenticado" }, 401);
  if (!(await ehGestor(u.id))) return j({ erro: "só o gestor pode disparar campanhas" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
  const campanhaId = Number(body.campanha_id);
  const lote = Math.min(Number(body.lote) || LOTE_MAX, LOTE_MAX);
  if (!campanhaId) return j({ erro: "campanha_id obrigatório" }, 400);

  const campResp = await fetch(
    `${URL_}/rest/v1/campanhas_whatsapp?id=eq.${campanhaId}&select=template_nome,idioma,variavel_nome`,
    { headers: svcHeaders },
  );
  const campRows = await campResp.json();
  const camp = campRows && campRows[0];
  if (!camp) return j({ erro: "campanha não encontrada" }, 404);

  const pendResp = await fetch(
    `${URL_}/rest/v1/campanha_whatsapp_contatos?campanha_id=eq.${campanhaId}&status=eq.pendente&select=id,numero,nome&order=id.asc&limit=${lote}`,
    { headers: svcHeaders },
  );
  const pendentes = await pendResp.json();

  let enviados = 0, falhas = 0;
  for (const c of pendentes) {
    const components = camp.variavel_nome
      ? [{ type: "body", parameters: [{ type: "text", text: c.nome || "" }] }]
      : [];
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: c.numero,
          type: "template",
          template: { name: camp.template_nome, language: { code: camp.idioma }, components },
        }),
      });
      const rb = await r.json();
      if (!r.ok) throw new Error(rb.error?.message || "falha meta");
      const waId = rb.messages?.[0]?.id ?? null;
      await fetch(`${URL_}/rest/v1/campanha_whatsapp_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "enviado", enviado_em: new Date().toISOString(), wa_message_id: waId }),
      });
      enviados++;
    } catch (e) {
      await fetch(`${URL_}/rest/v1/campanha_whatsapp_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "falhou", erro: String(e) }),
      });
      falhas++;
    }
  }

  return j({ ok: true, enviados, falhas, tentativas: pendentes.length });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO**. Reusa
`WHATSAPP_PERMANENT_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` já existentes.

### 25.4. O que o `crm.html` faz

Layout em **2 colunas** (e-mail à esquerda, WhatsApp à direita — junto
com Opt-in WhatsApp e Qualidade do WhatsApp), tudo só visível pro Gestor:

- Formulário: nome, briefing + botão "Gerar rascunho com IA" (não envia
  nada, só ajuda a escrever o texto pra colar no WhatsApp Manager),
  campos manuais de **nome do template** e **idioma** (preenchidos só
  depois que a Meta aprovar), checkbox se o template usa `{{1}}`, e CSV
  (`numero`, `nome`, `lote` — número normalizado pra só dígitos).
- Lista de campanhas com contagem (enviados/pendentes/falhas), vinda de
  `campanhas_whatsapp_resumo`.
- Botão "Enviar próximo lote" (até 100 por clique, mesmo padrão de
  throttle do e-mail) chama `campanha-whatsapp-lote`.

### 25.5. Conferir

- Cria uma campanha de teste **só depois de ter um template real
  aprovado** — sem isso, "Enviar próximo lote" retorna erro da Meta
  dizendo que o template não existe/não está aprovado.
- Depois do disparo: `campanha_whatsapp_contatos.status` deve virar
  `enviado` (com `wa_message_id`) ou `falhou` (com `erro` — confere o
  texto, geralmente é número inválido ou template ainda em revisão).

### 25.6. Categoria do template (Marketing/Utility/Authentication)

**Por quê (17/09/2026):** o campo é educativo/checklist — a categoria de
verdade é decidida pela Meta na aprovação do template no WhatsApp
Manager, o CRM não manda isso pra API no envio (só referencia o nome do
template já aprovado). Mas ajuda a não misturar lista errada com
categoria errada, e ajusta as regras que a IA segue pra rascunhar.

```sql
alter table public.campanhas_whatsapp
  add column if not exists categoria text not null default 'marketing'
    check (categoria in ('marketing', 'utility', 'authentication'));

drop view if exists public.campanhas_whatsapp_resumo;
create view public.campanhas_whatsapp_resumo with (security_invoker = true) as
select
  c.id, c.criado_em, c.nome, c.template_nome, c.idioma, c.categoria,
  count(k.id) as total,
  count(k.id) filter (where k.status = 'pendente') as pendentes,
  count(k.id) filter (where k.status = 'enviado')  as enviados,
  count(k.id) filter (where k.status = 'falhou')   as falhas
from public.campanhas_whatsapp c
left join public.campanha_whatsapp_contatos k on k.campanha_id = c.id
group by c.id
order by c.criado_em desc;

grant select on public.campanhas_whatsapp_resumo to authenticated;

notify pgrst, 'reload schema';
```

> **Pegadinha:** `CREATE OR REPLACE VIEW` não deixa inserir coluna no
> meio da lista (só no final) — por isso precisou `DROP VIEW` + `CREATE`
> de novo em vez de só substituir. E rodar o `ALTER TABLE` **separado**
> do resto: se o bloco inteiro for uma transação só e uma parte falhar,
> tudo é desfeito (foi o que aconteceu na primeira tentativa).

`gerar-texto-whatsapp` (§25.2, código já atualizado acima) recebe
`categoria` no body e usa um prompt diferente por categoria:
**Marketing** permite tom promocional (pra quem já autorizou);
**Utility** exige tom estritamente informativo/transacional, sem nenhum
traço promocional (senão a Meta reclassifica o template inteiro pra
Marketing); **Authentication** retorna erro — esse tipo de template é
gerado automaticamente pela Meta, sem texto customizado.

### 25.7. Sinalizar no Kanban quem respondeu vindo de campanha WhatsApp

**Por quê (17/09/2026):** já sabemos quem recebeu cada campanha
(`campanha_whatsapp_contatos`) — quando essa pessoa responde, dá pra
cruzar o número e marcar isso no `lead_status`, mostrando um selo no
card do Kanban.

```sql
alter table public.lead_status
  add column if not exists campanha_whatsapp_id bigint references public.campanhas_whatsapp(id);

create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      l.nome, l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em,
      cw.nome as campanha_whatsapp_nome,
      (select max(
         case e.event
           when 'VideoComplete' then 100
           when 'VideoProgress' then (e.props->>'percent')::int
           when 'VideoPlay' then 0
           else null
         end)
       from public.events e
       where e.visitor_id = l.visitor_id
         and lower(coalesce(e.props->>'placement','')) = 'vsl'
         and e.event in ('VideoPlay','VideoProgress','VideoComplete')
      ) as vsl_progress
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    left join public.campanhas_whatsapp cw on cw.id = s.campanha_whatsapp_id
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';
```

No `whatsapp-webhook`, dentro de `CRIS_INSTRUCOES` (ver §18.4/§24.2),
adiciona a função (logo abaixo de `registrarOptinWhatsapp`):

```ts
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
```

E no loop principal (`Deno.serve`), logo abaixo de
`await registrarOptinWhatsapp(m.from, texto);`:

```ts
        await marcarOrigemCampanha(m.from);
```

No `crm.html`, o card do lead ganha um selo azul **"📣 [nome da
campanha]"** (classe `.badge.campanha-wa`) quando `l.campanha_whatsapp_nome`
vem preenchido — ao lado dos selos de nível/VSL/origem já existentes.

### 25.8. Edge Function `whatsapp-template-teste` (testar antes de criar a campanha)

Mesma ideia do "Enviar teste" do e-mail (§21) — manda o template pra um
número de teste usando os campos **atuais do formulário** (não precisa
salvar a campanha antes).

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;

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

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const u = await quemChamou(token);
  if (!u) return j({ erro: "não autenticado" }, 401);
  if (!(await ehGestor(u.id))) return j({ erro: "só o gestor pode testar template" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
  const numero = String(body.numero || "").replace(/\D/g, "");
  const templateNome = String(body.template_nome || "").trim();
  const idioma = String(body.idioma || "pt_BR").trim();
  const variavelNome = !!body.variavel_nome;
  const nomeTeste = String(body.nome_teste || "").trim();
  if (!numero || !templateNome) return j({ erro: "número e nome do template são obrigatórios" }, 400);

  const components = variavelNome
    ? [{ type: "body", parameters: [{ type: "text", text: nomeTeste || "Teste" }] }]
    : [];

  const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numero,
      type: "template",
      template: { name: templateNome, language: { code: idioma }, components },
    }),
  });
  const rb = await r.json();
  if (!r.ok) return j({ erro: rb.error?.message || "falha ao enviar" }, 502);

  return j({ ok: true, wa_message_id: rb.messages?.[0]?.id ?? null });
});
```

**Deploy.** Mantém **"Verify JWT with legacy secret" LIGADO**. Reusa
`WHATSAPP_PERMANENT_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` já existentes, sem
secret nova.

No `crm.html`: campos "Número de teste" + "nome pra usar no {{1}}"
e botão **📨 Enviar teste**, logo depois do checkbox de variável no
formulário de campanha WhatsApp — manda o template já aprovado (nome +
idioma preenchidos no formulário) pro número informado.

## 26. CRM — tempo de resposta no card do lead (Kanban)

**Por quê (17/09/2026):** dá visibilidade de quão rápido a equipe (ou a
Cris) está respondendo cada lead, direto no card, sem precisar abrir a
conversa.

```sql
create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      l.nome, l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em,
      cw.nome as campanha_whatsapp_nome,
      (select max(
         case e.event
           when 'VideoComplete' then 100
           when 'VideoProgress' then (e.props->>'percent')::int
           when 'VideoPlay' then 0
           else null
         end)
       from public.events e
       where e.visitor_id = l.visitor_id
         and lower(coalesce(e.props->>'placement','')) = 'vsl'
         and e.event in ('VideoPlay','VideoProgress','VideoComplete')
      ) as vsl_progress,
      (
        select coalesce(m.wa_timestamp, m.criado_em)
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp) and m.direcao = 'recebida'
        order by coalesce(m.wa_timestamp, m.criado_em) desc
        limit 1
      ) as ultima_recebida_em,
      (
        select min(coalesce(m.wa_timestamp, m.criado_em))
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp)
          and m.direcao = 'enviada'
          and coalesce(m.wa_timestamp, m.criado_em) >= (
            select coalesce(m2.wa_timestamp, m2.criado_em)
            from public.mensagens m2
            where public.wa_norm(m2.lead_whatsapp) = public.wa_norm(s.whatsapp) and m2.direcao = 'recebida'
            order by coalesce(m2.wa_timestamp, m2.criado_em) desc
            limit 1
          )
      ) as respondido_em
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    left join public.campanhas_whatsapp cw on cw.id = s.campanha_whatsapp_id
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';
```

No `crm.html`, o card ganha um selo a mais:

- **Verde** "⏱ respondido em Xmin/h" — quando já tem uma mensagem
  `enviada` depois da última `recebida`. O tempo é a diferença entre as
  duas.
- **Amarelo** "⏱ aguardando há Xmin/h" — quando a última mensagem do
  lead ainda não teve resposta, e faz menos de 1h.
- **Vermelho** "⏱ aguardando há Xh/d" — mesma situação, mas já passou
  de 1h esperando.

Calculado com `fmtDuracao()`/`tempoRespostaBadge()` novos no JS, usando
os campos `ultima_recebida_em`/`respondido_em` que a RPC devolve.

## 27. WhatsApp — variável nomeada (`{{nome}}`, não `{{1}}`)

**Por quê (17/09/2026):** ao testar de verdade, o primeiro template já
aprovado (`meta_convite_com_botao_01`) usa **`{{nome}}`** — variável
**nomeada** da Meta, não a posicional `{{1}}` que o §25 original
assumia. O formato do parâmetro que a Cloud API espera é diferente pra
cada caso:

```json
// posicional ({{1}}) — sem parameter_name, ordem importa
{ "type": "text", "text": "Fernando" }

// nomeada ({{nome}}) — com parameter_name
{ "type": "text", "parameter_name": "nome", "text": "Fernando" }
```

### 27.1. SQL

```sql
alter table public.campanhas_whatsapp
  add column if not exists variavel_token text;
```

### 27.2. `whatsapp-templates-listar` (§25 — Edge Function que lista os
templates aprovados) — detecta o nome da variável via regex em vez de
só checar `{{1}}` literal:

```ts
  const templates = (metaBody.data || []).map((t: any) => {
    const bodyComp = (t.components || []).find((c: any) => c.type === "BODY");
    const bodyText = bodyComp?.text || "";
    const match = bodyText.match(/\{\{([^}]+)\}\}/);
    const token = match ? match[1].trim() : null;
    return {
      nome: t.name,
      status: t.status,
      categoria: String(t.category || "").toLowerCase(),
      idioma: t.language,
      variavel_nome: !!token,
      variavel_token: token,
      preview: bodyText,
    };
  });

  return j({ ok: true, templates });
});
```

### 27.3. `whatsapp-template-teste` (§25.8) — monta o parâmetro certo
conforme o token recebido:

```ts
  const numero = String(body.numero || "").replace(/\D/g, "");
  const templateNome = String(body.template_nome || "").trim();
  const idioma = String(body.idioma || "pt_BR").trim();
  const variavelNome = !!body.variavel_nome;
  const variavelToken = body.variavel_token ? String(body.variavel_token).trim() : null;
  const nomeTeste = String(body.nome_teste || "").trim();
  if (!numero || !templateNome) return j({ erro: "número e nome do template são obrigatórios" }, 400);

  const usaNamed = variavelToken && !/^\d+$/.test(variavelToken);
  const components = variavelNome
    ? [{ type: "body", parameters: [
        usaNamed
          ? { type: "text", parameter_name: variavelToken, text: nomeTeste || "Teste" }
          : { type: "text", text: nomeTeste || "Teste" }
      ] }]
    : [];
```

### 27.4. `campanha-whatsapp-lote` (§25.3) — mesma lógica, por contato:

```ts
  const campResp = await fetch(
    `${URL_}/rest/v1/campanhas_whatsapp?id=eq.${campanhaId}&select=template_nome,idioma,variavel_nome,variavel_token`,
    { headers: svcHeaders },
  );
  const campRows = await campResp.json();
  const camp = campRows && campRows[0];
  if (!camp) return j({ erro: "campanha não encontrada" }, 404);

  const usaNamed = camp.variavel_token && !/^\d+$/.test(camp.variavel_token);

  const pendResp = await fetch(
    `${URL_}/rest/v1/campanha_whatsapp_contatos?campanha_id=eq.${campanhaId}&status=eq.pendente&select=id,numero,nome&order=id.asc&limit=${lote}`,
    { headers: svcHeaders },
  );
  const pendentes = await pendResp.json();

  let enviados = 0, falhas = 0;
  for (const c of pendentes) {
    const components = camp.variavel_nome
      ? [{ type: "body", parameters: [
          usaNamed
            ? { type: "text", parameter_name: camp.variavel_token, text: c.nome || "" }
            : { type: "text", text: c.nome || "" }
        ] }]
      : [];
```

(o resto das duas funções continua igual ao que já estava documentado
em §25.3/§25.8.)

### 27.5. Confirmado funcionando (17/09/2026)

Teste real enviado com o template `meta_convite_com_botao_01`
(`{{nome}}`) → entregue → respondido pelo destinatário → tudo certo de
ponta a ponta na API oficial.

## 28. Disparo automático de campanhas WhatsApp (terça-quinta 13h-14h, lotes de 50, sem repetir número)

**Contexto (17/09/2026):** decisão consciente do gestor de importar a
base geral de leads da Eduzz (~3.000 números, **sem opt-in específico
de WhatsApp**) e disparar `meta_convite_com_botao_01` (Marketing) pra
ela mesmo assim. Isso é fora do que a Meta recomenda (Marketing exige
opt-in por canal) e corre risco real de a nota de qualidade do número
cair ou o número ser restringido/banido — o mesmo número que a Cris usa
pra atender todo mundo, inclusive quem já comprou. Decisão do negócio,
registrada aqui pra contexto futuro, não reversão automática.

Pra reduzir o risco (mesmo sem eliminar), o disparo:
- só roda automaticamente **terça a quinta, das 13h às 14h** (horário
  de Brasília — janela de menor probabilidade de reclamação, fora do
  horário de consulta do público-alvo);
- manda **até 50 mensagens por lote**, em lotes de 15 em 15 minutos
  dentro da janela (4 lotes/dia = até 200/dia, 3x/semana = até 600/semana
  — ritmo conservador; ajustável, ver §28.4);
- **nunca manda pro mesmo número duas vezes** numa campanha Marketing,
  mesmo que o número apareça repetido no CSV ou em campanhas diferentes
  (trigger no banco, não depende do CRM lembrar).

### 28.1. SQL — status "pulado", trigger anti-duplicidade, view atualizada

```sql
-- permite o novo status "pulado" (número já contatado antes)
alter table public.campanha_whatsapp_contatos
  drop constraint if exists campanha_whatsapp_contatos_status_check;
alter table public.campanha_whatsapp_contatos
  add constraint campanha_whatsapp_contatos_status_check
  check (status in ('pendente','enviado','falhou','pulado'));

-- trigger: se o número já está enviado/pendente em QUALQUER campanha
-- de categoria marketing, a nova linha entra direto como "pulado" em
-- vez de "pendente" — funciona pra número repetido dentro do mesmo CSV
-- e pra reimportação em campanhas diferentes.
create or replace function public.bloquear_contato_whatsapp_duplicado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.campanha_whatsapp_contatos k
    join public.campanhas_whatsapp c on c.id = k.campanha_id
    where k.numero = new.numero
      and c.categoria = 'marketing'
      and k.status in ('enviado', 'pendente')
  ) then
    new.status := 'pulado';
    new.erro := 'número já contatado (ou na fila) em outra campanha de marketing — sem repetir envio';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_contato_whatsapp_duplicado on public.campanha_whatsapp_contatos;
create trigger trg_bloquear_contato_whatsapp_duplicado
  before insert on public.campanha_whatsapp_contatos
  for each row execute function public.bloquear_contato_whatsapp_duplicado();

-- view com a contagem de pulados
drop view if exists public.campanhas_whatsapp_resumo;
create view public.campanhas_whatsapp_resumo with (security_invoker = true) as
select
  c.id, c.criado_em, c.nome, c.template_nome, c.idioma, c.categoria,
  count(k.id) as total,
  count(k.id) filter (where k.status = 'pendente') as pendentes,
  count(k.id) filter (where k.status = 'enviado')  as enviados,
  count(k.id) filter (where k.status = 'falhou')   as falhas,
  count(k.id) filter (where k.status = 'pulado')   as pulados
from public.campanhas_whatsapp c
left join public.campanha_whatsapp_contatos k on k.campanha_id = c.id
group by c.id
order by c.criado_em desc;

grant select on public.campanhas_whatsapp_resumo to authenticated;

notify pgrst, 'reload schema';
```

> Roda isso **separado** do bloco abaixo (§28.3, o `cron.schedule`) —
> mesmo motivo de sempre: se colar tudo junto numa transação só e uma
> parte falhar, desfaz o que já tinha funcionado.

### 28.2. Edge Function `campanha-whatsapp-lote` (versão com disparo automático)

Editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_    = Deno.env.get("SUPABASE_URL")!;
const ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN        = Deno.env.get("WHATSAPP_PERMANENT_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const AUTO_TOKEN      = (Deno.env.get("CAMPANHA_AUTO_TOKEN") ?? "").trim();
const LOTE_MAX = 50;

const svcHeaders = { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-automation-token",
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

function horaBrasil(): { dow: number; hora: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour12: false, weekday: "short", hour: "2-digit",
  });
  const partes = fmt.formatToParts(new Date());
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const diaTxt = partes.find((p) => p.type === "weekday")?.value ?? "";
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dias[diaTxt] ?? 0, hora };
}
function dentroJanelaDisparo(): boolean {
  const { dow, hora } = horaBrasil();
  return dow >= 2 && dow <= 4 && hora === 13; // terça(2) a quinta(4), 13h-14h
}

async function campanhaAutoAlvo(): Promise<number | null> {
  const r = await fetch(
    `${URL_}/rest/v1/campanhas_whatsapp_resumo?categoria=eq.marketing&pendentes=gt.0&select=id&order=criado_em.asc&limit=1`,
    { headers: svcHeaders },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return j({ erro: "method" }, 405);

  const autoHeader = req.headers.get("x-automation-token") || "";
  const ehAutomatico = !!AUTO_TOKEN && autoHeader === AUTO_TOKEN;

  let campanhaId: number | null = null;
  let lote = LOTE_MAX;

  if (ehAutomatico) {
    if (!dentroJanelaDisparo()) {
      return j({ ok: true, pulado: "fora da janela de disparo (terça a quinta, 13h-14h)" });
    }
    let body: any = {};
    try { body = await req.json(); } catch { /* cron pode chamar sem corpo */ }
    lote = Math.min(Number(body.lote) || LOTE_MAX, LOTE_MAX);
    campanhaId = await campanhaAutoAlvo();
    if (!campanhaId) return j({ ok: true, pulado: "nenhuma campanha de marketing com pendentes" });
  } else {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const u = await quemChamou(token);
    if (!u) return j({ erro: "não autenticado" }, 401);
    if (!(await ehGestor(u.id))) return j({ erro: "só o gestor pode disparar campanhas" }, 403);

    let body: any;
    try { body = await req.json(); } catch { return j({ erro: "bad body" }, 400); }
    campanhaId = Number(body.campanha_id);
    lote = Math.min(Number(body.lote) || LOTE_MAX, LOTE_MAX);
    if (!campanhaId) return j({ erro: "campanha_id obrigatório" }, 400);
  }

  const campResp = await fetch(
    `${URL_}/rest/v1/campanhas_whatsapp?id=eq.${campanhaId}&select=template_nome,idioma,variavel_nome,variavel_token`,
    { headers: svcHeaders },
  );
  const campRows = await campResp.json();
  const camp = campRows && campRows[0];
  if (!camp) return j({ erro: "campanha não encontrada" }, 404);

  const usaNamed = camp.variavel_token && !/^\d+$/.test(camp.variavel_token);

  const pendResp = await fetch(
    `${URL_}/rest/v1/campanha_whatsapp_contatos?campanha_id=eq.${campanhaId}&status=eq.pendente&select=id,numero,nome&order=id.asc&limit=${lote}`,
    { headers: svcHeaders },
  );
  const pendentes = await pendResp.json();

  let enviados = 0, falhas = 0;
  for (const c of pendentes) {
    const components = camp.variavel_nome
      ? [{ type: "body", parameters: [
          usaNamed
            ? { type: "text", parameter_name: camp.variavel_token, text: c.nome || "" }
            : { type: "text", text: c.nome || "" }
        ] }]
      : [];
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: c.numero,
          type: "template",
          template: { name: camp.template_nome, language: { code: camp.idioma }, components },
        }),
      });
      const rb = await r.json();
      if (!r.ok) throw new Error(rb.error?.message || "falha meta");
      const waId = rb.messages?.[0]?.id ?? null;
      await fetch(`${URL_}/rest/v1/campanha_whatsapp_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "enviado", enviado_em: new Date().toISOString(), wa_message_id: waId }),
      });
      enviados++;
    } catch (e) {
      await fetch(`${URL_}/rest/v1/campanha_whatsapp_contatos?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...svcHeaders, prefer: "return=minimal" },
        body: JSON.stringify({ status: "falhou", erro: String(e) }),
      });
      falhas++;
    }
  }

  return j({ ok: true, campanha_id: campanhaId, automatico: ehAutomatico, enviados, falhas, tentativas: pendentes.length });
});
```

**Deploy — muda de "LIGADO" pra "DESLIGADO":** essa versão passou a
fazer a própria verificação de identidade (gestor por JWT normal, ou
token de automação pro cron) igual o `whatsapp-webhook`. Se deixar
"Verify JWT with legacy secret" ligado, o próprio gateway do Supabase
barra a chamada do cron **antes** dela chegar no código, porque o cron
não manda um JWT de usuário — só o token de automação. Então:
**Edge Functions → campanha-whatsapp-lote → Settings → desliga "Verify
JWT with legacy secret".**

**Secret novo:** Edge Functions → campanha-whatsapp-lote → Secrets →
adiciona `CAMPANHA_AUTO_TOKEN` com um valor aleatório longo (gerado só
pra esse fim — não é a service role key nem nada reutilizado; **não
cole o valor real aqui no arquivo**, ele foi passado direto no chat pra
não ficar salvo em texto puro no Git). Esse mesmo valor vai dentro do
SQL do cron em §28.3, no lugar de `SEU_TOKEN_AQUI`.

### 28.3. SQL — agenda o cron (rodar depois do deploy da função)

```sql
create extension if not exists pg_net with schema extensions;

select cron.unschedule('disparo-whatsapp-marketing')
  where exists (select 1 from cron.job where jobname = 'disparo-whatsapp-marketing');

select cron.schedule(
  'disparo-whatsapp-marketing',
  '*/15 16 * * 2,3,4',
  $$
  select net.http_post(
    url := 'https://nbhekjgbszyuuxrynzfo.supabase.co/functions/v1/campanha-whatsapp-lote',
    headers := '{"Content-Type": "application/json", "x-automation-token": "SEU_TOKEN_AQUI"}'::jsonb,
    body := '{"lote": 50}'::jsonb
  );
  $$
);
```

`'*/15 16 * * 2,3,4'` = a cada 15 minutos, entre 16h e 16h59 **UTC**
(igual 13h-13h59 em Brasília, já que o Brasil não tem mais horário de
verão), nas terças/quartas/quintas (`2,3,4` = dia da semana do cron,
domingo=0). 4 disparos por dia dentro da janela, até 50 cada = até 200
contatos/dia, ~600/semana.

### 28.4. Ajustar o ritmo (opcional)

Pra ir mais rápido nos ~3.000 da Eduzz, dá pra apertar o intervalo —
mas confere antes a **tier de mensagens** do número (business.facebook.com
→ WhatsApp Manager → Configurações da API → limite de mensagens) pra
não estourar o limite diário e virar falha em massa. Pra rodar a cada 5
minutos em vez de 15 (12 lotes/dia = até 600/dia):

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'disparo-whatsapp-marketing'),
  schedule := '*/5 16 * * 2,3,4'
);
```

### 28.5. Conferir

- `select * from cron.job;` mostra o job agendado; `select * from
  cron.job_run_details order by start_time desc limit 20;` mostra o
  histórico de execuções (inclusive fora do horário certo, se algo
  estiver errado).
- Fora da janela ou sem campanha `marketing` com pendentes, a função
  roda e responde `{"ok":true,"pulado":"..."}` sem gastar chamada da
  Meta — não é erro, é o comportamento esperado.
- O botão "Enviar próximo lote" no CRM continua funcionando a qualquer
  hora (path do gestor autenticado, sem o guard de horário) — útil pra
  destravar manualmente ou mandar um lote avulso fora da janela.

**Pegadinha confirmada (17/09/2026):** colar o valor do secret
`CAMPANHA_AUTO_TOKEN` pela caixa "Edit secret" do painel deixou 1
caractere a mais salvo (65 em vez de 64 — provavelmente quebra de linha
do paste), o que fazia o token nunca bater mesmo com os dois lados
"iguais" visualmente. Corrigido lendo o secret com `.trim()` no código
em vez de depender do valor salvo estar exato. Diagnosticado logando só
o **tamanho** das duas strings (nunca o valor) nos Logs da função.

### 28.6. CRM — histórico de envios por campanha (contato a contato)

Botão de relógio (ícone `clock`, reaproveitado do badge de tempo de
resposta) do lado do "Enviar próximo lote", em cada linha da tabela de
campanhas WhatsApp. Abre um painel (`#wa-historico-painel`) com:

- filtro por status (`enviado`/`pendente`/`falhou`/`pulado`);
- tabela número/nome/status/quando, mais recente primeiro
  (`enviado_em.desc.nullslast,id.desc`), 100 por vez com "Carregar
  mais" (mesmo padrão de paginação do Kanban);
- "Exportar CSV" com a lista completa da campanha (sem limite de 100,
  busca tudo de uma vez via `order=id.asc`).

Não precisou de tabela nova nem de RLS nova — só lê
`campanha_whatsapp_contatos` (já com policy de select pro gestor) e usa
o `csvEscape`/padrão de export que já existia pro opt-in. Dá pra deixar
essa tela aberta acompanhando o filtro "Enviados" enquanto o cron
dispara os lotes automáticos de 15 em 15 minutos na janela de
terça-quinta 13h-14h.

## 29. Captura automática do nome via WhatsApp (perfil de contato)

**Contexto (18/09/2026):** hoje `rpc_crm_pipeline()` só mostra o nome de
quem preencheu o quiz (join com `crm_leads.nome`) — quem manda mensagem
direto pro número do congresso sem nunca ter feito o quiz aparece no
Kanban só com o telefone. O payload do WhatsApp Cloud API já manda o
nome de perfil de quem escreveu (`value.contacts[].profile.name`) em
toda mensagem recebida — hoje isso não é lido nem guardado. Esta seção
fecha esse buraco: guarda esse nome numa coluna nova em `lead_status` e
usa como plano B quando não tem `crm_leads.nome`.

### 29.1. SQL (rodar no SQL Editor do Supabase, nessa ordem)

```sql
alter table public.lead_status
  add column if not exists nome_whatsapp text;

create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      coalesce(l.nome, s.nome_whatsapp) as nome,
      l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em,
      cw.nome as campanha_whatsapp_nome,
      (select max(
         case e.event
           when 'VideoComplete' then 100
           when 'VideoProgress' then (e.props->>'percent')::int
           when 'VideoPlay' then 0
           else null
         end)
       from public.events e
       where e.visitor_id = l.visitor_id
         and lower(coalesce(e.props->>'placement','')) = 'vsl'
         and e.event in ('VideoPlay','VideoProgress','VideoComplete')
      ) as vsl_progress,
      (
        select coalesce(m.wa_timestamp, m.criado_em)
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp) and m.direcao = 'recebida'
        order by coalesce(m.wa_timestamp, m.criado_em) desc
        limit 1
      ) as ultima_recebida_em,
      (
        select min(coalesce(m.wa_timestamp, m.criado_em))
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp)
          and m.direcao = 'enviada'
          and coalesce(m.wa_timestamp, m.criado_em) >= (
            select coalesce(m2.wa_timestamp, m2.criado_em)
            from public.mensagens m2
            where public.wa_norm(m2.lead_whatsapp) = public.wa_norm(s.whatsapp) and m2.direcao = 'recebida'
            order by coalesce(m2.wa_timestamp, m2.criado_em) desc
            limit 1
          )
      ) as respondido_em
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    left join public.campanhas_whatsapp cw on cw.id = s.campanha_whatsapp_id
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';
```

A única mudança real em relação à versão anterior (§26) é
`coalesce(l.nome, s.nome_whatsapp) as nome` no lugar de `l.nome` puro —
o resto do RPC é igual, só reafirmando pra poder colar inteiro de uma
vez sem precisar comparar linha a linha com a versão antiga.

### 29.2. Edge Function `whatsapp-webhook` — adicionar a captura do nome

Duas funções novas (cole perto de `marcarOrigemCampanha`, mesmo estilo):

```ts
async function garantirNomeWhatsapp(numero: string, nome: string | null) {
  if (!nome) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_status?on_conflict=whatsapp`, {
      method: "POST",
      headers: { ...svcHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ whatsapp: numero, nome_whatsapp: nome }]),
    });
  } catch (e) { console.error("nome whatsapp:", e); }
}

function mapaContatos(v: any): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const c of v.contacts ?? []) {
    if (c.wa_id && c.profile?.name) mapa[c.wa_id] = c.profile.name;
  }
  return mapa;
}
```

E dentro do `for (const ch of entry.changes ?? [])`, logo depois de
`const v = ch.value ?? {};`, monta o mapa uma vez por bloco:

```ts
const contatos = mapaContatos(v);
```

Dentro do loop `for (const m of v.messages ?? [])`, junto das outras
chamadas (`registrarOptinWhatsapp`, `marcarOrigemCampanha`), adiciona:

```ts
await garantirNomeWhatsapp(m.from, contatos[m.from] ?? null);
```

**Bônus (corrigir enquanto mexe nesse arquivo):** a linha do
`notificarPush` nessa mesma função ainda aponta pra
`.../Ads/crm.html` — a pasta `Ads/` não existe mais desde a
padronização do painel (18/09/2026). Trocar por:

```ts
"https://congressocancer.novvasaudeintegrativa.com.br/crm.html",
```

### 29.3. Depois de colar e salvar

1. Rodar o SQL do §29.1 no SQL Editor (o `alter table` é seguro, não
   apaga nada; rodar de novo não dá erro por causa do `if not exists`).
2. Editar a Edge Function `whatsapp-webhook` no Supabase com as duas
   mudanças do §29.2 e clicar em **Deploy**.
3. Testar mandando uma mensagem de um número que nunca fez o quiz —
   o card dele no Kanban deve aparecer com o nome do WhatsApp em vez
   do telefone puro na próxima vez que a lista recarregar.

## 30. CRM — Fase 3 (Instagram: comentários, unificados no inbox estilo Kommo)

**Estado do lado da Meta (19/09/2026):** produto "Instagram" (API do
Instagram com login do Instagram) adicionado ao App **Novva CRM**
(ID `1081100977750031`), mesmo App do WhatsApp. Conta conectada:
**@novvasaudeintegrativa**, Instagram Business Account ID
`17841450059322732`, vinculada à Página do Facebook **Novva Saúde
Integrativa** (Page ID `105980348524400`). Token de acesso gerado e
salvo no secret `INSTAGRAM_ACCESS_TOKEN`.

> **Atenção — token de 60 dias, não permanente:** diferente do token
> de Usuário do Sistema usado no WhatsApp (que não expira), o token
> gerado pelo fluxo "Instagram Login" dura ~60 dias e precisa ser
> renovado antes de vencer (endpoint `GET /refresh_access_token`).
> Ainda não implementamos a renovação automática — fica registrado
> como pendência (ver §30.5). Enquanto isso, é só gerar um novo token
> manualmente pela mesma tela se ele expirar (o CRM avisa sozinho
> quando uma chamada falhar por token inválido — ver `instagram-webhook`
> e `instagram-responder` abaixo).

Esta fase só recebe comentários (grava em `instagram_comentarios`) e
permite responder pelo CRM. Não mexe em DM nem em publicar conteúdo —
a permissão pedida foi só `instagram_business_manage_comments` (+
`instagram_business_basic`, obrigatória).

### 30.1. SQL — tabela `instagram_comentarios`

```sql
create table if not exists public.instagram_comentarios (
  id              bigint generated always as identity primary key,
  criado_em       timestamptz not null default now(),
  comment_id      text unique not null,      -- id do comentário no Instagram, usado pra dedupe
  media_id        text,                      -- id do post onde o comentário foi feito
  autor_ig_id     text,                      -- id (IGSID) de quem comentou
  autor_username  text,                      -- @usuário, quando disponível
  texto           text,
  respondido      boolean not null default false,
  resposta_texto  text,
  respondido_em   timestamptz,
  respondido_por  uuid references auth.users(id),
  raw             jsonb not null default '{}'::jsonb
);
create index if not exists instagram_comentarios_media_idx
  on public.instagram_comentarios (media_id, criado_em);
alter table public.instagram_comentarios enable row level security;

-- só quem loga e está ativo vê os comentários
drop policy if exists "equipe vê comentários instagram" on public.instagram_comentarios;
create policy "equipe vê comentários instagram" on public.instagram_comentarios
  for select to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

-- marcar como respondido é a única escrita que a equipe faz direto
-- (a inserção do comentário em si só a Edge Function faz, com service role)
drop policy if exists "equipe marca resposta instagram" on public.instagram_comentarios;
create policy "equipe marca resposta instagram" on public.instagram_comentarios
  for update to authenticated
  using (exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo));

revoke insert, delete on public.instagram_comentarios from anon, authenticated;

notify pgrst, 'reload schema';
```

### 30.2. Edge Function `instagram-webhook` (recebe os comentários)

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`instagram-webhook`** → editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERIFY_TOKEN  = Deno.env.get("INSTAGRAM_VERIFY_TOKEN")?.trim();
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // verificação do webhook (a Meta faz um GET quando você salva a URL)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const body = await req.json().catch(() => null);
  const entradas = body?.entry || [];

  for (const entrada of entradas) {
    const changes = entrada.changes || [];
    for (const change of changes) {
      if (change.field !== "comments") continue;
      const v = change.value || {};
      const row = {
        comment_id: v.id,
        media_id: v.media?.id || null,
        autor_ig_id: v.from?.id || null,
        autor_username: v.from?.username || null,
        texto: v.text || null,
        raw: v,
      };
      if (!row.comment_id) continue;
      await fetch(`${SUPABASE_URL}/rest/v1/instagram_comentarios?on_conflict=comment_id`, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE,
          authorization: `Bearer ${SERVICE_ROLE}`,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([row]),
      });
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});
```

**Secrets dessa function** (Edge Functions → `instagram-webhook` → Secrets):
- `INSTAGRAM_VERIFY_TOKEN` — invente uma string qualquer (ex: um UUID),
  só precisa bater com o que você vai colar no painel da Meta no §30.4.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem por padrão em
  toda Edge Function do projeto (não precisa criar).

### 30.3. Edge Function `instagram-responder` (responde comentário pelo CRM)

Supabase → **Edge Functions** → **Deploy a new function** → nome
**`instagram-responder`** → editor → apaga tudo e cola:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const IG_TOKEN      = Deno.env.get("INSTAGRAM_ACCESS_TOKEN")?.trim();
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // exige login (mesmo padrão dos outros *-admin: token do usuário no header)
  const auth = req.headers.get("authorization") || "";
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response(JSON.stringify({ erro: "não autenticado" }), { status: 401 });

  const { comment_id, texto } = await req.json().catch(() => ({}));
  if (!comment_id || !texto) {
    return new Response(JSON.stringify({ erro: "comment_id e texto obrigatórios" }), { status: 400 });
  }

  const r = await fetch(`https://graph.instagram.com/v23.0/${comment_id}/replies`, {
    method: "POST",
    headers: { authorization: `Bearer ${IG_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ message: texto }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return new Response(JSON.stringify({ erro: j }), { status: 500 });

  const svcHeaders = {
    apikey: SERVICE_ROLE, authorization: `Bearer ${SERVICE_ROLE}`,
    "content-type": "application/json", prefer: "return=minimal",
  };
  await fetch(`${SUPABASE_URL}/rest/v1/instagram_comentarios?comment_id=eq.${comment_id}`, {
    method: "PATCH",
    headers: svcHeaders,
    body: JSON.stringify({
      respondido: true, resposta_texto: texto,
      respondido_em: new Date().toISOString(), respondido_por: user.id,
    }),
  });

  return new Response(JSON.stringify({ ok: true, id: j.id }), { status: 200 });
});
```

**Secret dessa function**: `INSTAGRAM_ACCESS_TOKEN` (o mesmo token já
salvo no §anterior — copia o valor pra cá também, cada Edge Function
tem seus próprios secrets).

### 30.4. Configurar o webhook no painel da Meta

Depois de fazer o **Deploy** do `instagram-webhook` (§30.2), o Supabase
te dá uma URL pública do tipo:
```
https://nbhekjgbszyuuxrynzfo.supabase.co/functions/v1/instagram-webhook
```

1. Volta em **developers.facebook.com/apps/1081100977750031** → Casos
   de uso → Instagram → Personalizar → seção **"3. Configurar webhooks"**.
2. **URL de callback**: cola a URL acima.
3. **Verificar token**: cola o mesmo valor que você colocou no secret
   `INSTAGRAM_VERIFY_TOKEN` (§30.2).
4. Clica em **"Verificar e salvar"** — se dar erro, confere se o Deploy
   da function terminou e se o `INSTAGRAM_VERIFY_TOKEN` bate certinho
   dos dois lados.
5. Depois de verificado, tem que **assinar o campo `comments`** — deve
   aparecer uma lista de campos pra marcar (webhook fields), marca
   **`comments`** (não precisa `messages` nem os outros, só usamos
   esse).

### 30.5. Feito (19/09/2026)

- Webhook verificado e assinatura do campo `comments` ativada — testado
  de ponta a ponta (comentário real caiu na tabela `instagram_comentarios`).
- Tela **"Comentários do Instagram"** no `crm.html` (`view-instagram`,
  sempre visível, igual Pipeline/Conversas) — lista os comentários com
  o selinho de canal do Instagram no avatar, e responde direto pela
  Edge Function `instagram-responder`.

### 30.6. Pendências (registradas, não fazem parte desta fase)

- **Renovar o token automaticamente** antes dos 60 dias vencerem (uma
  Edge Function agendada, tipo o `pg_cron`, chamando
  `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`
  e atualizando o secret) — por enquanto é manual.
- ~~Unificar com o inbox do WhatsApp~~ — resolvido de outro jeito, ver §31.

## 31. CRM — Instagram: botão "Virar lead" (comentário entra no Pipeline)

**Contexto (19/09/2026):** a seção "Comentários do Instagram" (§30)
ficou meio solta, sem relação com o resto do fluxo de vendas. Em vez de
unificar de verdade os dois inboxes (mexeria na estrutura toda do
Pipeline, que é organizada por número de WhatsApp), a solução foi um
botão **"Virar lead"** em cada comentário: um clique cria uma linha
normal em `lead_status`, usando uma chave sintética (`ig:<id do
autor>`) no lugar do telefone, com `canal='instagram'`. Esse lead
passa a aparecer no Kanban normalmente, misturado com os de WhatsApp,
com o selinho do Instagram no avatar — sem precisar mexer em nenhuma
política de RLS nem no RPC existente além de expor o campo `canal`.

### 31.1. SQL

```sql
alter table public.lead_status
  add column if not exists canal text not null default 'whatsapp';

alter table public.instagram_comentarios
  add column if not exists virou_lead boolean not null default false;

create or replace function public.rpc_crm_pipeline()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.captado_em desc nulls last), '[]'::json)
  from (
    select
      s.whatsapp,
      coalesce(l.nome, s.nome_whatsapp) as nome,
      coalesce(s.canal, 'whatsapp') as canal,
      l.email, l.profissao, l.nivel, l.pontuacao,
      l.utm_source, l.utm_campaign,
      coalesce(s.criado_em, l.captado_em) as captado_em,
      coalesce(s.etapa, 'novo') as etapa,
      s.nota, coalesce(s.urgente, false) as urgente, s.atribuido_a,
      pa.nome as atribuido_nome,
      s.atualizado_em,
      cw.nome as campanha_whatsapp_nome,
      (select max(
         case e.event
           when 'VideoComplete' then 100
           when 'VideoProgress' then (e.props->>'percent')::int
           when 'VideoPlay' then 0
           else null
         end)
       from public.events e
       where e.visitor_id = l.visitor_id
         and lower(coalesce(e.props->>'placement','')) = 'vsl'
         and e.event in ('VideoPlay','VideoProgress','VideoComplete')
      ) as vsl_progress,
      (
        select coalesce(m.wa_timestamp, m.criado_em)
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp) and m.direcao = 'recebida'
        order by coalesce(m.wa_timestamp, m.criado_em) desc
        limit 1
      ) as ultima_recebida_em,
      (
        select min(coalesce(m.wa_timestamp, m.criado_em))
        from public.mensagens m
        where public.wa_norm(m.lead_whatsapp) = public.wa_norm(s.whatsapp)
          and m.direcao = 'enviada'
          and coalesce(m.wa_timestamp, m.criado_em) >= (
            select coalesce(m2.wa_timestamp, m2.criado_em)
            from public.mensagens m2
            where public.wa_norm(m2.lead_whatsapp) = public.wa_norm(s.whatsapp) and m2.direcao = 'recebida'
            order by coalesce(m2.wa_timestamp, m2.criado_em) desc
            limit 1
          )
      ) as respondido_em
    from public.lead_status s
    left join public.crm_leads l on public.wa_norm(l.whatsapp) = public.wa_norm(s.whatsapp)
    left join public.perfis pa on pa.id = s.atribuido_a
    left join public.campanhas_whatsapp cw on cw.id = s.campanha_whatsapp_id
    where exists (select 1 from public.perfis me where me.id = auth.uid() and me.ativo)
  ) t;
$$;

notify pgrst, 'reload schema';
```

A única mudança real em relação à versão do §29 é a linha
`coalesce(s.canal, 'whatsapp') as canal` — resto idêntico, colado
inteiro só pra não precisar comparar linha a linha.

### 31.2. Front (`crm.html`) — já feito

- `avatarHtml(l.nome, wpp, l.canal)` no card do Kanban — mostra o
  selinho certo (WhatsApp ou Instagram) conforme a origem do lead.
- Botão "Ver conversa" do card, quando `canal === 'instagram'`, rola
  pra seção de Comentários em vez de tentar abrir uma thread de
  WhatsApp que não existe.
- Botão **"Virar lead"** em cada comentário (§30) — cria a linha em
  `lead_status` com `whatsapp = 'ig:' + autor_ig_id`, `canal =
  'instagram'`, `nome_whatsapp = '@usuário'`, e marca
  `instagram_comentarios.virou_lead = true` (o botão vira um selo
  "No Pipeline" depois de clicado, pra não duplicar).

### 31.3. Rodar

1. SQL do §31.1 no SQL Editor.
2. Testar: na seção "Comentários do Instagram", clica em "Virar lead"
   num comentário → o card deve sumir da lista de "pendente" (vira
   selo) → rola até o Pipeline → o card novo deve aparecer em
   "Novos", com `@usuário` como nome e o selinho do Instagram.
