# Rascunho: ajuste da Política de Privacidade para o uso de IA no atendimento

> **Para quem é:** advogado ou DPO que vai revisar. É um rascunho de texto, **não é parecer jurídico**.
> Data: 07/10/2026. Arquivo a ajustar depois da aprovação: `politica-de-privacidade.html`.

## Contexto (para o revisor)

- O público dos leads são **congressistas**: profissionais de saúde (médicos, dentistas, farmacêuticos,
  enfermeiros, fisioterapeutas, terapeutas) que vão participar de um **evento presencial** sobre
  oncologia integrativa, para aprender a lidar melhor com pacientes. **Não são pacientes**, e o CRM
  não guarda prontuário nem dado clínico.
- Hoje a política (seção 2.3) já informa que o primeiro atendimento pode ser feito por uma
  **assistente virtual (IA) que se identifica como tal**, passando para um humano quando necessário
  ou a pedido da pessoa. Isso cobre a "Cris", que conversa direto com o lead.
- O que se quer acrescentar: a equipe comercial poderá usar IA **como apoio interno**, lendo o
  histórico da conversa para gerar **resumo** e **sugestão de resposta**. A IA **nunca envia nada
  sozinha**: uma pessoa revisa e envia.
- O provedor de IA usado é a **Anthropic** (modelo Claude Haiku). Os dados são processados em
  servidores fora do Brasil. Hoje a Anthropic **não consta** na seção 4 (Com quem compartilhamos).
- A política já esclarece (seção 2.2) que o quiz mede nível de repertório profissional e não é dado
  de saúde.

## Alterações propostas

### 1. Seção 2.3 (Atendimento via WhatsApp): acrescentar ao final do parágrafo

> Para organizar o atendimento, nossa equipe também pode usar ferramentas de inteligência artificial
> que leem o histórico da conversa para gerar resumos e sugestões de resposta. Essas ferramentas
> funcionam como apoio interno: nenhuma mensagem é enviada a você sem ter sido revisada e enviada
> por uma pessoa da equipe. Evite incluir na conversa dados que identifiquem pacientes.

### 2. Seção 3 (Base legal): nova linha na tabela

| Dado | Finalidade | Base legal |
|---|---|---|
| Conteúdo da conversa de WhatsApp | Resumir o atendimento e apoiar a resposta da equipe, com revisão humana | Legítimo interesse, art. 7º, IX *(confirmar; para quem já comprou, avaliar também execução de contrato, art. 7º, V)* |

### 3. Seção 4 (Com quem compartilhamos): nova linha na lista

> **Anthropic** (provedor de inteligência artificial que processa o texto das conversas para gerar
> resumos e sugestões de resposta). *(Confirmar a frase com os termos comerciais e a política de
> dados da Anthropic antes de afirmar qualquer coisa sobre uso do conteúdo para treinamento.)*

### 4. Seção 5 (Transferência internacional de dados): incluir o provedor

> Alguns dos provedores acima (Meta, Anthropic, infraestrutura de nuvem) podem processar dados em
> servidores fora do Brasil. Nesses casos, o tratamento segue as hipóteses do art. 33 da LGPD,
> buscando garantias de proteção equivalentes às exigidas pela lei brasileira.

### 5. Texto de aceite do quiz e do Flow (opcional)

Texto atual: *"Autorizo o uso do meu nome, WhatsApp, e-mail e área de atuação para contato sobre o
Congresso Câncer 2026, por WhatsApp e e-mail, pela equipe organizadora (Novva Saúde Integrativa).
Posso pedir a exclusão dos meus dados quando quiser."*

Se o jurídico entender que a IA deve constar também aqui, uma opção:

> …pela equipe organizadora (Novva Saúde Integrativa), que pode usar ferramentas de inteligência
> artificial como apoio ao atendimento. Posso pedir a exclusão dos meus dados quando quiser.

Atenção: o CRM guarda o **texto exato** de cada aceite (`quiz_leads.respostas.texto_aceite` e
`whatsapp_marketing_optin.texto_recebido`). Mudar o texto vale só para quem aceitar depois da
mudança; os aceites antigos continuam registrados com o texto antigo.

## Orientação interna ao time comercial (fora da política)

- Conferir e ajustar a sugestão da IA antes de enviar. A IA nunca envia sozinha.
- Se o lead pedir para falar com uma pessoa, passar para o humano na hora.
- Evitar colar na conversa ou no pedido de análise dados que identifiquem pacientes (caso raro: um
  profissional citar um caso).

## Perguntas para o advogado

1. Legítimo interesse é a base adequada para a análise de apoio interno, com revisão humana?
2. A frase sobre a Anthropic está correta? Conferir a política de dados dela antes de publicar.
3. É preciso avisar quem já aceitou antes, ou basta atualizar a política e o texto de aceite
   daqui para frente?
4. Faz sentido registrar formalmente que a avaliação de impacto (RIPD) foi considerada?
5. Precisa informar que existe análise por IA, mesmo sendo apoio interno, ou basta constar na política?
