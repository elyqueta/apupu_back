# Arquitectura e modelo de dados

## Componentes recomendados

- API Express versionada, por exemplo `/api/v1`, implementada em TypeScript estrito. Usar middleware para validação e controlo de acesso, serviços para regras de negócio e DTOs para respostas explícitas.
- PostgreSQL como fonte persistente de verdade.
- Processos de trabalho em fila para convites, avisos de RSVP e lembretes; manter o envio de email fora do ciclo síncrono dos pedidos HTTP.
- Um scheduler durável para descobrir lembretes vencidos; a tabela de entregas é a protecção contra duplicação, não um temporizador em memória do processo Express.
- Email através de um provider configurado por ambiente. Não acoplar regras de negócio ao fornecedor.

## Entidades conceptuais

Adaptar nomes às convenções TypeScript e PostgreSQL do projecto, mantendo as propriedades de segurança e integridade abaixo.

### `events`

- UUID opaco; título; nome e email de contacto do anfitrião.
- `starts_at` como instante UTC e `timezone` IANA obrigatório para apresentação e cálculo de calendários.
- Local e instruções de acesso ou URL de evento online, mutuamente validados conforme o tipo.
- Mensagem, regras, código/valor de vestuário; template publicado seleccionado; tema e cores permitidos.
- Prazo RSVP opcional.
- Contribuição habilitada (`contribution_enabled`) e campos bancários opcionais, validados apenas quando habilitados.
- Estado `draft`, `scheduled`, `cancelled` ou `completed`/equivalente conforme transições definidas; não aceitar envio enquanto o evento não estiver pronto.
- Segredo de gestão apenas como hash verificável; timestamps, expiração e revogação.

### `invitations`

- UUID; `event_id`; nome do convidado; email obrigatório; telefone opcional.
- Hash do token público aleatório. Token bruto só é revelado no momento de criação/envio necessário.
- Estado RSVP `pending`, `accepted` ou `declined`; timestamp e versão de estado.
- Estado de claim, hash da credencial de navegador ou identificador equivalente, data do claim e revogação.
- Estado de envio e timestamps úteis, sem assumir sucesso de entrega só porque o job foi enfileirado.
- Constraints de unicidade do token/hash e índices para evento, estado RSVP, envio e claims.

### `email_deliveries` / `reminder_deliveries`

- Destinatário lógico (evento/convite), tipo de mensagem, instante previsto, estado, número de tentativas, provider ID e timestamps.
- Chave idempotente única por convite, tipo de lembrete e instante agendado. Guardar conteúdo mínimo necessário para auditoria operacional.
- Não guardar tokens de link em texto claro na linha de entrega ou no log do provider; renderizar link só no momento necessário e evitar logs de URLs completos.

### Templates

- Só publicar templates aprovados e activos. A API devolve os campos/capacidades suportados e metadados de preview.
- Não assumir que o frontend pode definir livremente estrutura executável ou HTML de templates.

## Relações e integridade

- Um evento tem zero ou mais convites; um convite pertence a exactamente um evento.
- Excluir/cancelar um evento deve invalidar convites e jobs futuros segundo uma transacção/estado explícito; não apagar silenciosamente o histórico antes da política de retenção ser aprovada.
- Uma recusa afecta apenas o convite do próprio convidado e impede novas notificações de lembrete para esse convite.
- Nunca permitir que uma consulta pública derive o conjunto de convidados pelo identificador do evento.
- Constraints na base de dados devem defender invariantes críticas mesmo sob pedidos concorrentes.

## Transacções e concorrência

- Claim deve fazer uma actualização condicional/transacção que só atribui navegador se ainda não houver claim. Dois pedidos simultâneos não podem reclamar o convite em navegadores distintos.
- RSVP deve exigir claim válido e actualizar de forma atómica; respostas duplicadas iguais devem ser idempotentes.
- Alterações para `declined` e marcação de cancelamento de lembretes ocorrem na mesma transacção lógica.
- Criar convites e enfileirar notificações deve usar padrão after-commit/outbox ou estratégia equivalente que evite emails para dados revertidos e perda silenciosa de mensagens.
- Jobs são entregues pelo menos uma vez; cada handler precisa ser idempotente.

## Datas e fuso horário

- Guardar instantes em UTC e nome do fuso IANA do evento.
- Calcular `T-14`, `T-7`, `T-3` e `T-1` usando o calendário local do evento e converter cada envio para um instante UTC válido.
- Definir uma hora local de envio consistente e configurável pelo produto (recomendação inicial: 09:00 no fuso do evento); lidar com transições DST e horários inexistentes/ambíguos sem duplicar ou perder entregas.
- Ao editar data/fuso, recalcular/remarcar lembretes ainda não enviados e cancelar entregas obsoletas.

## Retenção

Não codificar uma duração legal como se estivesse aprovada. Documentar a retenção proposta, permitir eliminação/anonimização futura e obter confirmação de privacidade/jurídica antes de produção. Aplicar desde já minimização, controlo de acesso e não registo de segredos.
