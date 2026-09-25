import nodemailer from 'nodemailer';

export function reportSmtpConfigured() {
  return Boolean(process.env.REPORT_SMTP_HOST && process.env.REPORT_SMTP_FROM);
}

export async function sendReportEmail(input: { recipient: string; clientName: string; from: string; to: string; pdf: Buffer }) {
  const host = process.env.REPORT_SMTP_HOST;
  const fromAddress = process.env.REPORT_SMTP_FROM;
  const port = Number(process.env.REPORT_SMTP_PORT || 587);
  if (!host || !fromAddress || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP no está configurado');
  const user = process.env.REPORT_SMTP_USER;
  const pass = process.env.REPORT_SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw new Error('Configura usuario y contraseña SMTP juntos');
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({
      from: fromAddress, to: input.recipient,
      subject: `Informe Infidash · ${input.clientName} · ${input.from}–${input.to}`,
      text: `Adjuntamos el informe guardado de ${input.clientName} para el periodo ${input.from} a ${input.to}.`,
      attachments: [{ filename: `infidash-${input.from}-${input.to}.pdf`, content: input.pdf, contentType: 'application/pdf' }],
    });
  } finally { transport.close(); }
}
