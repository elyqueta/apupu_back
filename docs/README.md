# Documentação — Apupu

Índice da documentação do backend.

## Fonte de verdade

A pasta [`../backend/`](../backend/) contém a especificação autoritária do
produto. Em caso de conflito, prevalece sempre sobre os restantes
documentos:

| Documento | Conteúdo |
|---|---|
| [`../backend/api-contract.md`](../backend/api-contract.md) | Contrato conceptual entre frontend e backend |
| [`../backend/invitation-security.md`](../backend/invitation-security.md) | Tokens, claim do primeiro navegador, sessão de gestão e CSRF |
| [`../backend/architecture-and-data-model.md`](../backend/architecture-and-data-model.md) | Entidades, transacções, concorrência e fusos horários |
| [`../backend/email-and-reminders.md`](../backend/email-and-reminders.md) | Cadência, idempotência, retries e cancelamento de emails |

## Documentação da implementação

Estes documentos descrevem o que o código **faz actualmente** e devem ser
mantidos em sincronia com a implementação:

| Documento | Conteúdo |
|---|---|
| [API-CONTRACT.md](./API-CONTRACT.md) | Rotas, payloads, cookies, CSRF e códigos de erro da v1 |
| [DATA-MODEL.md](./DATA-MODEL.md) | Tabelas, relações, constraints e invariantes reais |
| [`../README.md`](../README.md) | Arranque, configuração, Docker, testes e operação |

Regras de produto e âmbito: [`../agents.md`](../agents.md).

## Requisitos de contas

O documento de requisitos que motivou a camada de contas continua a ser
útil como especificação funcional:

| Documento | Conteúdo |
|---|---|
| [CONTAS-E-REQUISITOS-FRONTEND.md](./CONTAS-E-REQUISITOS-FRONTEND.md) | Contas de anfitrião (registo/login email+senha), perfil com data de nascimento e endpoints de suporte ao frontend |

O estado **implementado** está descrito em
[API-CONTRACT.md](./API-CONTRACT.md) e
[DATA-MODEL.md](./DATA-MODEL.md). As decisões de produto fechadas, com
o respectivo estado de implementação, estão em
[DECISOES-PRODUTO.md](./DECISOES-PRODUTO.md).

## Documentação interactiva

Com a API a correr em desenvolvimento:

- Scalar UI: <http://localhost:3000/api-docs>
- OpenAPI JSON: <http://localhost:3000/openapi.json>

A documentação é gerada a partir dos comentários JSDoc das rotas em
`src/routes/v1/`.
