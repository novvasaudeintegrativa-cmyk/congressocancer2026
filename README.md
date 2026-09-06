# Site — Congresso de Prevenção e Tratamento de Câncer 2026

Repositório privado do site e das ferramentas internas do congresso (20-21/nov, São José dos Campos). Sem build — é HTML/CSS/JS puro, publicado por FTP a cada push na `main`.

## Páginas públicas

| Arquivo | O que é |
|---|---|
| `index.html` | Site principal do congresso (programação, palestrantes, lotes, checkout Eduzz). |
| `quiz.html` | **Raio-X Profissional** — quiz de captação de leads, grava em `quiz_leads` no Supabase. |

## Ferramentas internas (pasta `Ads/`)

Sem link na navegação pública — acesso só por quem tem a URL.

| Arquivo | O que é |
|---|---|
| `Ads/novva-ads.html` | Painel principal: aba **Tráfego & Conversão** (analytics + ROI), aba **Quiz** (leads/temperatura/qualitativo) e aba **CRM** (preview do pipeline de vendas — ainda sem login/backend real). |
| `Ads/novva-ads-tracking.html` | Dashboard antigo (tema escuro), mantido só como referência — foi substituído pelo `novva-ads.html`. |
| `Ads/adscompass-mobile-mockup.html` | Mockup antigo, sem uso atual. |

## Outros arquivos

- `plano-divulgacao-dashboard.html` — visualização do plano de divulgação (calendário, checklist, scripts prontos).
- `SUPABASE.md` — **documentação completa do backend**: schema das tabelas, RLS, Edge Functions (`collect`, `eduzz-webhook`), e o SQL de cada uma. Comece por aqui pra entender qualquer coisa ligada a dado/Supabase.
- `Imgs/`, `Fonts/` — assets do site (fotos, logos, tipografia).

## Deploy

`.github/workflows/deploy.yml` publica por FTP na TurboCloud a cada push na `main`. Arquivos `.md` (como este) não vão pro deploy — ficam só no repositório.

## Backend

Projeto Supabase `nbhekjgbszyuuxrynzfo`. Ver `SUPABASE.md` para schema, RLS e Edge Functions.
