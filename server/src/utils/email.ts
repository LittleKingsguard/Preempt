import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendPasswordResetEmail = async (to: string, username: string, token: string) => {
  const resetLink = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/reset-password?token=${token}&username=${encodeURIComponent(username)}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Password Reset Request',
    html: `<p>You requested a password reset. Click the link below to reset your password:</p>
           <p><a href="${resetLink}">Reset Password</a></p>
           <p>This link will expire in 30 minutes.</p>`,
  });
};

export const send2FAEmail = async (to: string, code: string) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Your 2FA Login Code',
    html: `<p>Your two-factor authentication code is:</p>
           <h2>${code}</h2>
           <p>This code will expire in 15 minutes.</p>`,
  });
};

export const sendVerificationEmail = async (to: string, code: string) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Verify Your Email Address',
    html: `<p>Welcome to Preempt! Your email verification code is:</p>
           <h2>${code}</h2>
           <p>Please enter this code on the verification page. It will expire in 60 minutes.</p>`,
  });
};
