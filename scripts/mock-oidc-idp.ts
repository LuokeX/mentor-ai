/**
 * 本地 mock OIDC IdP（仅开发/联调验证用）。
 *
 * 实现发现文档、授权码、PKCE、userinfo、JWKS 最小端点，配合
 * OIDC_ISSUER=http://127.0.0.1:3400 即可在本机走通
 * "统一身份登录"完整回调流程，无需真实身份平台测试环境。
 *
 * 用法：
 *   pnpm tsx scripts/mock-oidc-idp.ts [--port 3400] [--phone 13800000001]
 *        [--name 李老师] [--employee-no 1001] [--sub mock-subject-1]
 *        [--client-id mock-client] [--client-secret mock-secret]
 *
 * 注意：本脚本不校验 redirect_uri（任何回调都接受），只可用于本地联调，
 * 不可部署到任何共享或生产环境。
 */
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { URLSearchParams } from 'node:url'

const args = process.argv.slice(2)
const argValue = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const port = Number(argValue('port', '3400'))
const issuer = `http://127.0.0.1:${port}`
const clientId = argValue('client-id', 'mock-client')
const clientSecret = argValue('client-secret', 'mock-secret')
const userProfile = {
  sub: argValue('sub', 'mock-subject-1'),
  phone: argValue('phone', '13800000001'),
  name: argValue('name', '李老师'),
  employee_no: argValue('employee-no', '1001')
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = publicKey.export({ format: 'jwk' })
const kid = randomUUID()

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify(header))
  const body = b64url(JSON.stringify(payload))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey, 'base64url')
  return `${head}.${body}.${sig}`
}

// 授权码 → 关联信息；access token → subject
const codes = new Map<string, { clientId: string; codeChallenge?: string; subject: string }>()
const accessTokens = new Map<string, string>()

function discoveryDocument() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256']
  }
}

function handleAuthorize(url: URL): { status: number; location?: string; body?: string } {
  const redirectUri = url.searchParams.get('redirect_uri')
  const state = url.searchParams.get('state') ?? ''
  const challenge = url.searchParams.get('code_challenge') ?? undefined
  if (!redirectUri || url.searchParams.get('client_id') !== clientId) {
    return { status: 400, body: 'invalid request' }
  }
  const code = randomUUID()
  codes.set(code, { clientId, codeChallenge: challenge, subject: userProfile.sub })
  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  target.searchParams.set('state', state)
  return { status: 302, location: target.href }
}

function handleToken(body: URLSearchParams): { status: number; json: Record<string, unknown> } {
  const code = body.get('code') ?? ''
  const entry = codes.get(code)
  const bad = () => ({ status: 400, json: { error: 'invalid_grant' } })
  if (!entry || body.get('client_id') !== clientId || body.get('client_secret') !== clientSecret) return bad()
  // PKCE S256 校验；应用未带 code_verifier 时跳过
  const verifier = body.get('code_verifier')
  if (entry.codeChallenge && verifier) {
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    if (challenge !== entry.codeChallenge) return bad()
  }
  codes.delete(code)
  const accessToken = randomUUID()
  accessTokens.set(accessToken, entry.subject)
  const now = Math.floor(Date.now() / 1000)
  const idToken = signJwt({ alg: 'RS256', kid, typ: 'JWT' }, {
    iss: issuer, sub: entry.subject, aud: clientId, iat: now, exp: now + 3600
  })
  return {
    status: 200,
    json: { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, id_token: idToken }
  }
}

function handleUserInfo(authorization?: string): { status: number; json: Record<string, unknown> } {
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token || !accessTokens.has(token)) return { status: 401, json: { error: 'invalid_token' } }
  return { status: 200, json: { ...userProfile } }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
    res.end(JSON.stringify(discoveryDocument()))
    return
  }
  if (req.method === 'GET' && url.pathname === '/jwks') {
    res.end(JSON.stringify({ keys: [{ kty: publicJwk.kty, kid, use: 'sig', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }] }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/authorize') {
    const result = handleAuthorize(url)
    if (result.location) { res.statusCode = result.status; res.setHeader('location', result.location); res.end() }
    else { res.statusCode = result.status; res.end(JSON.stringify({ error: result.body })) }
    return
  }
  if (req.method === 'POST' && url.pathname === '/token') {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const result = handleToken(new URLSearchParams(raw))
      res.statusCode = result.status
      res.end(JSON.stringify(result.json))
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/userinfo') {
    const result = handleUserInfo(req.headers.authorization)
    res.statusCode = result.status
    res.end(JSON.stringify(result.json))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not_found' }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock OIDC IdP listening on ${issuer}`)
  console.log(`  client_id=${clientId}  client_secret=${clientSecret}`)
  console.log(`  userinfo: ${JSON.stringify(userProfile)}`)
  console.log(`对接应用配置示例：`)
  console.log(`  OIDC_ISSUER=${issuer}`)
  console.log(`  OIDC_CLIENT_ID=${clientId}`)
  console.log(`  OIDC_CLIENT_SECRET=${clientSecret}`)
  console.log(`  OIDC_REDIRECT_URI=http://localhost:3301/api/v1/auth/sso/callback`)
})