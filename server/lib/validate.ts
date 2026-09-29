import { z } from 'zod'
import { HttpError } from './auth.js'

export type FieldError = { path: string; message: string }

/** Flattens a ZodError into the shape the client renders inline. */
export function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '_',
    message: issue.message,
  }))
}

export async function parseBody<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, schema: T): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, 'That request could not be read.')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HttpError(422, result.error.issues[0]?.message ?? 'Check the highlighted fields.')
  }
  return result.data
}

export async function parseQuery<T extends z.ZodType>(c: { req: { query(): (k: string) => string | undefined } }, schema: T): Promise<z.output<T>> {
  const raw = c.req.query()
  const obj: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) obj[key] = value
  }
  const result = schema.safeParse(obj)
  if (!result.success) {
    throw new HttpError(422, result.error.issues[0]?.message ?? 'Check the search and try again.')
  }
  return result.data
}
