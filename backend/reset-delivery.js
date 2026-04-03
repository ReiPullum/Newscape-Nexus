const nodemailer = require('nodemailer');

function createResetDelivery({ config, logger }) {
  if (!config.smtp.host) {
    return {
      async sendPasswordReset({ user, resetToken }) {
        const resetLink = `${config.passwordResetBaseUrl}?token=${encodeURIComponent(resetToken)}`;
        logger.info('password reset delivery logged', {
          username: user.username,
          email: user.email,
          resetLink,
          mode: 'log',
        });
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  return {
    async sendPasswordReset({ user, resetToken }) {
      const resetLink = `${config.passwordResetBaseUrl}?token=${encodeURIComponent(resetToken)}`;
      await transporter.sendMail({
        from: config.smtp.from,
        to: user.email,
        subject: 'Newscape Nexus password reset',
        text: `Hello ${user.username},\n\nReset your password using this link: ${resetLink}\n\nIf you did not request this, ignore this email.`,
        html: `<p>Hello ${user.username},</p><p>Reset your password using this link:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, ignore this email.</p>`,
      });

      logger.info('password reset email sent', {
        username: user.username,
        email: user.email,
        mode: 'smtp',
      });
    },
  };
}

module.exports = { createResetDelivery };