export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
}

export interface SendEmailResult {
  messageId: string;
  provider: 'resend' | 'smtp';
}

export interface EmailTransportConfig {
  provider: 'resend' | 'smtp';
  from: string;
  replyTo?: string;
  resendApiKey?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
}
