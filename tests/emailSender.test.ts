import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

const envKeys = [
  "EMAIL_TRANSPORT",
  "BREVO_SMTP_HOST",
  "BREVO_SMTP_PORT",
  "BREVO_SMTP_LOGIN",
  "BREVO_SMTP_KEY",
  "BREVO_FROM_NAME",
  "BREVO_FROM_EMAIL",
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

describe("emailSender", () => {
  let emailSender: (typeof import("../src/services/emailSender.service"))["emailSender"];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(process.env, {
      EMAIL_TRANSPORT: "brevo",
      BREVO_SMTP_HOST: "smtp-relay.brevo.com",
      BREVO_SMTP_PORT: "587",
      BREVO_SMTP_LOGIN: "smtp-login",
      BREVO_SMTP_KEY: "smtp-key",
      BREVO_FROM_NAME: "Conto Contigo",
      BREVO_FROM_EMAIL: "verified@example.com",
    });
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({ messageId: "brevo-message-id" });

    ({ emailSender } = await import("../src/services/emailSender.service"));
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("sends through Brevo SMTP with its SMTP key and verified sender", async () => {
    const message = {
      to: "recipient@example.test",
      subject: "Test",
      text: "Plain text",
      html: "<p>Plain text</p>",
      messageKey: "test-message",
    };

    await expect(emailSender.send(message)).resolves.toEqual({
      providerMessageId: "brevo-message-id",
    });

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: { user: "smtp-login", pass: "smtp-key" },
    });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: { name: "Conto Contigo", address: "verified@example.com" },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("propagates SMTP authentication and delivery errors to the outbox", async () => {
    mocks.sendMail.mockRejectedValueOnce(
      new Error("SMTP authentication failed"),
    );

    await expect(
      emailSender.send({
        to: "recipient@example.test",
        subject: "Test",
        text: "Plain text",
        html: "<p>Plain text</p>",
        messageKey: "test-message",
      }),
    ).rejects.toThrow("SMTP authentication failed");
  });
});
