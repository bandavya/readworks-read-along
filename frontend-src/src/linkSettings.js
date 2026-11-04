// Settings carried by the mock teacher's student link. A missing query means local reader choices apply.
export function linkSettings(hash = globalThis.location?.hash || '') {
  const query = hash.split('?')[1]
  if (!query) return { fromTeacher: false, soundOn: null, voice: null, view: null, demo: false, student: null }
  const params = new URLSearchParams(query)
  const sa = params.get('sa')
  if (sa !== 'on' && sa !== 'off') return { fromTeacher: false, soundOn: null, voice: null, view: null, demo: false, student: null }
  const voice = params.get('voice')
  const view = params.get('view')
  return {
    fromTeacher: true,
    soundOn: sa === 'on',
    voice: voice && /^[\w-]+$/.test(voice) ? voice : null,
    view: view === 'kid' || view === 'passage' ? view : null,
    demo: params.get('td') === '1',
    student: params.get('td') === '1' && /^[a-z]+$/.test(params.get('student') || '') ? params.get('student') : null,
    font: ['andika', 'sans'].includes(params.get('font')) ? params.get('font') : 'andika',
    size: ['S', 'M', 'L', 'XL', 'XXL'].includes(params.get('size')) ? params.get('size') : 'M',
    spacing: params.get('space') === '1',
    contrast: params.get('contrast') === '1',
    vocabAutoShow: params.get('auto') === '1',
  }
}

// Carry a mock assignment between reader routes without changing saved browser choices.
export function readerLink(route, id, assignment, voice = assignment?.voice) {
  const base = `#/${route}/${id}`
  if (!assignment?.fromTeacher) return base
  const params = new URLSearchParams({
    sa: assignment.soundOn ? 'on' : 'off',
    view: route === 'kid' ? 'kid' : 'passage',
  })
  if (voice) params.set('voice', voice)
  if (assignment.demo) {
    params.set('td', '1')
    if (assignment.student) params.set('student', assignment.student)
    params.set('font', assignment.font)
    params.set('size', assignment.size)
    params.set('space', assignment.spacing ? '1' : '0')
    params.set('contrast', assignment.contrast ? '1' : '0')
    params.set('auto', assignment.vocabAutoShow ? '1' : '0')
  }
  return `${base}?${params}`
}

// The grown-ups panel owns its anchor and is teleported into the document.
// Update the anchor itself so Copy link and Open in new tab keep the same choices.
export function setTeacherReturnLink(root, id, assignment, voice) {
  const anchor = root.querySelector('.kv-panel-back .kv-panel-actions > a.kv-panel-btn')
  if (anchor) anchor.setAttribute('href', readerLink('p', id, assignment, voice))
  return anchor
}
