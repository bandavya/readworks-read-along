// A class link: the student says who they are, then this tab reports to the teacher. Only this file knows how a student
// is identified here (a name picked from the teacher's list). A real deployment replaces it with ReadWorks' sign-in.
import { ref } from 'vue'
import { DATA_OPTIONS } from '../options.js'
import { createReporter } from '../report.js'
import { usage } from '../../usage'
import { apiBase, apiRequest } from '../../apiClient'

const KEY = 'sa-reading-as-v1'
const assignmentInLink = () => new URLSearchParams(globalThis.location?.hash?.split('?')[1] || '').get('a')

function remembered() {
  try { return JSON.parse(globalThis.sessionStorage.getItem(KEY)) } catch { return null }
}

export const readingAs = ref(null)
export const needsPick = ref(false)

// Keeps the send alive if the tab closes straight after.
const send = (body) => fetch(`${apiBase}/api/progress`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then((response) => { if (!response.ok) throw new Error(`progress ${response.status}`) })

export function startReading(who) {
  readingAs.value = who
  needsPick.value = false
  try { globalThis.sessionStorage.setItem(KEY, JSON.stringify(who)) } catch { /* lasts until the page closes */ }
  const reporter = createReporter({ options: DATA_OPTIONS, assignmentId: who.assignmentId, passageId: who.passageId, studentKey: who.key, send })
  usage.listen(reporter.note)
}

// Someone not on the list reads with nothing sent.
export function readWithoutReporting() {
  needsPick.value = false
  usage.listen(null)
}

export function notMe() {
  try { globalThis.sessionStorage.removeItem(KEY) } catch { /* nothing to remove */ }
  readingAs.value = null
  usage.listen(null)
  needsPick.value = true
}

export const assignmentId = assignmentInLink
export const loadRoster = () => apiRequest(`/api/assignments/${encodeURIComponent(assignmentInLink())}`)

export function checkLink() {
  if (!apiBase) return
  const inLink = assignmentInLink()
  const who = remembered()
  if (who && (!inLink || who.assignmentId === inLink)) startReading(who)
  else if (inLink) needsPick.value = true
}
if (globalThis.location) checkLink()
