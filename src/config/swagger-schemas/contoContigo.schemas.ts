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
      starts_at: { type: 'string', format: 'date-time' },
      ends_at: { type: 'string', format: 'date-time', nullable: true },
      timezone: { type: 'string', example: 'Africa/Luanda' },
      location: { $ref: '#/components/schemas/EventLocation' },
      message: { type: 'string', nullable: true },
      rules: { type: 'string', nullable: true },
      dress_code: { type: 'string', nullable: true },
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
          rsvp_status: {
            type: 'string',
            enum: ['pending', 'accepted', 'declined'],
          },
          rsvp_responded_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
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
      label: { type: 'string' },
      done: { type: 'boolean' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
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
          dev_code: {
            type: 'string',
            pattern: '^[0-9]{6}$',
            description:
              'Código OTP em claro. Só é devolvido fora de produção ' +
              '(desenvolvimento/teste) para conveniência do protótipo; ' +
              'em produção o código só existe no email.',
          },
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
          csrf_token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
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
} as const;
