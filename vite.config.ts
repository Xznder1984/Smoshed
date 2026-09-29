import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Serves the API from inside the Vite dev server.
 *
 * The alternative was a second process on another port plus a proxy, which
 * means two terminals, two watchers, and a window where one is up and the other
 * is not. Handling `/api` here instead keeps `npm run dev` a single command and,
 * more usefully, runs requests through the exact `server/app.ts` that the
 * serverless function serves, so a route cannot work in development and fail in
 * production for reasons that only exist in the dev wiring.
 *
 * The proxy this replaces pointed at a port nothing listened on, so every API
 * call in development was failing.
 */
function apiDevServer(): Plugin {
  return {
    name: 'smoshed-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api')) return next()

        try {
          const { loadLocalEnv } = await import('./scripts/load-env.js')
          loadLocalEnv()
          const { default: app } = await import('./server/app.js')

          const request = await toWebRequest(req)
          const response = await app.fetch(request)
          await writeWebResponse(res, response)
        } catch (error) {
          // A crash here is a development-time problem, so the reason is shown
          // rather than swallowed into a bare 500.
          const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
          server.config.logger.error(`[api] ${message}`)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
          }
          res.end(JSON.stringify({ error: { message: 'Development API failure.' } }))
        }
      })
    },
  }
}

/** Node request to Web request, which is what Hono's `fetch` expects. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost:5173'}`)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else headers.set(name, value)
  }

  const method = req.method ?? 'GET'
  // GET and HEAD must not carry a body, and a Request with one throws.
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await readBody(req) : undefined

  return new Request(url, {
    method,
    headers,
    body: body && body.length > 0 ? body : undefined,
    // Required by Node when streaming a body, harmless otherwise.
    ...(body && body.length > 0 ? { duplex: 'half' } : {}),
  } as RequestInit)
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Web response back out to the Node response, including repeated cookies. */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, name) => {
    // getSetCookie keeps every Set-Cookie, which a plain get would join.
    if (name.toLowerCase() === 'set-cookie') return
    res.setHeader(name, value)
  })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies)

  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep the client bundle free of server-only code and secrets.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
  },
})
