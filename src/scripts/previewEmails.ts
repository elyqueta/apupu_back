import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger';
import { catalogEntries } from '../emails/catalog';
import { formatEmailClock, formatEmailDate } from '../emails/format';
import { escapeHtml, renderEmailHtml, renderEmailText } from '../emails/render';
import { EmailTemplateCode, EmailVars } from '../emails/types';

const EVENT_START = new Date('2026-11-21T14:00:00Z');
const TIMEZONE = 'Africa/Luanda';

const BASE_VARS: EmailVars = {
  nome: 'Ana',
  anfitriao: 'Pedro',
  convidado: 'Ana',
  evento: 'Aniversário do Pedro',
  data: formatEmailDate(EVENT_START, TIMEZONE),
  hora: formatEmailClock(EVENT_START, TIMEZONE),
  local: 'Salão Panorâmico · Luanda',
  codigo: '482916',
  expiraEm: '10 minutos',
  url: 'https://conto-contigo.example/convite/exemplo',
  dias: 3,
  confirmado: false,
  online: false,
  vestuario: 'Traje casual',
  contribuicao: false,
  detalhe: 'ana@example.com',
};

const OVERRIDES: Partial<Record<EmailTemplateCode, Partial<EmailVars>>> = {
  boas_vindas: { url: 'https://conto-contigo.example/criar-evento' },
  verificacao_codigo: { url: undefined },
  recuperar_senha: { url: 'https://conto-contigo.example/redefinir-senha?token=exemplo' },
  presenca_confirmada: {
    nome: 'Pedro',
    url: 'https://conto-contigo.example/gerir/exemplo',
  },
  lembrete_24h: { confirmado: true },
  lembrete_2h: { confirmado: true, online: true, local: 'Online' },
  lembrete: { dias: 7, confirmado: false },
  manage_link: { nome: 'Pedro', url: 'https://conto-contigo.example/gerir/exemplo' },
  manager_invite: { nome: undefined, url: 'https://conto-contigo.example/gerir/exemplo' },
  email_verification: { url: 'https://conto-contigo.example/verificar-email/exemplo' },
  profile_reminder: { url: 'https://conto-contigo.example/definicoes' },
  decline_notification: { nome: 'Pedro' },
};

interface PreviewRow {
  code: string;
  subject: string;
  preheader: string;
  pushTitle: string;
  pushBody: string;
  sms: string;
  htmlBytes: number;
}

function varsFor(code: EmailTemplateCode): EmailVars {
  return { ...BASE_VARS, ...OVERRIDES[code] };
}

function indexHtml(rows: PreviewRow[]): string {
  const body = rows
    .map(
      (row) => `<tr>
  <td><code>${escapeHtml(row.code)}</code></td>
  <td>${escapeHtml(row.subject)}</td>
  <td><strong>${escapeHtml(row.pushTitle)}</strong><br>${escapeHtml(row.pushBody)}</td>
  <td>${escapeHtml(row.sms)}</td>
  <td><a href="./${escapeHtml(row.code)}.html">HTML</a> · <a href="./${escapeHtml(
    row.code
  )}.txt">texto</a> · ${row.htmlBytes} B</td>
</tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pré-visualização — Conto Contigo</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:32px;background:#F6F5EF;color:#14201F}
  h1{color:#0F3D3E;margin:0 0 8px 0}
  p{color:#5B6B69;margin:0 0 24px 0}
  table{border-collapse:collapse;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden}
  th,td{text-align:left;vertical-align:top;padding:12px 14px;border-bottom:1px solid #E5E7E5;font-size:13px}
  th{background:#0F3D3E;color:#FFFFFF}
  code{color:#0F3D3E;font-weight:700}
  a{color:#185556}
</style>
</head>
<body>
<h1>Pré-visualização dos e-mails</h1>
<p>${rows.length} mensagens geradas a partir do catálogo. Abre cada ficheiro HTML no navegador.</p>
<table>
<thead><tr><th>Código</th><th>Assunto</th><th>Push</th><th>SMS</th><th>Ficheiros</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>`;
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), process.argv[2] ?? 'tmp/email-preview');
  const baseUrl = process.env.EMAIL_PREVIEW_BASE_URL?.trim() || undefined;
  await mkdir(outDir, { recursive: true });

  const rows: PreviewRow[] = [];

  for (const entry of catalogEntries) {
    const vars = varsFor(entry.code);
    const content = entry.email(vars);
    const html = renderEmailHtml(content, { baseUrl });
    const text = renderEmailText(content, { baseUrl });
    const push = entry.push(vars);

    await writeFile(path.join(outDir, `${entry.code}.html`), html, 'utf8');
    await writeFile(path.join(outDir, `${entry.code}.txt`), text, 'utf8');

    rows.push({
      code: entry.code,
      subject: content.subject,
      preheader: content.preheader,
      pushTitle: push.title,
      pushBody: push.body,
      sms: entry.sms(vars),
      htmlBytes: Buffer.byteLength(html, 'utf8'),
    });
  }

  await writeFile(path.join(outDir, 'catalog.json'), JSON.stringify(rows, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'index.html'), indexHtml(rows), 'utf8');

  logger.info({ outDir, baseUrl: baseUrl ?? 'APP_BASE_URL' }, 'Pré-visualização dos e-mails gerada.');
  logger.info({ index: path.join(outDir, 'index.html') }, 'Abre o índice no navegador.');
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Falha ao gerar a pré-visualização dos e-mails.');
  process.exitCode = 1;
});
