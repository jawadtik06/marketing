const nodemailer = require('nodemailer');
const port = Number(process.env.SMTP_PORT || 587);
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  : null;

module.exports = async function send(to, subject, html) {
  if (!transport) {
    console.log(`\n[email not configured] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}\n`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
};
