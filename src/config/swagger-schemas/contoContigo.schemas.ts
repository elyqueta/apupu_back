/**
 * Componentes OpenAPI do Conto Contigo.
 *
 * O contrato público usa snake_case. Os DTOs da aplicação são a fonte
 * de verdade; estes schemas apenas documentam a forma observável.
 */
export const contoContigoSchemas = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'request_id'],
        properties: {
          code: { type: 'string', example: 'validation_failed' },
          message: { type: 'string' },
          fields: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          request_id: { type: 'string' },
        },
      },
    },
  },

  EventTemplate: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      preview_image_url: { type: 'string', nullable: true },
      supported_fields: { type: 'array', items: { type: 'string' } },
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['light', 'dark'] },
            palette: { type: 'string' },
          },
        },
      },
      is_active: { type: 'boolean' },
    },
  },

  EventLocation: {
    oneOf: [
      {
        type: 'object',
        required: ['type', 'name'],
        properties: {
          type: { type: 'string', enum: ['venue'] },
          name: { type: 'string' },
          address: { type: 'string', nullable: true },
        },
      },
      {
        type: 'object',
        required: ['type', 'online_url'],
        properties: {
          type: { type: 'string', enum: ['online'] },
          online_url: { type: 'string', format: 'uri' },
        },
      },
    ],
  },

  EventContribution: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      bank_name: { type: 'string', nullable: true },
      account_holder: { type: 'string', nullable: true },
      account_reference: { type: 'string', nullable: true },
    },
  },

  EventCategory: {
    type: 'string',
    enum: ['wedding', 'birthday', 'corporate', 'baby', 'other'],
  },

  Event: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      host_name: { type: 'string' },
      host_email: { type: 'string', format: 'email' },
      category: {
        allOf: [{ $ref: '#/components/schemas/EventCategory' }],
        nullable: true,
      },
      starts_at: { type: 'string', format: 'date-time', nullable: true },
      ends_at: { type: 'string', format: 'date-time', nullable: true },
      timezone: { type: 'string', example: 'Africa/Luanda' },
      location: { $ref: '#/components/schemas/EventLocation' },
      message: { type: 'string', nullable: true },
      rules: { type: 'string', nullable: true },
      dress_code: { type: 'string', nullable: true },
      template_id: { type: 'string', format: 'uuid', nullable: true },
      cover_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description:
          'Imagem de capa carregada ou indicada por URL. `null` usa a arte do template.',
      },
      theme: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['light', 'dark'] },
          palette: { type: 'string' },
        },
      },
      contribution: { $ref: '#/components/schemas/EventContribution' },
      rsvp_deadline: { type: 'string', format: 'date-time', nullable: true },
      status: {
        type: 'string',
        enum: ['draft', 'scheduled', 'cancelled', 'completed'],
      },
      access_role: {
        type: 'string',
        enum: ['host', 'manager', 'communityMember'],
        description:
          'Papel de quem consulta o evento. `communityMember` permite adicionar convidados e exportar documentos, sem editar o evento.',
      },
      stats: {
        type: 'object',
        properties: {
          total_invitations: { type: 'integer' },
          accepted: { type: 'integer' },
          declined: { type: 'integer' },
          pending: { type: 'integer' },
        },
      },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  InvitationInput: {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string', nullable: true },
      table_name: { type: 'string', nullable: true },
    },
  },

  Invitation: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      guest_name: { type: 'string' },
      guest_email: { type: 'string', format: 'email' },
      guest_phone: { type: 'string', nullable: true },
      table_name: { type: 'string', nullable: true },
      guest_message: {
        type: 'string',
        nullable: true,
        maxLength: 500,
        description: 'Mensagem opcional deixada pelo convidado ao responder.',
      },
      rsvp_status: {
        type: 'string',
        enum: ['pending', 'accepted', 'declined'],
      },
      rsvp_responded_at: { type: 'string', format: 'date-time', nullable: true },
      send_status: {
        type: 'string',
        enum: ['pending', 'queued', 'sent', 'failed'],
      },
      send_count: { type: 'integer' },
      last_sent_at: { type: 'string', format: 'date-time', nullable: true },
      whatsapp_shared_at: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description:
          'Última vez que o anfitrião abriu o WhatsApp com o link individual ' +
          'deste convite. Não confirma que a mensagem foi enviada ou lida.',
      },
      whatsapp_share_count: {
        type: 'integer',
        description: 'Número de vezes que o anfitrião iniciou a partilha no WhatsApp.',
      },
      opened_at: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description:
          'Primeira vez que o convidado abriu o link do convite. É `null` ' +
          'enquanto o link nunca foi aberto. Depois de preenchido, o anfitrião ' +
          'deixa de poder alterar o email e o telefone do convidado.',
      },
      invitation_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description:
          'URL absoluto do convite individual, pronto a partilhar (por exemplo, ' +
          'no WhatsApp). Só é devolvido ao anfitrião autenticado ou à sessão de ' +
          'gestão do evento; nunca em respostas públicas. É `null` quando o ' +
          'convite foi revogado ou o token não pode ser reconstruído.',
        example: 'https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0',
      },
      invitation_url_expires_at: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description:
          'Fim da validade do link de partilha: por defeito, fim do evento ' +
          '+ 1 dia, no fuso do evento. Depois dessa data o link devolve o ' +
          'mesmo 404 genérico de um link inválido.',
      },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  PublicEvent: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      host_name: { type: 'string' },
      host_email: {
        type: 'string',
        format: 'email',
        description: 'Email do anfitrião, exposto por defeito para contacto.',
      },
      host_phone: {
        type: 'string',
        nullable: true,
        description: 'Telefone do perfil verificado; `null` quando não preenchido.',
      },
      host_avatar_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description: 'Avatar do perfil verificado; `null` quando não preenchido.',
      },
      starts_at: { type: 'string', format: 'date-time' },
      ends_at: { type: 'string', format: 'date-time', nullable: true },
      timezone: { type: 'string', example: 'Africa/Luanda' },
      location: { $ref: '#/components/schemas/EventLocation' },
      message: { type: 'string', nullable: true },
      rules: { type: 'string', nullable: true },
      dress_code: { type: 'string', nullable: true },
      cover_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description: 'Imagem de capa do evento, quando definida.',
      },
      theme: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['light', 'dark'] },
          palette: { type: 'string' },
        },
      },
      contribution: { $ref: '#/components/schemas/EventContribution' },
      rsvp_deadline: { type: 'string', format: 'date-time', nullable: true },
      status: {
        type: 'string',
        enum: ['draft', 'scheduled', 'cancelled', 'completed'],
      },
    },
  },

  PublicInvitation: {
    type: 'object',
    properties: {
      event: { $ref: '#/components/schemas/PublicEvent' },
      guest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          email_has_account: {
            type: 'boolean',
            description:
              'Indica se o email do convite já tem conta. Permite ao frontend ' +
              'sugerir entrar ou criar conta para abrir o convite em qualquer navegador.',
          },
          rsvp_status: {
            type: 'string',
            enum: ['pending', 'accepted', 'declined'],
          },
          rsvp_responded_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
          message: {
            type: 'string',
            nullable: true,
            maxLength: 500,
            description: 'Mensagem deixada pelo próprio convidado ao responder.',
          },
        },
      },
      rsvp_deadline_passed: { type: 'boolean' },
      csrf_token: { type: 'string' },
    },
  },

  CreateEvent: {
    type: 'object',
    required: ['event'],
    properties: {
      event: {
        type: 'object',
        required: ['title', 'host_name', 'host_email', 'starts_at', 'timezone', 'location'],
        properties: {
          title: { type: 'string' },
          host_name: { type: 'string' },
          host_email: { type: 'string', format: 'email' },
          category: {
            allOf: [{ $ref: '#/components/schemas/EventCategory' }],
            nullable: true,
          },
          starts_at: { type: 'string', format: 'date-time' },
          ends_at: { type: 'string', format: 'date-time', nullable: true },
          timezone: { type: 'string', example: 'Africa/Luanda' },
          location: { $ref: '#/components/schemas/EventLocation' },
          message: { type: 'string', nullable: true },
          rules: { type: 'string', nullable: true },
          dress_code: { type: 'string', nullable: true },
          template_id: { type: 'string', format: 'uuid', nullable: true },
          theme: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['light', 'dark'] },
              palette: { type: 'string' },
            },
          },
          contribution: { $ref: '#/components/schemas/EventContribution' },
          rsvp_deadline: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      guests: {
        type: 'array',
        items: { $ref: '#/components/schemas/InvitationInput' },
      },
    },
  },

  UpdateEvent: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      host_name: { type: 'string' },
      host_email: { type: 'string', format: 'email' },
      category: {
        allOf: [{ $ref: '#/components/schemas/EventCategory' }],
        nullable: true,
      },
      starts_at: { type: 'string', format: 'date-time' },
      ends_at: { type: 'string', format: 'date-time', nullable: true },
      timezone: { type: 'string' },
      location: { $ref: '#/components/schemas/EventLocation' },
      message: { type: 'string', nullable: true },
      rules: { type: 'string', nullable: true },
      dress_code: { type: 'string', nullable: true },
      template_id: { type: 'string', format: 'uuid', nullable: true },
      theme: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['light', 'dark'] },
          palette: { type: 'string' },
        },
      },
      contribution: { $ref: '#/components/schemas/EventContribution' },
      rsvp_deadline: { type: 'string', format: 'date-time', nullable: true },
      status: {
        type: 'string',
        enum: ['draft', 'scheduled', 'cancelled', 'completed'],
      },
    },
  },

  HostProfile: {
    type: 'object',
    properties: {
      display_name: { type: 'string', nullable: true },
      phone: { type: 'string', nullable: true },
      birth_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'Data de calendário (YYYY-MM-DD), opcional.',
      },
      locale: { type: 'string', example: 'pt-AO' },
      timezone: { type: 'string', example: 'Africa/Luanda' },
      avatar_url: { type: 'string', format: 'uri', nullable: true },
      cover_url: { type: 'string', format: 'uri', nullable: true },
    },
  },

  Host: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      email_verified: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'suspended', 'deleted'] },
      profile: { $ref: '#/components/schemas/HostProfile' },
      profile_complete: { type: 'boolean' },
      missing_fields: {
        type: 'array',
        items: { type: 'string' },
        example: ['birth_date'],
      },
      created_at: { type: 'string', format: 'date-time' },
    },
  },

  UpdateProfile: {
    type: 'object',
    properties: {
      display_name: { type: 'string', nullable: true },
      phone: { type: 'string', nullable: true },
      birth_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'Data passada, idade mínima de 18 anos.',
      },
      locale: { type: 'string' },
      timezone: { type: 'string' },
      avatar_url: { type: 'string', format: 'uri', nullable: true },
      cover_url: { type: 'string', format: 'uri', nullable: true },
    },
  },

  PaginationMeta: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1 },
      page_size: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
      total_pages: { type: 'integer', minimum: 0 },
    },
  },

  HostGuest: {
    allOf: [
      { $ref: '#/components/schemas/Invitation' },
      {
        type: 'object',
        properties: {
          event: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              starts_at: { type: 'string', format: 'date-time', nullable: true },
              status: {
                type: 'string',
                enum: ['draft', 'scheduled', 'cancelled', 'completed'],
              },
            },
          },
        },
      },
    ],
  },

  GuestEventSummary: {
    type: 'object',
    description:
      'Resumo público do evento visto pela conta convidada. Não inclui ' +
      'email do anfitrião, contribuições/banca, notas privadas nem ' +
      'estatísticas de RSVP de terceiros.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string', example: 'Casamento da Ana e do João' },
      host_name: { type: 'string', example: 'Ana Silva' },
      starts_at: { type: 'string', format: 'date-time', nullable: true },
      timezone: { type: 'string', example: 'Africa/Luanda' },
      status: {
        type: 'string',
        enum: ['draft', 'scheduled', 'cancelled', 'completed'],
      },
      category: {
        type: 'string',
        nullable: true,
        enum: ['wedding', 'birthday', 'corporate', 'baby', 'other'],
      },
      template_id: { type: 'string', nullable: true, example: 'aurora' },
      cover_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description: 'Imagem de capa do evento, quando definida.',
      },
      location: { $ref: '#/components/schemas/EventLocation' },
    },
  },

  GuestInvitation: {
    type: 'object',
    description:
      'Convite dirigido ao email da conta autenticada ("Meus convites"). ' +
      'Inclui apenas os dados do próprio convite e o resumo público do ' +
      'evento. Convites revogados não são listados.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      rsvp_status: {
        type: 'string',
        enum: ['pending', 'accepted', 'declined'],
      },
      rsvp_responded_at: { type: 'string', format: 'date-time', nullable: true },
      table_name: { type: 'string', nullable: true, example: 'Mesa 3' },
      invitation_url: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description:
          'URL absoluto do próprio convite. O convidado pode abri-lo. ' +
          'É `null` quando o token não pode ser reconstruído.',
        example: 'https://apupu-front.vercel.app/convite/3f9c2a7e5b1d4c8fa6e0',
      },
      invitation_url_expires_at: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description:
          'Fim da validade do próprio link: por defeito, fim do evento ' +
          '+ 1 dia. Convites expirados devolvem o mesmo 404 genérico ' +
          'de um link inválido.',
      },
      created_at: { type: 'string', format: 'date-time' },
      event: { $ref: '#/components/schemas/GuestEventSummary' },
    },
  },

  Activity: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', example: 'rsvp_accepted' },
      guest_name: { type: 'string', nullable: true },
      at: { type: 'string', format: 'date-time' },
    },
  },

  Task: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid', nullable: true },
      event_title: { type: 'string', nullable: true },
      team_id: { type: 'string', format: 'uuid', nullable: true },
      team_name: { type: 'string', nullable: true },
      assignee_member_id: { type: 'string', format: 'uuid', nullable: true },
      assignee_email: { type: 'string', format: 'email', nullable: true },
      assignee_display_name: { type: 'string', nullable: true },
      assignee_has_access: {
        type: 'boolean',
        nullable: true,
        description:
          '`false` quando o responsável perdeu o acesso ao evento. O ' +
          'frontend mostra "Responsável sem acesso" e só o anfitrião ou ' +
          'um gestor pode reatribuir.',
      },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      due_date: { type: 'string', format: 'date', nullable: true },
      priority: { type: 'string', enum: ['baixa', 'normal', 'alta'] },
      status: { type: 'string', enum: ['por_fazer', 'em_curso', 'concluida'] },
      created_by_host_id: { type: 'string', format: 'uuid', nullable: true },
      completed_by_member_id: { type: 'string', format: 'uuid', nullable: true },
      completed_at: { type: 'string', format: 'date-time', nullable: true },
      archived_at: { type: 'string', format: 'date-time', nullable: true },
      label: {
        type: 'string',
        deprecated: true,
        description: 'Alias de `title`, mantido durante a transição.',
      },
      done: {
        type: 'boolean',
        deprecated: true,
        description: "Alias de `status === 'concluida'`, mantido durante a transição.",
      },
      manager_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        deprecated: true,
      },
      manager_email: {
        type: 'string',
        format: 'email',
        nullable: true,
        deprecated: true,
      },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  TeamMemberPreview: {
    type: 'object',
    description: 'Membro da pré-visualização do cartão; sem email.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      display_name: { type: 'string', nullable: true },
      avatar_url: { type: 'string', format: 'uri', nullable: true },
    },
  },

  Team: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      event_title: { type: 'string' },
      event_status: {
        type: 'string',
        enum: ['agendado', 'em_curso', 'concluido', 'cancelado', 'rascunho'],
      },
      my_role: {
        type: 'string',
        enum: ['anfitriao', 'gestor', 'membro'],
        description: 'Papel da conta autenticada na equipa.',
      },
      name: { type: 'string' },
      category: {
        type: 'string',
        enum: ['logistica', 'decoracao', 'musica', 'catering', 'rececao', 'outra'],
      },
      description: { type: 'string', nullable: true },
      member_count: { type: 'integer' },
      task_count: { type: 'integer' },
      completed_task_count: { type: 'integer' },
      open_task_count: { type: 'integer' },
      members_preview: {
        type: 'array',
        description: 'Até 4 membros, por ordem de entrada, sem emails.',
        items: { $ref: '#/components/schemas/TeamMemberPreview' },
      },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  TeamList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Team' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  TeamEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/Team' },
    },
  },

  TeamMember: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      team_id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      display_name: { type: 'string', nullable: true },
      role: { type: 'string', enum: ['gestor', 'membro'] },
      status: { type: 'string', enum: ['ativo', 'convite_pendente'] },
      origin: { type: 'string', enum: ['convidado', 'email'] },
      is_host: { type: 'boolean' },
      open_task_count: { type: 'integer' },
      has_event_access: {
        type: 'boolean',
        description:
          '`false` quando um gestor perdeu o acesso ao evento; o membro ' +
          'aparece como "Responsável sem acesso".',
      },
      joined_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },

  TeamMemberList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/TeamMember' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  TeamGuestCandidate: {
    type: 'object',
    properties: {
      invitation_id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      event_title: { type: 'string' },
      event_starts_at: { type: 'string', format: 'date-time', nullable: true },
      event_status: { type: 'string' },
      guest_name: { type: 'string' },
      guest_email: { type: 'string' },
      has_email: {
        type: 'boolean',
        description: '`false` quando o convidado não tem email.',
      },
      is_member: {
        type: 'boolean',
        description: '`true` quando o email já pertence à equipa.',
      },
      member_id: { type: 'string', format: 'uuid', nullable: true },
    },
  },

  TeamGuestList: {
    type: 'object',
    properties: {
      team_id: { type: 'string', format: 'uuid' },
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/TeamGuestCandidate' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  TeamInvitePreview: {
    type: 'object',
    properties: {
      team_name: { type: 'string' },
      invited_by: {
        type: 'string',
        description: 'Nome de quem convida (ou email do anfitrião, sem outros dados).',
        example: 'Pedro Silva',
      },
    },
    required: ['team_name', 'invited_by'],
  },

  TeamInvitePreviewEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/TeamInvitePreview' },
    },
  },

  TeamInviteAccept: {
    type: 'object',
    properties: {
      member_id: { type: 'string', format: 'uuid' },
      team_id: { type: 'string', format: 'uuid' },
      team_name: { type: 'string' },
      event_id: { type: 'string', format: 'uuid' },
      event_title: { type: 'string' },
      role: { type: 'string', enum: ['gestor', 'membro'] },
    },
  },

  TeamInviteAcceptEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/TeamInviteAccept' },
    },
  },

  TeamInviteResend: {
    type: 'object',
    properties: {
      send_count: { type: 'integer', minimum: 1 },
      last_sent_at: { type: 'string', format: 'date-time' },
      expires_at: { type: 'string', format: 'date-time' },
    },
  },

  TeamInviteResendEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/TeamInviteResend' },
    },
  },

  Notification: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid', nullable: true },
      event_title: { type: 'string', nullable: true },
      activity_id: { type: 'string', format: 'uuid', nullable: true },
      kind: {
        type: 'string',
        enum: [
          'rsvp_accepted',
          'rsvp_declined',
          'guest_added',
          'reminder_sent',
          'event_created',
          'event_upcoming',
          'rsvp_deadline',
          'task_assigned',
          'task_completed',
          'task_reassigned',
          'team_added',
          'role_changed',
        ],
      },
      title: { type: 'string' },
      body: { type: 'string', nullable: true },
      metadata: { type: 'object', additionalProperties: true },
      read: { type: 'boolean' },
      read_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },

  ActivityWithEvent: {
    allOf: [
      { $ref: '#/components/schemas/Activity' },
      {
        type: 'object',
        properties: {
          event_title: { type: 'string' },
        },
      },
    ],
  },

  DeliveryStatus: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      status: {
        type: 'string',
        enum: ['queued'],
        description: 'O convite foi enfileirado na outbox.',
      },
    },
  },

  EventCreateResult: {
    type: 'object',
    properties: {
      event: { $ref: '#/components/schemas/Event' },
      manage_email_status: { type: 'string', enum: ['queued', 'failed'] },
      deliveries: {
        type: 'array',
        items: { $ref: '#/components/schemas/DeliveryStatus' },
      },
    },
  },

  EventCreateEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/EventCreateResult' },
    },
  },

  InvitationResendEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['queued'] },
        },
      },
    },
  },

  EventList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Event' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  HostGuestList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/HostGuest' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  GuestInvitationList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/GuestInvitation' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  ActivityList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/ActivityWithEvent' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  EventActivityList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Activity' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  TaskList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Task' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
    },
  },

  NotificationList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Notification' },
      },
      pagination: { $ref: '#/components/schemas/PaginationMeta' },
      unread_count: { type: 'integer' },
    },
  },

  HostEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          host: { $ref: '#/components/schemas/Host' },
        },
      },
    },
  },

  RegistrationEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          host: { $ref: '#/components/schemas/Host' },
          csrf_token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  EventEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/Event' },
    },
  },

  InvitationEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/Invitation' },
    },
  },

  InvitationListEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Invitation' },
      },
    },
  },

  TaskEnvelope: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/Task' },
    },
  },

  LoginEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          host: { $ref: '#/components/schemas/Host' },
          csrf_token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  SessionEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          host: { $ref: '#/components/schemas/Host' },
          csrf_token: { type: 'string' },
        },
      },
    },
  },

  AcceptedEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['accepted'] },
        },
      },
    },
  },

  RegistrationCodeEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['accepted'] },
          email: { type: 'string', format: 'email' },
          expires_at: { type: 'string', format: 'date-time' },
          resend_available_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  RegistrationVerificationEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          verification_token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  DashboardEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          next_event: {
            allOf: [{ $ref: '#/components/schemas/Event' }],
            nullable: true,
          },
          upcoming: {
            type: 'array',
            items: { $ref: '#/components/schemas/Event' },
          },
          totals: {
            type: 'object',
            properties: {
              events: { type: 'integer' },
              drafts: { type: 'integer' },
              scheduled: { type: 'integer' },
              cancelled: { type: 'integer' },
              completed: { type: 'integer' },
              total_invitations: { type: 'integer' },
              accepted: { type: 'integer' },
              declined: { type: 'integer' },
              pending: { type: 'integer' },
            },
          },
        },
      },
    },
  },

  ReportEvent: {
    type: 'object',
    properties: {
      event_id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      status: {
        type: 'string',
        enum: ['draft', 'scheduled', 'cancelled', 'completed'],
      },
      total_invitations: { type: 'integer' },
      accepted: { type: 'integer' },
      declined: { type: 'integer' },
      pending: { type: 'integer' },
    },
  },

  ReportSummaryEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: { $ref: '#/components/schemas/ReportEvent' },
          },
          totals: {
            type: 'object',
            properties: {
              total_invitations: { type: 'integer' },
              accepted: { type: 'integer' },
              declined: { type: 'integer' },
              pending: { type: 'integer' },
              response_rate: { type: 'number' },
              acceptance_rate: { type: 'number' },
            },
          },
        },
      },
    },
  },

  DailyReport: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date' },
      invitations: { type: 'integer' },
      accepted: { type: 'integer' },
      declined: { type: 'integer' },
      reminders: { type: 'integer' },
    },
  },

  DailyReportEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          event_id: { type: 'string', format: 'uuid' },
          days: { type: 'integer' },
          series: {
            type: 'array',
            items: { $ref: '#/components/schemas/DailyReport' },
          },
        },
      },
    },
  },

  ManageLinkResendEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          event_id: { type: 'string', format: 'uuid' },
          manage_email_status: { type: 'string', enum: ['queued', 'failed'] },
          manage_token_expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
        },
      },
    },
  },

  HostSessionEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          event: { $ref: '#/components/schemas/Event' },
          role: { type: 'string', enum: ['host', 'manager'] },
          access_role: { type: 'string', enum: ['host', 'manager'] },
          email: { type: 'string', format: 'email' },
          email_has_account: {
            type: 'boolean',
            description: 'Indica se o email do link já tem conta registada.',
          },
          csrf_token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
          manage_email_status: {
            type: 'string',
            enum: ['queued', 'failed'],
            nullable: true,
          },
          manage_token_expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
        },
      },
    },
  },

  EventDetailEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          event: { $ref: '#/components/schemas/Event' },
          invitations: {
            type: 'array',
            items: { $ref: '#/components/schemas/Invitation' },
          },
        },
      },
    },
  },

  EventManager: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      has_account: {
        type: 'boolean',
        description:
          'Indica se já existe uma conta verificada com o mesmo email; nesse caso o evento aparece no workspace.',
      },
      last_used_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  AddEventManager: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
  },

  EventManagerList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/EventManager' },
      },
    },
  },

  HostEventManager: {
    type: 'object',
    description:
      'Gestor activo de um evento do anfitrião, com o resumo do evento ' +
      'para a página global de equipas.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      event_id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      has_account: { type: 'boolean' },
      last_used_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
      event: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          starts_at: { type: 'string', format: 'date-time', nullable: true },
          status: {
            type: 'string',
            enum: ['draft', 'scheduled', 'cancelled', 'completed'],
          },
        },
      },
    },
  },

  HostEventManagerList: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/HostEventManager' },
      },
    },
  },

  EventManagerEnvelope: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          manager: { $ref: '#/components/schemas/EventManager' },
          invite_email_status: { type: 'string', enum: ['queued', 'failed'] },
        },
      },
    },
  },

  SupportMessage: {
    type: 'object',
    description: 'Mensagem de apoio enviada pelo formulário público (Bloco 7).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      message: { type: 'string' },
      status: { type: 'string', enum: ['open', 'resolved'] },
      created_at: { type: 'string', format: 'date-time' },
      resolved_at: { type: 'string', format: 'date-time', nullable: true },
      resolved_by: { type: 'string', format: 'uuid', nullable: true },
    },
  },

  NewsletterSubscription: {
    type: 'object',
    description: 'Subscrição de novidades (Bloco 7).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      created_at: { type: 'string', format: 'date-time' },
    },
  },

  AdminUser: {
    type: 'object',
    description: 'Conta listada no painel admin (Bloco 8).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      display_name: { type: 'string', nullable: true },
      avatar_url: { type: 'string', nullable: true },
      cover_url: { type: 'string', nullable: true },
      phone: { type: 'string', nullable: true },
      birth_date: { type: 'string', nullable: true },
      locale: { type: 'string' },
      timezone: { type: 'string' },
      profile_complete: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'suspended', 'deleted'] },
      is_super_admin: { type: 'boolean' },
      email_verified_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },

  AdminUserDetail: {
    type: 'object',
    description: 'Perfil completo devolvido ao detalhe do painel admin (Bloco 8).',
    allOf: [
      { $ref: '#/components/schemas/AdminUser' },
      {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                status: { type: 'string' },
                starts_at: { type: 'string', format: 'date-time' },
                created_at: { type: 'string', format: 'date-time' },
                guest_count: { type: 'integer' },
              },
            },
          },
          teams: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                member_count: { type: 'integer' },
                event_title: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    ],
  },

  AdminWeeklyReport: {
    type: 'object',
    description: 'PDF semanal guardado para download no painel admin (Bloco 8).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      week_start: { type: 'string', format: 'date' },
      status: { type: 'string', enum: ['generating', 'ready'] },
      filename: { type: 'string' },
      size_bytes: { type: 'integer' },
      host_count: { type: 'integer' },
      generated_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
} as const;
