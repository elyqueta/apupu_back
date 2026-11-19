import { env } from '../config/env';
import { publicAppBaseUrl } from '../utils/links.util';
import type { EmailContent, EmailDetails } from './types';

export interface RenderOptions {
  /** Base pública do frontend; por omissão, `APP_BASE_URL`. */
  baseUrl?: string;
  /** Ano do rodapé; por omissão, o ano actual. */
  year?: number;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Escapa texto que entra no HTML ou em atributos. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function supportUrl(base: string): string {
  // O contacto de ajuda é uma decisão de produto e vem de
  // `SUPPORT_EMAIL`. O fallback para `EMAIL_FROM` existe apenas para
  // ambientes antigos de desenvolvimento que ainda não definiram a
  // variável; em produção deve ser sempre explícita.
  if (env.SUPPORT_EMAIL) {
    return `mailto:${env.SUPPORT_EMAIL}`;
  }

  const match = /<([^>]+)>/.exec(env.EMAIL_FROM);
  const candidate = match?.[1]?.trim() ?? env.EMAIL_FROM.trim();
  const address = candidate.includes('@') ? candidate : '';

  return address ? `mailto:${address}` : `${base}/definicoes`;
}

function htmlParagraph(text: string): string {
  return `<p class="t-body" style="margin:0 0 16px 0;font-size:16px;line-height:25px;color:#14201F;">${escapeHtml(
    oneLine(text)
  )}</p>`;
}

function htmlDetails(details: EmailDetails, accent: string): string {
  const metaLines: string[] = [];

  if (details.date || details.time) {
    metaLines.push([details.date, details.time].filter(Boolean).join(' · '));
  }

  if (details.location) {
    metaLines.push(details.location);
  }

  const meta = metaLines.map((line) => escapeHtml(oneLine(line))).join('<br>');

  return `
    <tr><td class="px" style="padding:0 32px 8px 32px;">
      <table role="presentation" class="box" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F7F6;border-left:4px solid ${accent};border-radius:8px;">
        <tr><td style="padding:18px 20px;font-family:'Figtree',Arial,Helvetica,sans-serif;">
          <div class="t-title" style="font-size:18px;line-height:24px;font-weight:700;color:#0F3D3E;">${escapeHtml(
            oneLine(details.name)
          )}</div>
          ${
            meta
              ? `<div class="t-muted" style="margin-top:8px;font-size:14px;line-height:22px;color:#5B6B69;">${meta}</div>`
              : ''
          }
        </td></tr>
      </table>
    </td></tr>`;
}

function htmlCode(code: string): string {
  return `
    <tr><td class="px" style="padding:0 32px 8px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F7F6;border-radius:12px;">
        <tr><td align="center" class="code-box" style="padding:24px 16px;">
          <div class="code" style="font-family:'Figtree',Arial,Helvetica,sans-serif;font-size:32px;line-height:40px;letter-spacing:8px;font-weight:800;color:#0F3D3E;">${escapeHtml(
            code
          )}</div>
        </td></tr>
      </table>
    </td></tr>`;
}

function htmlCta(cta: { label: string; url: string }): string {
  const label = escapeHtml(cta.label);
  const url = escapeHtml(cta.url);

  return `
    <tr><td class="px btn" align="left" style="padding:24px 32px 8px 32px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="20%" stroke="f" fillcolor="#E8B230"><w:anchorlock/><center style="color:#0F3D3E;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${url}" style="display:inline-block;background:#E8B230;color:#0F3D3E;font-family:'Figtree',Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;">${label}</a>
      <!--<![endif]-->
    </td></tr>
    <tr><td class="px" style="padding:20px 32px 0 32px;font-family:'Figtree',Arial,Helvetica,sans-serif;">
      <p class="t-muted" style="margin:0;font-size:13px;line-height:20px;color:#5B6B69;">Se o botão não funcionar, copia e cola esta ligação no navegador:<br><a href="${url}" style="color:#185556;word-break:break-all;">${url}</a></p>
    </td></tr>`;
}

function htmlSignature(): string {
  return `
    <tr><td class="px" style="padding:24px 32px 28px 32px;font-family:'Figtree',Arial,Helvetica,sans-serif;">
      <p class="t-muted" style="margin:0;font-size:14px;line-height:22px;color:#5B6B69;">— Equipa Conto Contigo</p>
    </td></tr>`;
}

function htmlFooter(content: EmailContent, base: string, year: number): string {
  const settings = `${base}/definicoes`;
  const help = supportUrl(base);
  const preferences = content.footer?.preferences !== false;
  const links: string[] = [];

  if (preferences) {
    links.push(
      `<a href="${escapeHtml(settings)}" style="color:#185556;">Preferências de notificação</a>`
    );
  }

  links.push(`<a href="${escapeHtml(help)}" style="color:#185556;">Ajuda</a>`);

  if (preferences) {
    links.push(
      `<a href="${escapeHtml(settings)}" style="color:#185556;">Deixar de receber</a>`
    );
  }

  for (const link of content.footer?.links ?? []) {
    links.push(
      `<a href="${escapeHtml(link.url)}" style="color:#185556;">${escapeHtml(
        oneLine(link.label)
      )}</a>`
    );
  }

  return `
    <tr><td class="px footer" style="background:#F1F7F6;padding:24px 32px;font-family:'Figtree',Arial,Helvetica,sans-serif;" bgcolor="#F1F7F6">
      <p class="t-muted" style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:#5B6B69;">Recebeste este e-mail porque ${escapeHtml(
        oneLine(content.reason)
      )}.</p>
      <p class="t-muted" style="margin:0;font-size:12px;line-height:18px;color:#5B6B69;">
        ${links.join(' &nbsp;·&nbsp; ')}<br>
        © ${year} Conto Contigo · Luanda, Angola
      </p>
    </td></tr>`;
}

const STYLE = `
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0;mso-table-rspace:0}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  body{margin:0!important;padding:0!important;width:100%!important;background:#F6F5EF}
  a{color:#0F3D3E}
  @media (max-width:620px){
    .container{width:100%!important}
    .px{padding-left:20px!important;padding-right:20px!important}
    .btn a{display:block!important}
  }
  @media (prefers-color-scheme:dark){
    body,.bg-outer{background:#0A1E1F!important}
    .card{background:#102A2B!important}
    .t-body,.t-title{color:#F1F5F4!important}
    .t-muted{color:#A9BAB8!important}
    .box,.code-box{background:#0A1E1F!important}
    .code{color:#F1F5F4!important}
    .footer{background:#0A1E1F!important}
    a{color:#8FD3C7!important}
  }
`;

/** Gera o HTML completo de um e-mail com a identidade Conto Contigo. */
export function renderEmailHtml(content: EmailContent, options: RenderOptions = {}): string {
  const base = trimBase(options.baseUrl ?? publicAppBaseUrl());
  const year = options.year ?? new Date().getFullYear();
  const accent = content.tone === 'danger' ? '#B3382C' : '#E8B230';
  const logo = `${base}/email/email-logo-white-480.png`;
  const greeting = content.greetingName
    ? `Olá, ${escapeHtml(oneLine(content.greetingName))}.`
    : 'Olá.';
  const paragraphs = content.paragraphs.map(htmlParagraph).join('\n');
  const details = content.details ? htmlDetails(content.details, accent) : '';
  const code = content.code ? htmlCode(content.code) : '';
  const cta = content.cta ? htmlCta(content.cta) : '';

  return `<!doctype html>
<html lang="pt-PT" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body style="margin:0;padding:0;background:#F6F5EF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(
    oneLine(content.preheader)
  )}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" class="bg-outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5EF;">
<tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" class="container card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">

    <tr><td class="px" style="background:#0F3D3E;padding:22px 32px;" bgcolor="#0F3D3E">
      <img src="${escapeHtml(logo)}" width="170" height="auto" alt="Conto Contigo" style="display:block;width:170px;height:auto;">
    </td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:#E8B230;" bgcolor="#E8B230">&nbsp;</td></tr>

    <tr><td class="px" style="padding:36px 32px 8px 32px;font-family:'Figtree',Arial,Helvetica,sans-serif;">
      <h1 class="t-title" style="margin:0 0 12px 0;font-size:26px;line-height:32px;font-weight:800;color:#0F3D3E;">${escapeHtml(
        oneLine(content.title)
      )}</h1>
      <p class="t-body" style="margin:0 0 16px 0;font-size:16px;line-height:25px;color:#14201F;">${greeting}</p>
      ${paragraphs}
    </td></tr>

    ${details}
    ${code}
    ${cta}
    ${htmlSignature()}
    ${htmlFooter(content, base, year)}
  </table>

</td></tr>
</table>
</body>
</html>`;
}

/** Gera a versão `text/plain` a partir do mesmo conteúdo do catálogo. */
export function renderEmailText(content: EmailContent, options: RenderOptions = {}): string {
  const base = trimBase(options.baseUrl ?? publicAppBaseUrl());
  const year = options.year ?? new Date().getFullYear();
  const settings = `${base}/definicoes`;
  const help = supportUrl(base);
  const lines: string[] = [];

  lines.push(content.greetingName ? `Olá, ${oneLine(content.greetingName)}.` : 'Olá.');
  lines.push('');

  for (const paragraph of content.paragraphs) {
    lines.push(oneLine(paragraph), '');
  }

  if (content.details) {
    lines.push(oneLine(content.details.name));

    if (content.details.date || content.details.time) {
      lines.push(
        oneLine([content.details.date, content.details.time].filter(Boolean).join(' · '))
      );
    }

    if (content.details.location) {
      lines.push(oneLine(content.details.location));
    }

    lines.push('');
  }

  if (content.code) {
    lines.push(`Código: ${content.code}`, '');
  }

  if (content.cta) {
    lines.push(`${content.cta.label}: ${content.cta.url}`, '');
  }

  lines.push('— Equipa Conto Contigo', '');
  lines.push(`Recebeste este e-mail porque ${oneLine(content.reason)}.`);

  if (content.footer?.preferences !== false) {
    lines.push(`Preferências de notificação: ${settings}`);
  }

  lines.push(`Ajuda: ${help}`);

  if (content.footer?.preferences !== false) {
    lines.push(`Deixar de receber: ${settings}`);
  }

  for (const link of content.footer?.links ?? []) {
    lines.push(`${oneLine(link.label)}: ${link.url}`);
  }

  lines.push(`© ${year} Conto Contigo · Luanda, Angola`);

  return `${lines.join('\n')}\n`;
}
