# Instruções gerais para agentes de desenvolvimento

## 1. Objetivo do produto

Construir uma plataforma web para criar eventos, escolher um template de convite, registar convidados e enviar convites e lembretes por email. Cada convidado recebe um link individual. O convidado pode consultar os detalhes do evento e responder ao convite; uma recusa deve parar os lembretes desse convidado e notificar a anfitriã ou o anfitrião.

O frontend será desenvolvido com Angular 22, TypeScript e Tailwind CSS. O backend será desenvolvido com Node.js 20, Express, TypeScript e PostgreSQL. A camada de contas de anfitrião (registo e login com email e senha) foi aprovada e implementada; o link secreto de gestão por evento mantém-se válido em paralelo. Continua fora do âmbito: painel administrativo, pagamentos, planos pagos e envio automatizado por SMS ou WhatsApp.

## 2. Fonte de verdade e ordem de leitura

1. Ler este ficheiro antes de alterar código.
2. A especificação autoritária do backend está em [`backend/`](backend/README.md).
   Em caso de conflito com qualquer outro documento, prevalece esta pasta.
3. Ordem de leitura do backend:
   - [`backend/api-contract.md`](backend/api-contract.md)
   - [`backend/invitation-security.md`](backend/invitation-security.md)
   - [`backend/architecture-and-data-model.md`](backend/architecture-and-data-model.md)
   - [`backend/email-and-reminders.md`](backend/email-and-reminders.md)
4. A documentação da implementação está em [`docs/README.md`](docs/README.md):
   - [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) descreve o contrato v1 efectivamente implementado, incluindo contas, perfil, workspace, cookies/CSRF e paginação.
   - [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) descreve o esquema real da base de dados, incluindo `hosts`, `host_profiles`, `host_auth_sessions`, `event_host_sessions`, `event_activity` e `host_tasks`.
   - [`docs/CONTAS-E-REQUISITOS-FRONTEND.md`](docs/CONTAS-E-REQUISITOS-FRONTEND.md) é a especificação funcional que motivou a camada de contas; o estado implementado prevalece nos dois documentos anteriores.
   - Frontend: os documentos do repositório `apupu_front`.
5. Se dois documentos parecerem contradizer-se, seguir primeiro a especificação em
   `backend/` e os fluxos de aceitação do frontend. Registar a discrepância e pedir
   esclarecimento antes de implementar uma alteração de negócio.
6. Não inventar requisitos ausentes. Para decisões que alterem privacidade, segurança,
   comportamento de convites, persistência, canais de comunicação ou âmbito do produto,
   parar e perguntar ao responsável.

## 3. Regras de trabalho

- Antes de editar, inspeccionar a estrutura real do projecto, os ficheiros existentes, os comandos de validação e as convenções usadas. Não assumir que um repositório vazio continua vazio.
- Procurar implementações e componentes reutilizáveis antes de criar novos.
- Fazer alterações pequenas, completas e coerentes com o âmbito pedido. Não reformatar nem corrigir problemas não relacionados.
- Preservar alterações pré-existentes; nunca descartar trabalho de outras pessoas.
- Manter TypeScript estrito, validação de entrada explícita e erros visíveis segundo os padrões do projecto. Não ocultar falhas com valores por omissão ou blocos `catch` genéricos.
- Não guardar segredos, tokens de convite, dados bancários ou conteúdo pessoal em logs, telemetria, URLs de analytics ou mensagens de erro.
- Não tratar um link secreto como autenticação robusta. O produto tem contas de anfitrião, mas a posse do link de gestão continua a permitir gerir o evento (fluxo legado); nunca assumir que o link identifica uma pessoa.
- Não afirmar que um convite é inviolável ou que a vinculação ao navegador identifica uma pessoa ou um dispositivo físico.
- Actualizar a documentação directamente relacionada com qualquer mudança de contrato ou comportamento.
- Não adicionar dependências, ferramentas, ficheiros ou abstrações sem necessidade demonstrável.
- Não criar, editar ou carregar templates finais sem material fornecido pelo responsável. Os templates principais serão adicionados posteriormente.

## 4. Sequência obrigatória para implementar uma tarefa

1. **Confirmar o âmbito:** converter o pedido em comportamento observável e listar os fluxos afectados.
2. **Inspeccionar:** localizar os pontos de entrada, dependências, modelos, componentes, rotas, migrações e testes relevantes.
3. **Planear:** identificar alterações frontend, backend, contrato, dados, segurança, acessibilidade e documentação; pedir esclarecimento se uma regra essencial não estiver definida.
4. **Implementar:** seguir os documentos da área e reutilizar os padrões existentes. Aplicar validação no cliente para UX e, independentemente, no servidor como autoridade.
5. **Testar:** executar a validação mais pequena que cobre a alteração; acrescentar testes para novos caminhos, erros e regras de negócio.
6. **Rever:** verificar o diff completo, confirmar que não foram introduzidos ficheiros CSS extra no frontend, segredos, alterações fora do âmbito ou divergências nos contratos.
7. **Relatar:** resumir o que mudou, os testes executados e qualquer limitação, risco ou decisão pendente. Nunca declarar um teste aprovado se não foi executado.

## 5. Critérios globais de aceitação

- Um anfitrião consegue criar conta com email e senha, verificar o email e iniciar sessão.
- Um anfitrião autenticado consegue criar, listar, editar e apagar os seus eventos; outro anfitrião não vê nem altera esses eventos.
- Um anfitrião consegue preparar um evento sem criar conta e recebe um link secreto de gestão.
- O perfil permite data de nascimento opcional; a ausência desse campo não bloqueia o uso da conta.
- Listas do workspace são paginadas e devolvem metadados de paginação estáveis.
- Cada convidado tem uma identidade de convite e um link próprio; não se reutiliza o link de outro convidado.
- O primeiro navegador que reclamar um convite fica vinculado a esse convite. A mesma sessão de navegador pode voltar a consultar e responder; outro navegador recebe uma resposta visual indistinguível de não encontrado.
- A página pública nunca expõe informação privada de outros convidados.
- Convidados podem aceitar, alterar a resposta ou recusar. Uma recusa termina os lembretes futuros e informa o anfitrião por email.
- O sistema não envia SMS nem mensagens por WhatsApp. A partilha manual de um URL não constitui um canal de envio suportado nem remove a vinculação do convite.
- Os lembretes automáticos usam a cadência aprovada de 14, 7, 3 e 1 dia antes do início do evento, sempre no fuso horário do evento. Não há lembretes depois de uma recusa ou cancelamento.
- A interface suporta temas claro e escuro e usa a linguagem visual da imagem de referência: painel futurista, fundo azul-noite, azul eléctrico, acentos violeta/ciano, cartões translúcidos e brilho controlado.
- O frontend contém no máximo um ficheiro CSS global de entrada, necessário para importar/configurar Tailwind. Não são permitidos CSS de componente, folhas adicionais, estilos inline ou `<style>` em templates.

## 6. Decisões fechadas para a primeira fase

| Tema | Regra |
|---|---|
| Autenticação | Contas de anfitrião com email e senha (Argon2id). O link secreto de gestão por evento mantém-se válido em paralelo. |
| Verificação de email | Necessária para criar/gerir eventos; o login é permitido antes da verificação. |
| Perfil | Data de nascimento opcional (`YYYY-MM-DD`, passado, idade mínima configurável). A ausência não bloqueia a conta. |
| Claim do convite | Vinculado ao primeiro navegador/sessão que o reclamar. Não é uma identificação de hardware. |
| Canal automático | Apenas email. Telefone pode ser guardado como dado opcional, mas não habilita envio nesta fase. |
| Partilha | Link pode ser copiado ou partilhado pelo menu nativo do sistema; serviços externos não são integrados para envio. |
| Lembretes | Emails aos 14, 7, 3 e 1 dias antes do evento. |
| Templates | Infraestrutura e ponto de extensão podem ser preparados, mas os templates finais serão fornecidos pelo responsável. |
| Monetização e administração | Fora do âmbito. |

## 7. Questões que exigem confirmação antes de produção

Não bloquear protótipos locais por estes pontos, mas não escolher silenciosamente uma política final:

- Política legal de retenção e eliminação de dados pessoais e bancários.
- Regras locais de consentimento, unsubscribe e privacidade para emails transaccionais.
- Limites de tamanho, formato e acessibilidade dos templates finais.
- Domínio definitivo e configuração de cookies same-site entre aplicação e API.
- Regras para recuperação de acesso se o anfitrião perder o link secreto.

