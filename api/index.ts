/**
 * The one and only serverless function.
 *
 * Vercel treats every file under `api/` as a separate function and the Hobby
 * plan allows at most 12, so the application itself lives in `server/` and this
 * file only re-exports it.
 *
 * The `api/(.*)` rewrite in `vercel.json` sends every API request to this exact
 * path, which is what makes the Hono router see `/api/...` rather than
 * `/api/index/...`.
 */
import app from '../server/app.js'

export default app
