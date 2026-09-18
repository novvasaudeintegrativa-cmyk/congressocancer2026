# Site — Congresso de Prevenção e Tratamento de Câncer 2026

Repositório privado do site e das ferramentas internas do congresso (20-21/nov, São José dos Campos). Sem build — é HTML/CSS/JS puro, publicado por FTP a cada push na `main`.

## Páginas públicas

| Arquivo | O que é |
|---|---|
| `index.html` | Site principal do congresso (programação, palestrantes, lotes, checkout Eduzz). |
| `quiz.html` | **Raio-X Profissional** — quiz de captação de leads, grava em `quiz_leads` no Supabase. |

## Ferramentas internas

Sem link na navegação pública — acesso só por quem tem a URL. Antes viviam numa pasta `Ads/`
separada; hoje ficam soltas na raiz do site, cada uma como uma página independente (seu próprio
HTML/CSS/JS), amarradas só pelo `novva-ads.html`, que funciona como "página mãe" e carrega as
outras três dentro de si via `<iframe>`.

| Arquivo | O que é |
|---|---|
| `novva-ads.html` | Painel principal: menu lateral com 4 abas (CRM, Tráfego, Financeiro, Quiz), cada uma carregando a página correspondente num iframe. |
| `crm.html` | Pipeline de vendas de verdade — login próprio (Supabase Auth), conversas, fila de atendimento. |
| `financeiro.html` | Controle de receitas e despesas — mesmo login da equipe, só gestor. |
| `trafego.html` | Analytics do site (visitantes, funil, VSL, mapa, campanhas) + card de ROI. |
| `quiz-raiox.html` | Dashboard dos leads do quiz (temperatura, nível, qualitativo por pergunta) — não confundir com o `quiz.html` da raiz, que é o quiz público de captação. |
| `novva-ads-tracking.html` | Dashboard antigo (tema escuro), mantido só como referência — foi substituído pelo `novva-ads.html`. |
| `adscompass-mobile-mockup.html` | Mockup antigo, sem uso atual. |

## Outros arquivos

- `estrategia-marketing-dashboard.html` — visualização da estratégia de marketing (cronograma, checklist, banco de criativos, scripts prontos). Baseado em `docs/estrategia-marketing-congresso-cancer-2026.md`.
- `SUPABASE.md` — **documentação completa do backend**: schema das tabelas, RLS, Edge Functions (`collect`, `eduzz-webhook`), e o SQL de cada uma. Comece por aqui pra entender qualquer coisa ligada a dado/Supabase.
- `Imgs/`, `Fonts/` — assets do site (fotos, logos, tipografia).

## Deploy

`.github/workflows/deploy.yml` publica por FTP na TurboCloud a cada push na `main`. Arquivos `.md` (como este) não vão pro deploy — ficam só no repositório.

## Backend

Projeto Supabase `nbhekjgbszyuuxrynzfo`. Ver `SUPABASE.md` para schema, RLS e Edge Functions.
