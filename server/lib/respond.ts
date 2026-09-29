import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Field-level validation detail shown next to form inputs. */
export type FieldError = { path: string; message: string }

type ErrorBody = { error: { message: string; fields?: FieldError[] } }

export type ErrorStatus = Extract<
  ContentfulStatusCode,
  400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 451 | 500 | 501 | 502 | 503 | 504
>

/**
 * Uniform error body for every route. Clients only ever see `message` (and
 * optional per-field `fields`): no stack traces, SQL, or provider details.
 */
export function fail(
  c: Context,
  status: ErrorStatus,
  message: string,
  fields?: FieldError[],
): Response {
  return c.json<ErrorBody>({ error: { message, ...(fields ? { fields } : {}) } }, status)
}

/** Parses a JSON body, treating malformed input as an empty object. */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return {}
  }
}

/** First Zod issue rendered as a user-facing sentence. */
export function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Check the form and try again.'
}
