import { env } from './env.js'

export type MailMessage = {
  to: string
  subject: string
  text: string
}

export type MailResult = { delivered: boolean; reason?: string }

/**
 * Transactional email.
 *
 * Smoshed has no mail provider wired up, so `deliver` reports that the message
 * was not sent instead of pretending it was. Nothing is ever returned in an API
 * response and no token is written to a log, which is why the reset flow fails
 * closed: a reset link that cannot be delivered is simply never created.
 *
 * Wiring Resend, Postmark, or SES means implementing `deliver` and returning
 * `{ delivered: true }`. Nothing else in the app has to change.
 */
export async function deliver(_message: MailMessage): Promise<MailResult> {
  return { delivered: false, reason: 'no mail provider configured' }
}

/** True when a password reset link can actually reach a person. */
export function canDeliverMail(): boolean {
  return Boolean(env.resendApiKey && env.mailFrom)
}
