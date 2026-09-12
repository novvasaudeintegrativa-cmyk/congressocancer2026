# Coletor de eventos — Supabase + Ads/novva-ads.html

O site manda cada evento para **dois lugares**: o Meta Pixel e um banco próprio
(Supabase). O `Ads/novva-ads.html` lê esse banco e mostra os
números — é um painel único com duas abas: **Tráfego & Conversão** (site) e
**Quiz · Raio-X Profissional** (leads do `quiz.html`). Ferramentas internas
(`.md`, dashboards, mockups) ficam todas na pasta `Ads/`; `index.html` e
`quiz.html` continuam na raiz porque têm URL pública já divulgada.

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

-- ========== RPC do painel (novva-ads.html) ==========
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
- `Ads/novva-ads.html` → `var SUPABASE_URL = 'https://xxxx.supabase.co'` e `var SUPABASE_KEY = 'eyJ...'`

Commit + push → o deploy FTP publica os dois.

## 5. Conferir

- Abrir o site, aba **Network** → deve haver `POST .../rest/v1/events` com status **201**.
- Supabase → **Table Editor → events** → linhas aparecendo.
- Abrir `https://SEU-DOMINIO/Ads/novva-ads.html` → números carregando.

## 6. Pendências / cuidados

- **LGPD**: citar o coletor próprio na política de privacidade; definir retenção
  (ex.: apagar linhas com mais de 12–18 meses via job agendado); não guardamos IP.
- **Bots**: o endpoint aceita INSERT anônimo — se aparecer spam, criar uma Edge
  Function com segredo + rate limit, ou filtrar por `ua` nas queries.
- **`Ads/novva-ads.html` é público** no domínio (a pasta `Ads/` não
  bloqueia acesso por si só). Só mostra agregados (sem PII), mas convém
  renomear pra algo não óbvio (ex.: `Ads/painel-7k2x.html`) e/ou proteger por
  `.htaccess` na TurboCloud.
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

## 9. Painel do quiz (aba "Quiz · Raio-X Profissional" do `Ads/novva-ads.html`)

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
        group by 1) t)
  );
$$;

grant execute on function public.rpc_roi() to anon;
notify pgrst, 'reload schema';
```

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

O painel (`Ads/novva-ads.html`, seção ROI) tem um link "Gerenciar
lançamentos" que pede esse token uma vez (fica salvo só nesse
navegador) e mostra a lista com editar/apagar inline.

## 13. CRM — Fase 1 (login de equipe + pipeline de leads reais)

Substitui a Kommo pra **gestão de leads** (não pra conversa de WhatsApp —
isso é Fase 2, depende da API do Meta). Tela nova `Ads/crm.html` atrás de
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

-- ---------- RPC: pipeline pronto pro Ads/crm.html ----------
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

### 13.4. O que o `Ads/crm.html` faz

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
4. **View de conversa no `Ads/crm.html`** — thread por lead + campo de
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

## 16. CRM — Cris (IA de primeiro contato)

Implementa o que já estava desenhado como simulação no `ads/novva-ads.html`
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

### 16.3. `Ads/crm.html` — o que mudou

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
desenhado como simulação no `novva-ads.html` — venda conjunta, quem
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

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Sua função é criar uma conexão inicial calorosa com o lead e levar ele pra nossa página oficial — é lá que tem a apresentação completa (inclusive vídeo), que já responde as dúvidas mais comuns e foi feita pra converter. O site é: https://congressocancer.novvasaudeintegrativa.com.br

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes (decisão da empresa, 11/09/2026):
- NÃO informe valores, preço de lote, datas, programação, nomes de palestrantes, certificado ou qualquer detalhe aprofundado do congresso diretamente na conversa — pra qualquer pergunta desse tipo, responda breve e sempre mande pra página: "Isso está bem explicadinho na nossa página, com todos os detalhes — dá uma olhada: https://congressocancer.novvasaudeintegrativa.com.br". Nunca cite valor em R$ na conversa, nem repita o que está no "CONTEÚDO ATUAL DO SITE" abaixo — esse conteúdo é só pra você mesma saber do que se trata o congresso, não pra repassar em detalhe.
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

### 17.6. `Ads/crm.html` — botão "Assumir conversa" agora reivindica o lead

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
`Ads/crm.html` num **PWA** (instalável na tela inicial, Android e
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

### 18.4. Edge Function `whatsapp-webhook` (versão completa, com push)

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
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:novvasaudeintegrativa@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const svcHeaders = { apikey: SVC_KEY, authorization: `Bearer ${SVC_KEY}`, "content-type": "application/json" };

const CRIS_INSTRUCOES = `Você é a Cris, da equipe do Congresso Câncer 2026 (congresso de práticas integrativas oncológicas, 2 dias em São Paulo). Sua função é criar uma conexão inicial calorosa com o lead e levar ele pra nossa página oficial — é lá que tem a apresentação completa (inclusive vídeo), que já responde as dúvidas mais comuns e foi feita pra converter. O site é: https://congressocancer.novvasaudeintegrativa.com.br

Perfil de quem mais aproveita o congresso: médico(a)/dentista/farmacêutico(a)/enfermeiro(a)/fisioterapeuta/terapeuta que atende ou quer atender pacientes oncológicos e quer ampliar repertório em práticas integrativas.

Regras importantes (decisão da empresa, 11/09/2026):
- NÃO informe valores, preço de lote, datas, programação, nomes de palestrantes, certificado ou qualquer detalhe aprofundado do congresso diretamente na conversa — pra qualquer pergunta desse tipo, responda breve e sempre mande pra página: "Isso está bem explicadinho na nossa página, com todos os detalhes — dá uma olhada: https://congressocancer.novvasaudeintegrativa.com.br". Nunca cite valor em R$ na conversa, nem repita o que está no "CONTEÚDO ATUAL DO SITE" abaixo — esse conteúdo é só pra você mesma saber do que se trata o congresso, não pra repassar em detalhe.
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
        numerosRecebidos.add(m.from);
        await notificarPush(
          "Nova mensagem no WhatsApp",
          `+${m.from}: ${texto || (m.type ? "(" + m.type + ")" : "mensagem")}`,
          "https://congressocancer.novvasaudeintegrativa.com.br/Ads/crm.html",
        );
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
```

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
