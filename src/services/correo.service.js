const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

const enviarCorreoBoleta = async ({ para, asunto, html }) => {
  const response = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to: para,
    subject: asunto,
    html
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response;
};

module.exports = {
  enviarCorreoBoleta
};