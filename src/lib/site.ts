/**
 * Site-wide values that the legal pages depend on.
 *
 * These come from Vite env vars at build time. They are deliberately empty
 * rather than filled with sample text: a terms page naming a fictional operator
 * is worse than one that says the detail is still pending, because it reads as
 * real. `isConfigured` lets the legal pages show that state honestly.
 */
const raw = import.meta.env as Record<string, string | undefined>

export const site = {
  name: 'Smoshed',
  contactEmail: (raw.VITE_CONTACT_EMAIL ?? '').trim(),
  operatorName: (raw.VITE_OPERATOR_NAME ?? '').trim(),
  legalEntity: (raw.VITE_LEGAL_ENTITY ?? '').trim(),
  jurisdiction: (raw.VITE_JURISDICTION ?? '').trim(),
  minimumAge: Number(raw.VITE_MINIMUM_AGE ?? 0),
  updated: (raw.VITE_LEGAL_UPDATED ?? '').trim(),
}

export type MissingLegalDetail = 'contactEmail' | 'operatorName' | 'minimumAge' | 'jurisdiction'

/** Which of these are still unknown, so the page can warn instead of lying. */
export function missingLegalDetails(): MissingLegalDetail[] {
  const missing: MissingLegalDetail[] = []
  if (!site.contactEmail) missing.push('contactEmail')
  if (!site.operatorName && !site.legalEntity) missing.push('operatorName')
  if (!Number.isFinite(site.minimumAge) || site.minimumAge <= 0) missing.push('minimumAge')
  if (!site.jurisdiction) missing.push('jurisdiction')
  return missing
}

export const DETAIL_LABEL: Record<MissingLegalDetail, string> = {
  contactEmail: 'a contact email address',
  operatorName: 'the name of the person or company running the site',
  minimumAge: 'the minimum age to hold an account',
  jurisdiction: 'the governing law or country of operation',
}

export function ageText(): string {
  return site.minimumAge > 0 ? `${site.minimumAge}` : 'the stated minimum age (not yet set)'
}

/**
 * Whether a reset link can actually be delivered on this deployment.
 *
 * The server refuses to create a token when no mail provider is configured, so
 * the page says so up front instead of asking someone to wait for a message
 * that will never arrive.
 */
export function canResetPasswords(): boolean {
  return (raw.VITE_MAIL_CONFIGURED ?? '') === 'true'
}
