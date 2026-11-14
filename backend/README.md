# Backend — Node.js, Express, TypeScript e PostgreSQL

## Objectivo

Implementar a API e os processos de email que suportam criação de eventos sem conta, convites individuais, claim do primeiro navegador, gestão por link secreto, RSVP e lembretes.

## Ordem de leitura

1. [`../../agents.md`](../../agents.md)
2. [`api-contract.md`](api-contract.md)
3. [`invitation-security.md`](invitation-security.md)
4. [`architecture-and-data-model.md`](architecture-and-data-model.md)
5. [`email-and-reminders.md`](email-and-reminders.md)

## Limites da fase 1

- Node.js com Express, TypeScript em modo estrito e PostgreSQL.
- Sem utilizadores, login, painel admin, pagamentos ou subscrição.
- Email é o único canal automático. Telefones opcionais não podem ser usados para enviar mensagens.
- O frontend nunca substitui validação, autorização, controlo de acesso ou regras do servidor.
- Links públicos de convidado são aleatórios e exclusivos por convite. Links de gestão são segredos bearer separados.
- Dados bancários são apresentados ao convidado apenas quando o anfitrião habilitar a funcionalidade. Não guardar dados de cartão nem processar transferências.

## Critérios para entregar

- Migrações, índices, chaves estrangeiras e constraints suportam concorrência e estados válidos.
- Operações de claim e RSVP são transaccionais e resistentes a pedidos repetidos.
- Respostas públicas não revelam PII ou estado de outros convidados.
- Emails são enviados por fila; falhas/retries são observáveis e idempotentes.
- Testes cobrem autorização negativa, corrida de dois claims, recusa, cancelamento e entrega duplicada de jobs.
- Segredos não são guardados em claro nem escritos em logs. Configuração de chaves e fornecedores de email é fornecida por ambiente/gestão de segredos.
