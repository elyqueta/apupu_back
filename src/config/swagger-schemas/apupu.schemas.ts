/**
 * Componentes OpenAPI do Apupu.
 *
 * O contrato público usa snake_case. Os DTOs da aplicação são a fonte
 * de verdade; estes schemas apenas documentam a forma observável.
 */
export const apupuSchemas = {
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
} as const;
