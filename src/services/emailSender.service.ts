import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import type { MailMessage, SendResult } from "./email.service";

interface BrevoSmtpConfig {
  host: string;
  port: number;
  login: string;
  key: string;
  fromName: string;
  fromEmail: string;
}

function getBrevoSmtpConfig(): BrevoSmtpConfig | null {
  if (env.EMAIL_TRANSPORT !== "brevo") return null;

  if (!env.BREVO_SMTP_LOGIN || !env.BREVO_SMTP_KEY || !env.BREVO_FROM_EMAIL) {
    throw new Error("Configuração Brevo SMTP incompleta.");
  }

  return {
    host: env.BREVO_SMTP_HOST,
    port: env.BREVO_SMTP_PORT,
    login: env.BREVO_SMTP_LOGIN,
    key: env.BREVO_SMTP_KEY,
    fromName: env.BREVO_FROM_NAME,
    fromEmail: env.BREVO_FROM_EMAIL,
  };
}

const config = getBrevoSmtpConfig();

const transport: Transporter | null = config
  ? nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.login,
        pass: config.key,
      },
    })
  : null;

export const emailSender = {
  async send(message: MailMessage): Promise<SendResult> {
    if (!config || !transport) {
      throw new Error("emailSender requer EMAIL_TRANSPORT=brevo.");
    }

    const info = await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return {
      providerMessageId:
        typeof info.messageId === "string" ? info.messageId : null,
    };
  },
};
