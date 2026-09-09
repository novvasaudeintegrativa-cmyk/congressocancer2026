# Estratégia de Marketing — Congresso Câncer 2026

**Evento:** 4ª edição do Congresso de Práticas Integrativas para Prevenção e Tratamento do Câncer
**Data:** 20 e 21 de novembro de 2026
**Local:** Hotel Nacional Inn São José dos Campos (SP)
**Realização:** Novva Saúde Integrativa & NutriGenes

Gerado em: 2026-09-05 · Revisado em: 2026-09-09 com cronograma, criativos e escala real de reativação de base

Continua com duas frentes:
- **Frente A — Orgânico/manual**: não depende de ferramenta paga nem de autorização de conta. Roda desde já.
- **Frente B — Tráfego pago e captação avançada**: Meta Ads, Google Ads, retargeting, SEO, chatbot. **Some-se** à Frente A, não a substitui. Meta Ads/Google Ads dependem de autorizar a conta (pendente hoje).

Base comum: `docs/persona.md` (persona, dores, desejos, objeções — toda mensagem calibrada nele) e o rastreamento de UTM já existente no site.

---

## 1. Funil de marketing

- **Topo (atrair):** conteúdo educativo sobre práticas integrativas em oncologia, **sem prometer cura**, focado na persona "Dr. Fernando Azevedo". Orgânico + (quando autorizado) Meta Ads de alcance/engajamento.
- **Meio (aquecer):** apresentação dos palestrantes, bastidores, prévia de temas, entrevistas do Fernando Beteti. Objetivo: reconhecimento de marca + captura de leads (WhatsApp/e-mail/quiz).
- **Fundo (converter):** comunicação direta de conversão — preço, parcelamento, urgência de virada de lote. Retargeting em quem engajou no topo/meio (Frente B, quando ativa).
- **Pós-venda:** grupo de WhatsApp para compradores, lembretes conforme a data se aproxima, depoimentos para a próxima edição.

---

## 2. Cronograma consolidado (datas reais)

| Fase | Período | Foco |
|---|---|---|
| **Aquecimento** | 9–30/set | Conteúdo educativo, apresentação de palestrantes, captura de lista/quiz |
| **Lançamento Lote 1** | 1–15/out | Push de conversão, ativação de palestrantes |
| **Meio de funil** | 16/out–5/nov | Ciência/limites éticos, reforço de dor/urgência, retargeting |
| **Lote 3 + reta final** | 6–18/nov | Urgência máxima, contagem regressiva, prova social |
| **Evento ao vivo** | 20–21/nov | Cobertura em stories/Reels, bastidores |
| **Pós-evento** | a partir de 22/nov | Depoimentos, nutrição da lista para 2027 |

> Isso substitui a antiga divisão por "semana 1-11" (relativa) — agora é por data de calendário. Ajuste as datas de virada de lote (hoje "vagas limitadas", sem data pública) conforme decidido internamente.

**Mídia deste plano:** vive em `Midia/Organica/` e `Midia/Paga/` (pasta na raiz do projeto), peça por peça em arquivo próprio — ver `Midia/README.md`. Roda **em paralelo** ao cronograma orgânico de 12 posts já produzido (`Instagram/Feed/F01..F12`), que continua ativo e não pertence a este plano — ver banco de criativos (seção 6).

---

## 3. Canais priorizados

1. **Meta Ads** (Instagram/Facebook) — carro-chefe de mídia paga **quando a conta for autorizada**; até lá, é aspiracional.
2. **Orgânico Instagram** — bastidores, teasers, conteúdo educativo. Alimenta o topo de funil sem custo de mídia — é a base que já roda hoje.
3. **WhatsApp/E-mail** — nutrição da lista e comunicação de urgência dos lotes. 100% manual, sem disparo em massa (ver Princípios, seção 4).
4. **Cross-promotion dos palestrantes** — cada um divulgando pra própria audiência (12 confirmados).
5. **Google Ads** — prioridade menor; captura de busca ativa ("congresso oncologia integrativa 2026").

---

## 4. Princípios do modo manual (o que continua de fora)

**Fica de fora, sempre:** disparo em massa por WhatsApp Business API, ferramentas de agendamento/automação de posts, bots de resposta automática sem supervisão.

**Continua valendo (e é de graça):**
- Links com UTM — o site já lê e propaga `utm_source/medium/campaign/term/content`.
- O botão `wa.me/5511934873737` — conversa manual, uma a uma (ou, quando a Fase 2 do CRM estiver pronta, via `Ads/crm.html` com Cristina/IA + equipe).
- Posts orgânicos, stories, comentários e DMs respondidos manualmente.

### Convenção de UTM (usar sempre)

| Canal | utm_source | utm_medium | utm_campaign |
|---|---|---|---|
| Instagram (feed/stories) | `instagram` | `organico` | `lote1` (trocar pro lote vigente) |
| Post específico F01, F02... | `instagram` | `organico` | `f01`, `f02`... |
| Compartilhamento de palestrante | `palestrante-nomeSobrenome` | `social` | `lote1` |
| Grupo/associação de classe | `grupo-nomeDoGrupo` | `whatsapp` | `lote1` |
| Lista própria de WhatsApp | `whatsapp_lista` | `whatsapp` | `lote1` |
| Quiz de captação (bio/posts) | `quiz` | `organico` | `lote1` |
| Meta Ads (quando ativo) | `meta` ou `facebook`/`instagram` | `cpc` | nome da campanha real |

---

## 5. Plano de conteúdo — Fase de Aquecimento (9–30/set)

**Pilares:**
1. Apresentação dos palestrantes (carrosséis/Reels, credenciais como CRM/especialidade).
2. Conteúdo educativo (práticas integrativas em oncologia — **sempre sem promessa de cura, sem "combate ao câncer"**, ver Termos de Uso do site).
3. Bastidores e antecipação (teasers, contagem regressiva sutil).
4. Autoridade institucional (Novva + NutriGenes, feira com 30+ stands, certificado de 16h).

**Cadência:**
- Orgânico: 3-4 posts/semana (Reels + carrossel + stories diários).
- Meta Ads (topo de funil, quando ativo): 2-3 criativos em paralelo, objetivo alcance/engajamento.
- Fernando Beteti: 1 entrevista/semana com palestrante.

**Sequência semanal:**
- Semana 1 (9-15/set): realizadores + primeiros 3-4 palestrantes.
- Semana 2 (16-22/set): conteúdo educativo + mais palestrantes.
- Semana 3 (23-30/set): fechamento da apresentação de palestrantes + teaser "inscrições abertas".

---

## 6. Banco de criativos prontos

As 3 peças abaixo também vivem como arquivo próprio em `Midia/Paga/` (as 2 de Meta Ads) e `Midia/Organica/` (a legenda de palestrantes) — use os arquivos pra copiar/editar, este texto é a referência.

Além delas, o cronograma orgânico anterior — 12 posts já com legenda e slide prontos — continua rodando em paralelo, em `Instagram/Feed/F01` a `F12` (fora do escopo deste documento).

### Meta Ads — Criativo 1 (Institucional/Awareness)
**Título:** 🩺 O maior congresso de práticas integrativas em oncologia da América Latina chega à 4ª edição
**Descrição:** 📅 20 e 21 de novembro, em São José dos Campos (SP)
**Texto:**
> 🩺 Profissional de saúde que atende (ou cruza com) pacientes oncológicos? Este congresso foi pensado pra você.
>
> Nos dias 20 e 21 de novembro, São José dos Campos recebe a 4ª edição do Congresso de Práticas Integrativas para Prevenção e Tratamento do Câncer — uma realização conjunta da Novva Saúde Integrativa e da NutriGenes.
>
> São dois dias de imersão com médicos, nutricionistas, terapeutas e pesquisadores discutindo como ampliar o repertório clínico em práticas integrativas sem abrir mão do rigor científico.
>
> 🎓 O que te espera:
> ✅ Palestras exclusivas com especialistas de diversas áreas
> ✅ Feira com mais de 30 stands
> ✅ Networking direto com quem já aplica essas práticas na rotina clínica
> ✅ Certificado digital de 16h
>
> 📍 Hotel Nacional Inn São José dos Campos — perto do Shopping Vale, aeroporto e Rodovia Dutra.
>
> As inscrições do 1º lote já estão abertas, com valores facilitados em até 12x.
>
> 👉 Garanta sua vaga na descrição.

### Meta Ads — Criativo 2 (Educativo, topo de funil)
**Título:** 📊 O que a ciência já mostra sobre terapias complementares em oncologia
**Descrição:** 🔍 Evidência, não promessa — assim se constrói prática clínica séria
**Texto:**
> 📊 Terapias complementares não substituem o tratamento oncológico convencional — mas a literatura vem mostrando ganhos relevantes quando são usadas como suporte.
>
> Um estudo da Escola de Enfermagem de Ribeirão Preto (USP), conduzido na unidade de quimioterapia do Hospital Beneficência Portuguesa, mostrou que técnicas como relaxamento com imagem guiada e acupuntura reduziram sintomas e melhoraram a qualidade de vida de pacientes em tratamento (Nicolussi et al.).
>
> Revisões sistemáticas mais recentes, cruzando bases como PubMed, Cochrane e The Lancet, reforçam esse padrão: práticas integrativas e complementares (PICs) têm papel consistente no manejo de efeitos adversos da quimio e radioterapia, quando bem indicadas.
>
> 🎯 É exatamente esse tipo de discussão — com base em evidência, não em promessa — que vai pautar o Congresso, dias 20 e 21 de novembro em São José dos Campos.
>
> Se você é médico, nutricionista, fisioterapeuta, farmacêutico ou terapeuta e quer entender onde a ciência realmente sustenta essas práticas, esse é o seu congresso.
>
> 👉 Inscrições do 1º lote abertas, com parcelamento em até 12x.

> ⚠️ **Antes de publicar o Criativo 2:** confirmar a citação (Nicolussi et al., Escola de Enfermagem de Ribeirão Preto/USP) com a fonte original antes de veicular — cláusula "sem promessa de cura" (Termos de Uso, seção 7) exige que toda afirmação factual citada seja verificável.

### Orgânico — Roteiro de apresentação de palestrante (genérico, 1ª pessoa)

Script pronto pra **qualquer palestrante** usar no post/story dele apresentando a própria palestra — em primeira pessoa, como se ele mesmo estivesse falando. Preenche os campos entre colchetes; o parágrafo de abordagem é escrito pelo próprio palestrante, com a voz dele. Enviar junto com o script de abordagem a palestrantes (seção 8).

**Estrutura (Apresentação → Desenvolvimento → Conclusão com CTA):**
1. **Apresentação:** Sou [Nome do palestrante], [especialidade/CRM ou conselho de classe], e vou palestrar no Congresso de Prevenção e Tratamento de Câncer 2026, com o tema "[Tema da palestra]".
2. **Desenvolvimento** (o palestrante escreve, 2-4 frases, em 1ª pessoa — por que esse tema importa na prática dele, um gancho, uma pergunta que ouve com frequência dos colegas, um caso/dado da própria experiência).
3. **Conclusão com chamada para ação** (fixo): 📅 20 e 21 de novembro | 📍 São José dos Campos, SP · 🎓 Certificado digital de 16h · 👉 Te espero lá — inscrições abertas, link na bio / `utm_source=palestrante-NOME`

> Texto completo, com exemplo preenchido, em `Midia/Organica/legenda-apresentacao-palestrantes.md`.
>
> Mais nomes sendo revelados nos próximos posts. Fica ligado. 👀

---

## 7. Captação manual via comentário/DM

Os posts F01-F03 usam CTA "comente a palavra-chave X pra receber":

1. Assim que alguém comentar, **responda publicamente** (curto, ex: "Te chamando no direct! 📩").
2. Envie DM manual com o link do site + UTM daquele post (`utm_source=instagram&utm_medium=organico&utm_campaign=f01`).
3. Se demonstrar interesse real, ofereça o link direto do WhatsApp — é ali que a objeção de preço/tempo/ceticismo (`persona.md`) deve ser respondida uma a uma.
4. Anote manualmente comentários → DMs → WhatsApp → compras. Esse é o funil manual.

---

## 8. Scripts de abordagem

**Palestrantes** (mensagem via WhatsApp/e-mail):
> Oi [Nome], tudo bem? Já estamos na reta final de divulgação do Congresso de Prevenção e Tratamento de Câncer (20-21/nov, São José dos Campos) e adoraríamos contar com você pra ajudar a espalhar pra sua audiência.
>
> Preparei um link exclusivo com seu nome pra você postar no story/feed quando puder: [link com utm_source=palestrante-NOME]
> Assim a gente consegue ver quantas pessoas você trouxe e, no futuro, pensar em alguma forma de reconhecer isso.
> Qualquer coisa que precisar (imagem, texto pronto, informação do evento) é só falar que eu mando!

**Grupos/associações de classe** (tom de indicação pessoal, não propaganda):
> Pessoal, passando aqui porque vi que vai rolar o Congresso de Prevenção e Tratamento de Câncer em novembro (SJC-SP), com [citar 1-2 palestrantes de peso] — achei que várias de vocês que atendem paciente oncológico iam curtir. Tem certificado de 16h e o lote de entrada mais em conta ainda tá aberto. Link aqui: [link com utm_source=grupo-NOME]

---

## 9. Reativação da base de leads (~5.000 contatos de edições anteriores)

Base bem maior do que uma lista pessoal — trate com segmentação real antes de disparar.

**Segmentar antes de qualquer contato:**
- **Recência** — edição mais recente vs. edições antigas.
- **Ticket comprado** — VIP vs. lote padrão.
- **Engajamento** — abriram comunicações antigas vs. nunca responderam.

**WhatsApp como canal principal (manual, em blocos pequenos — 15-20/dia):**

Pra quem já participou:
> Oi [Nome]! Tudo bem? Passando pra avisar que a edição 2026 do Congresso já tá confirmada — 20 e 21 de novembro, SJC. Lembrei de você porque participou antes. Achei que ia querer saber em primeira mão antes do lote fechar: [link utm_source=whatsapp_lista]

Pra quem só demonstrou interesse:
> Oi [Nome]! Tudo bem? Faz um tempo que conversamos sobre o Congresso de Práticas Integrativas em Oncologia. A edição 2026 já tem data fechada (20-21/nov) e o lote de entrada mais em conta ainda tá aberto. Se ainda faz sentido pra você, separei o link: [link utm_source=whatsapp_lista]

Sequência sugerida pra quem responde bem: (1) mensagem de reconexão → (2) oferta exclusiva de acesso antecipado ao Lote 1 antes da divulgação geral → (3) lembrete de urgência na virada de lote.

**E-mail como canal de apoio:** cobre quem não tem WhatsApp cadastrado ou prefere esse canal.

**Quando Meta Ads for autorizado (Frente B):**
- **Custom Audience:** upload da lista (nome + telefone + e-mail) → excluir esse público de campanhas de prospecção fria (economiza verba) → criar **Lookalike Audience** a partir dela pra achar públicos semelhantes.

> ⚠️ **LGPD (ver `SiteCongressoCancer2026/politica-de-privacidade.html`):** confirmar que há base legal/consentimento prévio dos contatos da lista antes de qualquer disparo — a maioria, sendo ex-compradores, tem base em execução de contrato anterior + legítimo interesse de comunicação sobre evento relacionado, mas confirme caso a caso quem pediu explicitamente pra não receber mais.

---

## 10. Frente B — Roadmap de tráfego pago e captação avançada

### B1 — Quiz de captação · ✅ em implementação
Quiz próprio (`SiteCongressoCancer2026/quiz.html`, "Raio-X Profissional") grava direto no Supabase (`quiz_leads`), classifica em Iniciante/Intermediário/Avançado, com dashboard de acompanhamento em `Ads/novva-ads.html` (frio/morno/quente + qualitativo por pergunta). Ver `SUPABASE.md` seção 8-9.

### B2 — Tráfego pago segmentado (Meta Ads + Google Ads)
Agora com cronograma e criativos prontos (seções 2, 5 e 6 deste documento). Otimizar pelo evento de conversão real (`Purchase`/`InitiateCheckout`, já disparado pelo Pixel), não por clique. **Pré-requisito:** autorizar a conta de Meta Ads no conector do claude.ai (pendente) e/ou acesso à conta de Google Ads.

### B3 — Retargeting em camadas
1. Visitou o site mas não interagiu com o quiz → mensagem de curiosidade/dor.
2. Interagiu com o quiz mas não finalizou → mensagem retomando o resultado.
3. Clicou no WhatsApp mas não comprou → mensagem que resolve objeção. Pré-requisito: mesmo de B2.

### B4 — Conteúdo de busca (SEO)
Artigo otimizado (ex: "Terapias complementares no câncer: o que diz a ciência") captando quem pesquisa isso no Google. Ciclo mais longo, sem custo por clique.

### B5 — Chatbot de qualificação
2-3 perguntas de qualificação antes de cair pra atendimento humano. Converge com a Fase 3 do CRM (Cristina/IA) — ver `plano-divulgacao-2026` na memória do projeto.

**Ordem de ativação:** B1 (já em andamento) → B4 → B2/B3 (assim que a conta for autorizada) → B5.

---

## 11. Rotina semanal de acompanhamento

Toda sexta-feira:
1. Abrir `Ads/novva-ads.html`, aba **Tráfego & Conversão**: acessos, WhatsApp clicado, checkout iniciado por `utm_source`/`utm_campaign`, e o card de **ROI** (investido vs. vendas). Aba **Quiz**: leads frios/mornos/quentes + qualitativo. Aba **CRM**: fila de conversas sem vendedor.
2. Identificar o post/canal que mais converteu — repetir/reforçar na semana seguinte.
3. Ajustar texto de abordagem se algum canal estiver com retorno visivelmente mais baixo.

---

## 12. Checklist consolidado

- [ ] **Semana 0:** Definir data-alvo interna de virada Lote 1→2. Levantar contatos dos palestrantes.
- [ ] **9-15/set:** Publicar F01, F02. Responder manualmente comentários/DMs. Contatar 2-3 palestrantes mais engajados.
- [ ] **16-22/set:** Publicar F03, F12. Abordar 1-2 grupos/associações de classe.
- [ ] **23-30/set:** Fechar apresentação de palestrantes. Teaser "inscrições abertas".
- [ ] **1-15/out:** Publicar F05 (venda). Começar reativação da base (segmento "já participou").
- [ ] **16/out-5/nov:** Publicar F04, F08, F06. Continuar reativação (segmento "só demonstrou interesse"). Revisar dashboard semanalmente.
- [ ] **6-18/nov:** Publicar F09, F10, F07, F11. Urgência máxima, contagem regressiva.
- [ ] **20-21/nov:** Cobertura ao vivo (stories/Reels/bastidores).
- [ ] **A partir de 22/nov:** Depoimentos, reciclagem do post de melhor desempenho, nutrir lista pra 2027.

---

## Fontes (pesquisa de mercado, 2026)

- [Trafego Commanel — Como criar iscas digitais para campanhas](https://trafegocommanel.com.br/blog/como-criar-iscas-digitais-para-campanhas/)
- [Ebookr.ai — Isca Digital de Alta Conversão](https://ebookr.ai/blog/isca-digital-alta-conversao/)
- [Agência Nagase — Leads de vendas: guia prático](https://www.nagase.com.br/leads-de-vendas-guia-pratico/)
- [Agência Nagase — 14 tendências em tráfego pago para 2026](https://www.nagase.com.br/tendencias-trafego-pago-2026/)
- [Callbox — Lead Generation for Events: The Complete B2B Playbook for 2026](https://www.callboxinc.com/blog/lead-generation-events/)
- [BookYourData — Event Lead Generation: 16 Strategies for Conferences and Professional Events](https://www.bookyourdata.com/blog/event-lead-generation)
- [SEO Page Creator — Paid Ads vs Organic Lead Generation 2026](https://www.seopagecreator.com/blog/paid-ads-vs-organic-lead-generation/)
- [PayDads — Lead Generation Strategies That Work in 2026](https://www.paydads.com/blog/lead-generation-strategies-that-actually-work-in-2026)

*Documento de uso interno Novva Saúde Integrativa, calibrado com `docs/persona.md`.*
