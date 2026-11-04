// Harness for the lab API setting (src/apiClient.js, the api lane). Run from prototype/app:  node tests/apiclient_harness.mjs
// No browser, no network. GUARDS: with no VITE_API_BASE the app has no API (today's behavior is untouched), a bad value
// can never become a base, a base is cleaned the same way every time, nothing is sent without a base, and review
// decisions are never dropped when split into requests. BEHAVIOR: the chunk size.
import { okGuard as G, okBehavior as B, finish } from './_kinds.mjs'

const A = await import('../src/apiClient.js')
const refused = (p) => p.then(() => false, () => true)
G(A.apiBase === null, "unset: apiBase is null, so Teacher, Feedback and Review keep today's behavior")
G(await refused(A.apiRequest('/api/feedback', { method: 'POST', body: {} })), 'unset: apiRequest refuses to send anything')
G(A.normalizeApiBase('https://api.example.test') === 'https://api.example.test', 'a plain https base is kept')
G(A.normalizeApiBase('  https://x.on.aws/// ') === 'https://x.on.aws', 'trailing slashes and spaces are dropped')
G([undefined, null, '', '  ', 'not a url', 'abc.com'].every((v) => A.normalizeApiBase(v) === null), 'empty, missing and non-URL values give no base')
G(['javascript:alert(1)', 'data:text/plain,hi', 'ftp://x.example'].every((v) => A.normalizeApiBase(v) === null), 'only http(s) can be a base')

const sizes = []
const fake = async (path, { body }) => { sizes.push(body.decisions.length); return { stored: body.decisions.length - 1, skippedOlder: 1 } }
const exported = { schema: 'sound-along-review/1', reviewer: 'x', decisions: Array.from({ length: 250 }, (_, i) => ({ key: String(i) })) }
const total = await A.sendReviews(exported, 100, fake)
G(sizes.reduce((a, b) => a + b, 0) === 250, 'splitting review decisions into requests loses none')
G(total.stored + total.skippedOlder === 250, 'the sent totals add up to what was exported')
B(sizes.join(',') === '100,100,50', 'review decisions go 100 per request')
finish()
