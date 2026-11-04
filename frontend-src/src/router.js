// Tiny hash router: "#/" -> library, "#/listen" -> blind listening, "#/teacher" -> assign screen, "#/look/<name>/..." and "#/looks" -> experimental looks, "#/p/<uuid>" -> passage, "#/kid/<uuid>" -> kid view, "#/focus/<uuid>" -> the Reading helper (calmer reader for grades 3-5), "#/review/<uuid>" -> word-help review, "#/holds" (clear the next hold), "#/holds/all" (the list) and "#/holds/<uuid>/<generated|human>" -> held narration takes (only when built with VITE_HOLDS_API).
import { ref, computed } from 'vue'
import { PUBLIC_SAMPLE } from './mode'
import { holdsBase } from './holdsApi'

if (import.meta.env?.VITE_SHOWCASE === '1' && /^(#\/?)?$/.test(window.location.hash)) window.location.hash = '#/look/mix/'
const hash = ref(window.location.hash || '#/')
window.addEventListener('hashchange', () => {
  hash.value = window.location.hash || '#/'
  window.scrollTo(0, 0)
})

export const route = computed(() => {
  if (PUBLIC_SAMPLE && hash.value === '#/try') return { name: 'try' }
  if (!PUBLIC_SAMPLE && /^#\/looks\/?$/.test(hash.value)) return { name: 'looks', look: 'sharpened', screen: 'compare', id: undefined }
  const look = PUBLIC_SAMPLE ? null : hash.value.match(/^#\/look\/([\w-]+)\/(p|kid)(?:\/([\w-]+))?\/?$/)
  if (look) return { name: 'look', look: look[1], screen: look[2], id: look[3] }
  const lookHome = PUBLIC_SAMPLE ? null : hash.value.match(/^#\/look\/([\w-]+)\/?$/)
  if (lookHome) return { name: 'look', look: lookHome[1], screen: 'library', id: undefined }
  const holds = holdsBase ? hash.value.match(/^#\/holds(?:\/(all)|\/([\w-]+)\/(generated|human))?\/?$/) : null
  if (holds) return { name: 'holds', all: !!holds[1], id: holds[2], voice: holds[3] }
  if (!PUBLIC_SAMPLE && /^#\/experiments\/?$/.test(hash.value)) return { name: 'experiments' }
  const classDemo = PUBLIC_SAMPLE ? null : hash.value.match(/^#\/class-demo\/?(?:\?as=([a-z]+))?$/)
  if (classDemo) return { name: 'classDemo', person: classDemo[1] || 'teacher' }
  if (/^#\/teacher\/?(?:\?|$)/.test(hash.value)) return { name: 'library', teacher: true }
  const teacherClass = PUBLIC_SAMPLE ? null : hash.value.match(/^#\/teacher\/class\/([\w-]+)/)
  if (teacherClass) return { name: 'teacherClass', id: teacherClass[1] }
  if (/^#\/listen\/?(?:\?team)?$/.test(hash.value)) return { name: 'listen' }
  const compare = PUBLIC_SAMPLE ? null : hash.value.match(/^#\/compare\/([\w-]+)\/?$/)
  if (compare) return { name: 'compare', id: compare[1] }
  const f = hash.value.match(/^#\/focus\/([\w-]+)/)
  if (f) return { name: 'focus', id: f[1] }
  const k = hash.value.match(/^#\/kid\/([\w-]+)/)
  if (k) return { name: 'kid', id: k[1] }
  const r = hash.value.match(/^#\/review\/([\w-]+)/)
  if (r) return { name: 'review', id: r[1] }
  const m = hash.value.match(/^#\/p\/([\w-]+)/)
  return m ? { name: 'passage', id: m[1] } : { name: 'library' }
})
