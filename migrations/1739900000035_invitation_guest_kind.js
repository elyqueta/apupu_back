/**
 * Bloco 15, Passo 3: género/tipo de convidado.
 *
 * Adiciona guest_kind (male|female|couple|family), nome do acompanhante
 * (casal) e tamanho do grupo (família). Campos opcionais/reversíveis;
 * convidados existentes ficam com guest_kind NULL (tratamento neutro).
 */
exports.up = (pgm) => {
  pgm.addColumns('invitations', {
    guest_kind: { type: 'text' },
    guest_companion_name: { type: 'text' },
    guest_party_size: { type: 'integer' },
  });
  pgm.addConstraint('invitations', 'invitations_guest_kind_check', {
    check: "guest_kind IS NULL OR guest_kind IN ('male', 'female', 'couple', 'family')",
  });
  pgm.addConstraint('invitations', 'invitations_guest_party_size_check', {
    check: 'guest_party_size IS NULL OR guest_party_size > 0',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('invitations', 'invitations_guest_party_size_check');
  pgm.dropConstraint('invitations', 'invitations_guest_kind_check');
  pgm.dropColumns('invitations', ['guest_kind', 'guest_companion_name', 'guest_party_size']);
};
