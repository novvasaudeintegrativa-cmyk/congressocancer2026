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
  ua           text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  fbclid       text
);

-- ---------- UTM / campanhas (rodar sozinho se a tabela ja existia) ----------
alter table public.events
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term     text,
  add column if not exists utm_content  text,
  add column if not exists gclid        text,
  add column if not exists fbclid       text;

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
select created_at, event, props, path,
  coalesce(nullif(split_part(split_part(referrer, '//', 2), '/', 1), ''), '(direto)') as origem,
  utm_source, utm_campaign,
  session_id
from public.events
order by created_at desc limit 200;

grant select on public.v_kpis_30d, public.v_eventos_por_dia, public.v_rolagem,
                public.v_tempo_pagina, public.v_videos, public.v_referrers,
                public.v_campanhas, public.v_recentes
  to anon;

notify pgrst, 'reload schema';
```

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
