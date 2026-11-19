import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger';
import { catalogEntries } from '../emails/catalog';
import { formatEmailClock, formatEmailDate } from '../emails/format';
import { escapeHtml, renderEmailHtml, renderEmailText } from '../emails/render';
import { EmailTemplateCode, EmailVars } from '../emails/types';

const EVENT_START = new Date('2026-11-21T14:00:00Z');
const TIMEZONE = 'Africa/Luanda';

/**
 * A pré-visualização usa sempre autor e destinatário diferentes:
 * Pedro executa a acção e Ana recebe. Assim é possível confirmar que a
 * copy usa o nome de quem agiu e não um papel genérico.
 */
const BASE_VARS: EmailVars = {
  nome: 'Ana',
  anfitriao: 'Pedro',
  autor: 'Pedro',
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
  verificacao_codigo: {
    url: 'https://conto-contigo.example/criar-conta?email=ana%40example.com&codigo=482916',
  },
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
  equipa_convite: {
    equipa: 'Cozinha',
    expiraEm: '7 dias',
    url: 'https://conto-contigo.example/equipas/convite/exemplo',
    denunciarUrl: 'https://conto-contigo.example/equipas/convite/exemplo/denunciar',
  },
  equipa_adicionado: {
    equipa: 'Cozinha',
    url: 'https://conto-contigo.example/eventos/exemplo/equipas?equipa=cozinha',
  },
  equipa_papel_alterado: {
    equipa: 'Cozinha',
    papel: 'gestor',
    url: 'https://conto-contigo.example/eventos/exemplo/equipas?equipa=cozinha',
  },
  tarefa_atribuida: {
    equipa: 'Cozinha',
    tarefa: 'Comprar gelo',
    prazo: '20 de novembro',
    url: 'https://conto-contigo.example/eventos/exemplo/tarefas?tarefa=gelo',
  },
  tarefa_concluida: {
    equipa: 'Cozinha',
    tarefa: 'Comprar gelo',
    responsavel: 'Pedro',
    url: 'https://conto-contigo.example/eventos/exemplo/tarefas?tarefa=gelo',
  },
  tarefa_reatribuida: {
    equipa: 'Cozinha',
    tarefa: 'Comprar gelo',
    responsavel: 'Ana',
    anterior: 'Rita',
    variante: 'novo',
    url: 'https://conto-contigo.example/eventos/exemplo/tarefas?tarefa=gelo',
  },
};

interface PreviewCase {
  key: string;
  code: EmailTemplateCode;
  label: string;
  vars: EmailVars;
}

interface PreviewRow {
  key: string;
  code: EmailTemplateCode;
  label: string;
  subject: string;
  htmlBytes: number;
  htmlUnder100Kb: boolean;
  logoAbsolutePng: boolean;
  buttonVml: boolean | null;
  darkMode: boolean;
  unresolved: number;
  text: string;
}

/** Códigos cujo texto foi alterado nesta revisão. */
const ALTERED = new Set<EmailTemplateCode>([
  'equipa_convite',
  'equipa_adicionado',
  'equipa_papel_alterado',
  'tarefa_atribuida',
  'tarefa_concluida',
  'tarefa_reatribuida',
]);

/** Variantes adicionais para os templates com mais do que uma voz. */
const VARIANT_CASES: Array<{
  key: string;
  code: EmailTemplateCode;
  label: string;
  vars: Partial<EmailVars>;
}> = [
  {
    key: 'equipa_papel_alterado__promocao',
    code: 'equipa_papel_alterado',
    label: 'promoção',
    vars: { papel: 'gestor' },
  },
  {
    key: 'equipa_papel_alterado__despromocao',
    code: 'equipa_papel_alterado',
    label: 'despromoção',
    vars: { papel: 'membro' },
  },
  {
    key: 'tarefa_reatribuida__novo',
    code: 'tarefa_reatribuida',
    label: 'novo responsável',
    vars: { variante: 'novo', responsavel: 'Ana', anterior: 'Rita' },
  },
  {
    key: 'tarefa_reatribuida__anterior',
    code: 'tarefa_reatribuida',
    label: 'responsável anterior',
    vars: { variante: 'anterior', responsavel: 'Rita', anterior: undefined },
  },
  {
    key: 'tarefa_concluida__criador',
    code: 'tarefa_concluida',
    label: 'criador',
    vars: { nome: 'Ana', responsavel: 'Pedro' },
  },
  {
    key: 'tarefa_concluida__anfitriao',
    code: 'tarefa_concluida',
    label: 'anfitrião',
    vars: { nome: 'Rita', responsavel: 'Pedro' },
  },
];

const VARIANT_CODES = new Set<EmailTemplateCode>([
  'equipa_papel_alterado',
  'tarefa_reatribuida',
  'tarefa_concluida',
]);

function varsFor(code: EmailTemplateCode): EmailVars {
  return { ...BASE_VARS, ...OVERRIDES[code] };
}

function previewCases(): PreviewCase[] {
  const rows: PreviewCase[] = [];

  for (const entry of catalogEntries) {
    if (VARIANT_CODES.has(entry.code)) continue;
    rows.push({
      key: entry.code,
      code: entry.code,
      label: entry.code,
      vars: varsFor(entry.code),
    });
  }

  for (const variant of VARIANT_CASES) {
    rows.push({
      key: variant.key,
      code: variant.code,
      label: `${variant.code} — ${variant.label}`,
      vars: { ...varsFor(variant.code), ...variant.vars },
    });
  }

  return rows;
}

function countUnresolved(value: string): number {
  return value.match(/\{\{[^}]+\}\}/g)?.length ?? 0;
}

function hasAbsoluteLogo(html: string): boolean {
  return /<img\s+src="(https?:\/\/[^"]+\/email\/email-logo-white-480\.png)"/.test(html);
}

function mark(value: boolean | null): string {
  if (value === null) return '<span title="este template não tem botão">n/a</span>';
  return value ? '✓' : '✗';
}

function indexHtml(rows: PreviewRow[], baseUrl: string): string {
  const body = rows
    .map(
      (row) => `<tr>
  <td><code>${escapeHtml(row.label)}</code></td>
  <td>${escapeHtml(row.subject)}</td>
  <td>${row.htmlBytes} B ${mark(row.htmlUnder100Kb)}</td>
  <td>${mark(row.logoAbsolutePng)}</td>
  <td>${mark(row.buttonVml)}</td>
  <td>${mark(row.darkMode)}</td>
  <td>${row.unresolved} ${mark(row.unresolved === 0)}</td>
  <td><a href="./${escapeHtml(row.key)}.html">HTML</a> · <a href="./${escapeHtml(
    row.key
  )}.txt">texto</a></td>
</tr>`
    )
    .join('\n');

  const altered = rows.filter((row) => ALTERED.has(row.code));
  const textSections = altered
    .map(
      (row) => `<details>
  <summary><code>${escapeHtml(row.label)}</code> — text/plain</summary>
  <pre>${escapeHtml(row.text)}</pre>
</details>`
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
  details{background:#FFFFFF;border-radius:8px;padding:12px 16px;margin:12px 0}
  summary{cursor:pointer;font-weight:700;color:#0F3D3E}
  pre{white-space:pre-wrap;background:#F1F7F6;padding:12px;border-radius:8px;font-size:12px;line-height:18px}
</style>
</head>
<body>
<h1>Pré-visualização dos e-mails</h1>
<p>${rows.length} mensagens geradas a partir do catálogo. Autor: <strong>Pedro</strong> · destinatário: <strong>Ana</strong> (as variantes alteram apenas o destinatário ou o papel). Base dos links: <code>${escapeHtml(
    baseUrl
  )}</code>.</p>
<table>
<thead><tr><th>Template</th><th>Assunto</th><th>HTML &lt;100 KB</th><th>Logótipo PNG absoluto</th><th>Botão VML</th><th>Modo escuro</th><th>Variáveis por resolver</th><th>Ficheiros</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
<h2>Text/plain dos templates alterados</h2>
${textSections}
</body>
</html>`;
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), process.argv[2] ?? 'tmp/email-preview');
  const baseUrl =
    process.env.EMAIL_PREVIEW_BASE_URL?.trim() || 'https://conto-contigo.example';
  await mkdir(outDir, { recursive: true });

  const rows: PreviewRow[] = [];

  for (const preview of previewCases()) {
    const entry = catalogEntries.find((candidate) => candidate.code === preview.code);

    if (!entry) continue;

    const content = entry.email(preview.vars);
    const html = renderEmailHtml(content, { baseUrl });
    const text = renderEmailText(content, { baseUrl });
    const htmlBytes = Buffer.byteLength(html, 'utf8');
    const unresolved = countUnresolved(html) + countUnresolved(text);

    await writeFile(path.join(outDir, `${preview.key}.html`), html, 'utf8');
    await writeFile(path.join(outDir, `${preview.key}.txt`), text, 'utf8');

    rows.push({
      key: preview.key,
      code: preview.code,
      label: preview.label,
      subject: content.subject,
      htmlBytes,
      htmlUnder100Kb: htmlBytes < 100 * 1024,
      logoAbsolutePng: hasAbsoluteLogo(html),
      buttonVml: content.cta ? html.includes('<!--[if mso]><v:roundrect') : null,
      darkMode: html.includes('prefers-color-scheme:dark'),
      unresolved,
      text,
    });
  }

  const summary = rows.map((row) => ({
    key: row.key,
    code: row.code,
    subject: row.subject,
    htmlBytes: row.htmlBytes,
    htmlUnder100Kb: row.htmlUnder100Kb,
    logoAbsolutePng: row.logoAbsolutePng,
    buttonVml: row.buttonVml,
    darkMode: row.darkMode,
    unresolved: row.unresolved,
  }));

  await writeFile(path.join(outDir, 'catalog.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'index.html'), indexHtml(rows, baseUrl), 'utf8');

  const failures = summary.filter(
    (row) =>
      !row.htmlUnder100Kb ||
      !row.logoAbsolutePng ||
      row.buttonVml === false ||
      !row.darkMode ||
      row.unresolved !== 0
  );

  logger.info(
    { outDir, baseUrl, rows: rows.length, failures: failures.length },
    'Pré-visualização dos e-mails gerada.'
  );
  logger.info({ index: path.join(outDir, 'index.html') }, 'Abre o índice no navegador.');

  if (failures.length > 0) {
    logger.error({ failures }, 'A pré-visualização tem verificações falhadas.');
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Falha ao gerar a pré-visualização dos e-mails.');
  process.exitCode = 1;
});
