# Segurança de convites e gestão

## Modelo de ameaça

Proteger contra adivinhação de links, partilha acidental, acesso cruzado entre convidados, enumeração de eventos, roubo de sessão, XSS em conteúdo fornecido pelo anfitrião e exposição em logs, referers ou analytics. A vinculação ao primeiro navegador reduz reutilização do link, mas não prova a identidade do convidado e não impede o primeiro destinatário de o encaminhar antes de ser reclamado.

## Tokens de convite

- Gerar token opaco com CSPRNG e entropia suficiente (pelo menos 256 bits); não derivar de UUID, email, nome ou ID incremental.
- Persistir apenas hash criptográfico do token. Comparar de forma segura e limitar tentativas por IP e por recurso.
- Separar token de convite de segredo de gestão; escopos, expiração e revogação nunca se sobrepõem.
- Remover segredos dos logs da aplicação e do proxy, exception trackers, analytics e cabeçalho `Referer`. Configurar política de referência restritiva na página de convite.
- Não incluir PII ou IDs previsíveis no URL.

## Vinculação ao primeiro navegador

1. O primeiro claim válido é atómico e imutável por omissão.
2. No claim, emitir uma credencial aleatória de navegador em cookie `Secure`, `HttpOnly`, `SameSite=Lax` (ou configuração compatível com o domínio real), com Path restrito e duração limitada ao ciclo de vida do convite.
3. Persistir apenas o hash da credencial. Todos os GET/RSVP subsequentes com token exigem a mesma capacidade.
4. Se um browser diferente abrir o URL, responder com o mesmo 404 genérico de token inválido. Não informar “já usado”, destinatário ou estado.
5. A mesma sessão de browser pode revisitar o convite e alterar RSVP se o prazo/estado permitir.
6. Limpar o cookie se o convite for revogado/expirar. A limpeza de cookies, outro perfil, modo privado ou outro dispositivo pode impedir o convidado de voltar a aceder; explicar esta limitação na UX.
7. A política de recuperação de claim é uma decisão pendente de produto. Não criar um mecanismo de takeover baseado só no email sem aprovação explícita.

Cookies e CORS devem ser verificados na arquitectura de domínio real. Não relaxar para `SameSite=None` ou origens wildcard sem necessidade e avaliação de CSRF.

## Segredo de gestão do anfitrião

- Gerar um segredo independente e aleatório, guardar apenas o hash e enviá-lo uma vez no link de gestão para o email do anfitrião verificado/introduzido na criação do evento.
- Preferir trocar o segredo por uma sessão com cookie HttpOnly, curta, revogável e com escopo limitado ao evento. Proteger operações mutáveis contra CSRF.
- A posse do link permite gerir o evento e ver a lista privada; a interface e email devem explicar que qualquer pessoa com esse link pode ter esse acesso.
- Não colocar o segredo em referrer, logs, ferramentas analíticas, screenshots automáticos ou mensagens de erro. Considerar fragmento URL e troca imediata por cookie.
- Limitar taxa de tentativas, permitir revogação/rotação apenas a quem já tem acesso, e registar auditoria sem o segredo.

## Dados pessoais e bancários

- Minimizar recolha: email obrigatório; telefone apenas opcional e sem uso automático.
- Dados bancários são informação sensível operacional, acessível ao anfitrião e só aos convidados daquele evento quando habilitados. Aplicar TLS, controlos de acesso, minimização de logs e encriptação de volume/backups conforme as práticas de produção.
- Não usar dados de convidados para treino, analytics ou finalidades não descritas.
- Renderizar mensagens, regras e vestuário como texto escapado. Nunca confiar em HTML fornecido pelo utilizador.
- Definir processo de eliminação e retenção antes de produção, sujeito a revisão legal/local.

## Outros controlos obrigatórios

- TLS; CSRF para endpoints autenticados por cookie; CORS com allowlist; headers de segurança; validação server-side; rate limiting; dependências actualizadas.
- Autorização negada por omissão em toda rota de gestão. UUIDs não são autorização.
- Respostas públicas de token inválido, expirado, revogado ou reclamado noutro navegador não podem permitir enumeração.
- Não devolver erros do provider, SQL, paths locais, stack traces nem valores dos tokens ao cliente.
- Usar políticas de log redacted. Cobrir explicitamente logs HTTP, filas, retries e traces.
- Testar concorrência de claims, CSRF, replay e acessos cruzados entre convites.
