import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

// Fresh certificates per run: never persist a private key in the repository.
const directory = mkdtempSync(join(tmpdir(), 'funnelmetry-tls-test-'))
const openssl = process.env.TEST_OPENSSL || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl')
try {
  for (const name of ['trusted', 'untrusted']) {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=connector-test', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', join(directory, `${name}.key`), '-out', join(directory, `${name}.crt`)], { stdio: 'ignore' })
  }
  const result = spawnSync(process.execPath, ['--test', 'test/https-conformance.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, TEST_TLS_DIRECTORY: directory, NODE_EXTRA_CA_CERTS: join(directory, 'trusted.crt') },
    stdio: 'inherit', timeout: 90000,
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
