# Emails e lembretes

## Canais e consentimento

- Apenas email é enviado automaticamente na primeira fase.
- Email do anfitrião e de cada convidado é obrigatório para as funções de notificação. Telefone é opcional e não inicia SMS ou WhatsApp.
- Partilha de convite em aplicações externas é manual, pelo browser do utilizador; não existe integração nem garantia de entrega nessas redes.
- Usar templates de email transaccionais aprovados, com versão texto simples, remetente configurado e links HTTPS individuais.
- Não incluir dados bancários completos, lista de convidados ou informação privada desnecessária no assunto do email.
- Incluir informação de contacto e preferências/opt-out quando exigido pela política legal aprovada. Não tratar opt-out como consentimento nem dispensar revisão local.

## Tipos de mensagem

1. **Convite inicial:** um email individual por convidado após o evento e o convite serem guardados com sucesso.
2. **Confirmação de resposta ao convidado:** opcional e idempotente; se implementada, enviada somente após RSVP aceite/recusado persistido.
3. **Aviso ao anfitrião:** email após uma recusa, identificando o convidado e o evento. Notificações de confirmação podem ser opcionais/configuradas; a recusa tem de ser notificada conforme requisito.
4. **Lembretes do evento:** sequência limitada abaixo. O texto adapta-se ao RSVP: pendente inclui chamada para responder; aceite recorda os detalhes do evento.

## Cadência aprovada

Agendar lembretes para **14, 7, 3 e 1 dia antes** do início do evento, às 09:00 no fuso horário do evento como valor inicial recomendado. Esta cadência dá aviso semanal nos 14/7 dias e aumenta a atenção perto do evento sem enviar um email diário na última semana.

- Se um evento for criado depois de um marco, não enviar retroactivamente todos os lembretes perdidos. Agendar apenas os marcos futuros.
- Se o evento começar em menos de 24 horas, não disparar uma série comprimida. Aplicar apenas o marco futuro de 1 dia se ainda fizer sentido, caso contrário não enviar lembrete de contagem decrescente.
- Ao editar data/fuso, cancelar e reconstruir apenas entregas futuras ainda não enviadas.
- Se o evento for cancelado, invalidar todos os lembretes pendentes e enviar comunicação de cancelamento aos convidados conforme fluxo implementado.
- Uma recusa suprime imediatamente todos os lembretes futuros desse convite; aceitações continuam a receber lembretes informativos do evento.
- Se RSVP deadline anteceder o evento, pode existir um email específico de prazo somente após aprovação de produto. Não multiplicar ou antecipar automaticamente a cadência acima.

## Idempotência, filas e falhas

- Cada entrega prevista tem chave única `(invitation_id, message_type, scheduled_for)` ou equivalente. Reexecutar scheduler/job não cria envio adicional.
- Jobs verificam novamente, imediatamente antes do envio, que o evento está activo, convite não foi recusado/revogado, destinatário não está suprimido e o marco ainda é aplicável.
- Persistir o estado de entrega (`pending`, `processing`, `sent`, `failed`, `cancelled`/equivalente), tentativas, provider ID e timestamps.
- Usar backoff limitado para falhas temporárias; falha permanente deve ser observável e aparecer ao anfitrião sem expor detalhes internos.
- Distinguir enfileirado, aceite pelo provider e entregue quando o provider oferece callback fiável. Não prometer entrega garantida.
- Evitar duplicidade quando o provider aceita a mensagem mas a confirmação se perde; usar idempotency key do provider quando disponível e reconciliar callbacks.
- Não registar corpo completo nem URL com token. Redactar endereços quando possível nos logs operacionais e limitar o acesso à fila.

## Cancelamento e consistência

Alteração para RSVP `declined`, cancelamento do evento ou revogação do convite deve marcar notificações futuras como canceladas numa mesma unidade lógica de consistência/outbox. Um job já enfileirado consulta o estado actual antes de enviar. Rejeitar atrasos e retries que tentem ressuscitar uma entrega cancelada.

