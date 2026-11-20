/**
 * Mensagem opcional que o convidado pode deixar ao responder ao convite.
 *
 * O texto é guardado como texto simples (sem HTML) e limitado a 500
 * caracteres. A validação da API usa o mesmo limite; a constraint na base
 * de dados impede registos maiores escritos por outros caminhos.
 *
 * A migração é reversível: `down` remove a constraint e a coluna.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      ADD COLUMN IF NOT EXISTS guest_message text;

    ALTER TABLE invitations
      DROP CONSTRAINT IF EXISTS invitations_guest_message_length_check;
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_guest_message_length_check
        CHECK (guest_message IS NULL OR length(guest_message) <= 500);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE invitations
      DROP CONSTRAINT IF EXISTS invitations_guest_message_length_check;

    ALTER TABLE invitations
      DROP COLUMN IF EXISTS guest_message;
  `);
};
