# Contrato da API — primeira fase

Este contrato é a fronteira comum entre frontend e backend. Os caminhos abaixo são propostos e podem ser adaptados à implementação Express, mas não se devem alterar silenciosamente os campos, estados ou regras de acesso.

## Convenções

- Base sugerida: `/api/v1`.
- JSON UTF-8; datas de resposta em ISO 8601 UTC, acompanhadas do fuso IANA do evento.
- UUIDs para recursos internos expostos; tokens de convite e gestão são aleatórios, opacos e independentes dos UUIDs.
- Não expor tokens guardados/hasheados, emails de outros convidados, telefones ou estado RSVP de terceiros nas respostas públicas.
- Erros seguem um formato estável, por exemplo:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Verifique os campos indicados.",
    "fields": {
      "starts_at": ["A data deve ser futura."]
    },
    "request_id": "..."
  }
}
```

Mensagens públicas não incluem detalhes internos. `request_id` permite investigação no servidor sem transmitir PII em logs.

## Endpoints conceptuais

### Templates publicados

`GET /templates`

Devolve apenas templates activos e os campos/temas que suportam. Uma lista vazia é válida. Não incluir HTML arbitrário executável.

### Criar evento e convidados

`POST /events`

Payload conceptual:

```json
{
  "event": {
    "title": "Festa de celebração",
    "host_name": "Anfitriã",
    "host_email": "host@example.test",
    "starts_at": "2027-06-12T17:00:00Z",
    "timezone": "Africa/Luanda",
    "location": {"type": "venue", "name": "Espaço", "address": "..."},
    "message": "...",
    "rules": "...",
    "dress_code": "...",
    "template_id": "...",
    "theme": {"mode": "dark", "palette": "blue-violet"},
    "contribution": {
      "enabled": true,
      "bank_name": "...",
      "account_holder": "...",
      "account_reference": "..."
    },
    "rsvp_deadline": "2027-06-05T23:00:00Z"
  },
  "guests": [
    {"name": "Convidado", "email": "guest@example.test", "phone": null}
  ]
}
```

Validar tamanhos, email, fuso IANA, coerência de data, template activo, endereço/URL e dados de contribuição condicionalmente. O payload não permite injectar token, estado RSVP, hash ou identificador de navegador.

Resposta `201 Created`: dados não secretos necessários ao resumo e estado de enfileiramento dos emails. O segredo de gestão não é devolvido ao frontend; é enviado uma vez para o email do anfitrião no link de gestão. Não guardar o token de gestão em claro para voltar a mostrá-lo.

Convites são individuais e enviados por email. Resposta deve comunicar `queued`/`sent`/`failed` por destinatário sem declarar entrega garantida pelo provider.

### Gestão de evento

`GET /host/events/{event_id}` e operações de edição/cancelamento sob sessão/capacidade de gestão.

O acesso exige a credencial secreta de gestão, trocada preferencialmente por cookie HttpOnly e limitado. Resposta de gestão pode incluir convidados e estados RSVP, mas apenas sob esta capacidade. Nunca aceitar o UUID do evento como autorização.

### Troca de link secreto de gestão

`POST /host/session`

Recebe o segredo de gestão uma vez, valida em tempo constante quando aplicável e emite cookie de sessão de curta duração, `Secure`, `HttpOnly`, `SameSite` apropriado e escopo mínimo. Não devolver segredo em JSON nem gravá-lo nos logs. Ter endpoint de revogação/saída.

### Claim e consulta do convite

`POST /public/invitations/{token}/claim`

- Executar atomicamente o primeiro claim e emitir cookie de capacidade de navegador.
- Primeira claim válida devolve a apresentação pública do convite e define o cookie.
- Se já reclamado por outra capacidade, token inválido, expirado ou revogado, usar o mesmo status e corpo públicos (404 genérico).
- Se a mesma capacidade apresenta o token, permitir reabrir e receber a apresentação actualizada, enquanto o convite for válido.
- Não revelar estado de claim na mensagem de erro.

`GET /public/invitations/{token}` exige a capacidade/cookie previamente estabelecida e retorna apenas dados de exibição e o RSVP do próprio convidado.

### RSVP

`PUT /public/invitations/{token}/rsvp`

Payload:

```json
{"status": "accepted"}
```

`status` só pode ser `accepted` ou `declined`. Requer capacidade do navegador vinculada. O backend guarda transição, notifica anfitrião nas mudanças relevantes e cancela futuros lembretes ao recusar. Repetir o mesmo pedido não duplica notificações.

### Partilha

Não existe endpoint de envio a WhatsApp/SMS/redes sociais na fase 1. Cliente usa o URL individual já recebido, com partilha nativa ou cópia. Não criar endpoint que devolva tokens de todos os convidados.

## Estados e códigos recomendados

- `400`: JSON/formato inválido.
- `401` ou `403`: capacidade ausente/inválida em endpoints de gestão ou RSVP privados.
- `404`: recurso não encontrado; usar resposta genérica também para link reclamado por outro navegador.
- `409`: conflito de estado não sensível, quando o contrato do endpoint o permitir.
- `422`: erro de validação com mapa de campos.
- `429`: limite de pedidos excedido.
- `5xx`: erro interno com `request_id`, sem detalhes de excepção.

Não fazer enumeração de tokens: limites de taxa, resposta de tamanho semelhante, mensagens genéricas e tokens com entropia criptográfica são obrigatórios.
