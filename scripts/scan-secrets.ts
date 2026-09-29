/**
 * Scans the tracked source for anything that looks like a committed secret.
 *
 * This is a pre-commit style guard, not a perfect detector. It looks for the
 * shapes real mistakes take: a provider key prefix next to a value, a private
 * key header, a connection string with inline credentials, or a bare assignment
 * to a name that implies a secret. The point is to catch the accident quickly,
 * not to be a substitute for a real scanner.
 *
 * Nothing it finds is printed in full. Only the file, the line and a redacted
 * hint, so running it can never spill the value it was written to protect.
 *
 * Placeholders are allowed: a value that is empty, or that says so in words, is
 * what a template is supposed to contain.
 *
 * Run with `npm run secrets:scan`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const root = process.cwd()

/** Directories that hold dependencies or build output rather than our own code. */
const skipDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  '.vercel',
  'coverage',
  '.next',
  'build',
])

/** Extensions worth reading. Binary and media files are skipped. */
const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
  '.sql',
  '.md',
  '.txt',
])

/** Files whose whole purpose is to hold a pattern, not a real value. */
const skipFiles = new Set(['scripts/scan-secrets.ts', '.env.example'])

type Rule = { name: string; pattern: RegExp }

/** A value is treated as a placeholder when it is empty or self-describing. */
const PLACEHOLDER =
  /^(?:|x{3,}|y{3,}|z{3,}|todo|tbd|changeme|placeholder|example|your[-_a-z0-9]*|none|null|undefined|secret|password|test|dummy|<[^>]*>|\$\{[^}]*\}|\.{3,})$/i

const rules: Rule[] = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'provider API key', pattern: /\b(?:gsk_|nvapi-|sk-or-v1-|sk_live_|pk_live_|hf_|AKIA)[A-Za-z0-9_-]{16,}/ },
  { name: 'Neon connection string with a password', pattern: /postgres(?:ql)?:\/\/[^:@\s"']+:[^@\s"']+@/ },
  { name: 'bearer token', pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: 'private assignment', pattern: /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY)[A-Za-z0-9_]*\s*[:=]\s*["']([^"']{6,})["']/i },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (extensions.has(extname(entry).toLowerCase())) {
      yield full
    }
  }
}

const findings: string[] = []
let scanned = 0

for (const file of walk(root)) {
  const rel = relative(root, file)
  if (skipFiles.has(rel)) continue

  const text = readFileSync(file, 'utf8')
  scanned++

  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of rules) {
      const match = rule.pattern.exec(line)
      if (!match) continue

      // For the private-assignment rule, judge the captured value. The others
      // match on the shape of the secret itself.
      const value = match[1] ?? match[0]
      if (PLACEHOLDER.test(value.trim())) continue

      // Prose is not a key. Test suites legitimately assign sentences like
      // "definitely not the password" to prove a rejection path, and a value
      // containing spaces is not the shape any real credential takes. Without
      // this the check would fail on its own fixtures and stop being a gate.
      if (rule.name === 'private assignment' && /\s/.test(value.trim())) continue

      const hint = value.length > 6 ? `${value.slice(0, 3)}…${value.slice(-2)}` : '…'
      findings.push(`${rel}:${index + 1}  ${rule.name}  (${hint}, ${value.length} chars)`)
    }
  })
}

console.warn(`Scanned ${scanned} files for secret-shaped strings.\n`)

if (findings.length === 0) {
  console.warn('Nothing found.')
  process.exit(0)
}

console.warn(`${findings.length} possible secret(s):\n`)
for (const finding of findings) console.warn(`  ${finding}`)
console.warn('\nValues are redacted. Confirm each one is a placeholder, and if not,')
console.warn('rotate it: a committed secret must be treated as exposed.')
process.exit(1)
