# Coletor de eventos — Supabase + novva-ads-tracking.html

O site manda cada evento para **dois lugares**: o Meta Pixel e um banco próprio
(Supabase). O `novva-ads-tracking.html` lê esse banco e mostra os números.

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
  add column if not exists city         text;

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

-- ========== RPC do painel (novva-ads-tracking-mvp.html) ==========
-- Um unico endpoint que devolve TODOS os blocos do painel para um
-- intervalo de datas. O painel chama POST /rest/v1/rpc/rpc_dashboard
-- com { "d_from": "YYYY-MM-DD", "d_to": "YYYY-MM-DD" } e os botoes de
-- periodo (Hoje / 7 / 14 / 30 / 45 / 60 / 90) so mudam essas datas.
create or replace function public.rpc_dashboard(d_from date, d_to date)
returns json language sql stable as $$
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
        select coalesce(nullif(trim(coalesce(region,'') || case when city is not null then ' · ' || city else '' end), ''), '(sem local)') as local,
               count(distinct session_id) as sessoes
        from base group by 1 limit 10) t)
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
- `novva-ads-tracking.html` → `var SUPABASE_URL = 'https://xxxx.supabase.co'` e `var SUPABASE_KEY = 'eyJ...'`

Commit + push → o deploy FTP publica os dois.

## 5. Conferir

- Abrir o site, aba **Network** → deve haver `POST .../rest/v1/events` com status **201**.
- Supabase → **Table Editor → events** → linhas aparecendo.
- Abrir `https://SEU-DOMINIO/novva-ads-tracking.html` → números carregando.

## 6. Pendências / cuidados

- **LGPD**: citar o coletor próprio na política de privacidade; definir retenção
  (ex.: apagar linhas com mais de 12–18 meses via job agendado); não guardamos IP.
- **Bots**: o endpoint aceita INSERT anônimo — se aparecer spam, criar uma Edge
  Function com segredo + rate limit, ou filtrar por `ua` nas queries.
- **`novva-ads-tracking.html` é público** no domínio. Só mostra agregados (sem PII), mas
  convém renomear para algo não óbvio (ex.: `painel-7k2x.html`) e/ou proteger
  por `.htaccess` na TurboCloud.
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
3. Apague o exemplo e cole:

```ts
// Edge Function: collect — recebe evento do site, resolve geo por IP, grava em public.events
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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
  let country: string | null = null, region: string | null = null, city: string | null = null;
  const privado = !ip || ip === "127.0.0.1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.");
  if (!privado) {
    try {
      const r = await fetch(`https://ipwho.is/${ip}?fields=success,country,region,city`, { signal: AbortSignal.timeout(1200) });
      const g = await r.json();
      if (g?.success) { country = g.country ?? null; region = g.region ?? null; city = g.city ?? null; }
    } catch { /* geo é best-effort */ }
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
    country, region, city,
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
