import { reactive, ref } from 'vue'
import { DEFAULTS, resolveSettings } from './resolve.js'
import { ASSIGNMENT, GROUPS, STUDENTS } from './classData.js'

// Demo session state survives hash navigation; nothing is saved as a real assignment.
export const teacherTab = ref('assignment')
export const liveClassSettings = reactive({ ...ASSIGNMENT.classSettings })
export const studentChoices = reactive({})
export function setStudentChoice(studentId, key, value) {
  if (!ASSIGNMENT.adjustable[key] || !STUDENTS.some(s => s.id === studentId)) return false
  studentChoices[studentId] = { ...(studentChoices[studentId] || {}), [key]: value }
  return true
}
if (typeof window !== 'undefined') window.addEventListener('teacherDemo:choice', event => {
  const { studentId, key, value } = event.detail || {}
  setStudentChoice(studentId, key, value)
})
export function sessionFor(student, classSettings = liveClassSettings) {
  return resolveSettings({
    defaults: DEFAULTS, classSettings,
    groupSettings: GROUPS[student.groupId].settings,
    studentSettings: student.settings,
    studentChoice: { ...student.choice, ...studentChoices[student.id] },
    adjustable: ASSIGNMENT.adjustable, locks: student.locks,
  })
}
export function readerHref(student, resolved = sessionFor(student)) {
  const v = resolved.values
  const params = new URLSearchParams({
    sa: v.soundOn ? 'on' : 'off', voice: v.voice, student: student.id,
    view: v.readerMode === 'kid' ? 'kid' : 'passage', td: '1',
    font: v.font, size: v.textSize, space: v.spacing ? '1' : '0',
    contrast: v.contrast ? '1' : '0', auto: v.vocabAutoShow ? '1' : '0',
  })
  return `#/${v.readerMode === 'kid' ? 'kid' : 'p'}/${ASSIGNMENT.passageId}?${params}`
}
