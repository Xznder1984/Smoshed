/**
 * Scans the built bundle for anything that should never have been bundled.
 *
 * The source scanner runs before a commit, but a secret can reach the output
 * another way: a value inlined by a build plugin, a `VITE_` prefixed variable
 * that the bundler inlined, or a stray file copied into `public/`. This reads
 * what actually ships in `dist/` rather than what was written on disk.
 *
 * `VITE_` variables are the trap this exists for. Anything named `VITE_` is
 * inlined into the client bundle in plain text, so the naming convention is
 * checked here as well: a `VITE_` name that looks like a credential is a
 * finding, because the value is already public whether the key rotates or not.
 *
 * Run with `npm run secrets:bundle`, which builds first.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname, resolve } from 'node:path'

const root = process.cwd()
const dist = resolve(root, 'dist')

if (!existsSync(dist)) {
  console.warn('dist/ does not exist. Run `npm run build` first.')
  process.exit(1)
}

const extensions = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.svg', '.txt', '.xml'])

/** Variable names that must never be inlined into a client bundle. */
const FORBIDDEN_ENV_NAMES = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'RESEND_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'OLLAMA_API_KEY',
  'MAIL_FROM',
  'OWNER_EMAIL',
]

const rules: { name: string; pattern: RegExp }[] = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'provider API key', pattern: /\b(?:gsk_|nvapi-|sk-or-v1-|sk_live_|pk_live_|hf_|AKIA)[A-Za-z0-9_-]{16,}/ },
  { name: 'connection string with a password', pattern: /postgres(?:ql)?:\/\/[^:@\s"']+:[^@\s"']+@/ },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (extensions.has(extname(entry).toLowerCase())) yield full
  }
}

const findings: string[] = []
let scanned = 0

for (const file of walk(dist)) {
  const rel = relative(dist, file)
  const text = readFileSync(file, 'utf8')
  scanned++

  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of rules) {
      const match = rule.pattern.exec(line)
      if (!match) continue
      const value = match[0]
      findings.push(
        `${rel}:${index + 1}  ${rule.name}  (${value.slice(0, 3)}…${value.slice(-2)}, ${value.length} chars)`,
      )
    }

    // A credential-named variable in a client bundle is already public. The
    // match is on the name alone, so this catches the value regardless of how
    // the bundler encoded it.
    for (const name of FORBIDDEN_ENV_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(line)) {
        findings.push(`${rel}:${index + 1}  server-only name in client bundle: ${name}`)
      }
    }
  })
}

console.warn(`Scanned ${scanned} files in dist/.\n`)

if (findings.length === 0) {
  console.warn('Nothing found.')
  process.exit(0)
}

console.warn(`${findings.length} finding(s):\n`)
for (const finding of findings) console.warn(`  ${finding}`)
console.warn('\nValues are redacted. A client bundle is public: treat anything found')
console.warn('here as exposed and rotate it.')
process.exit(1)
