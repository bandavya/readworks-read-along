// Pure assignment resolver. All source labels are for the teacher screen only.
export const DEFAULTS = Object.freeze({
  soundOn: true, voice: 'human', readerMode: 'standard', vocabAutoShow: false,
  font: 'andika', textSize: 'M', spacing: false, contrast: false,
})
export const SUPPORTS = Object.freeze([
  { key: 'soundOn', label: 'Read aloud' }, { key: 'voice', label: 'Voice' }, { key: 'readerMode', label: 'Reader view' },
  { key: 'vocabAutoShow', label: 'Word cards while reading' },
  { key: 'font', label: 'Reading font' }, { key: 'textSize', label: 'Text size' },
  { key: 'spacing', label: 'Extra spacing' }, { key: 'contrast', label: 'High contrast' },
])
export function resolveSettings({ defaults = DEFAULTS, classSettings = {}, groupSettings = {}, studentSettings = {}, studentChoice = {}, adjustable = {}, locks = {} } = {}) {
  const values = { ...defaults }
  const source = Object.fromEntries(Object.keys(defaults).map(key => [key, 'ReadWorks default']))
  for (const [label, layer] of [['Class', classSettings], ['Group', groupSettings], ['Student', studentSettings]]) {
    for (const [key, value] of Object.entries(layer)) {
      if (!(key in values) || value == null) continue
      values[key] = value
      source[key] = label
    }
  }
  for (const [key, value] of Object.entries(studentChoice)) {
    if (!(key in values) || !adjustable[key] || value == null) continue
    values[key] = value
    source[key] = 'Student choice'
  }
  const locked = {}
  for (const [key, value] of Object.entries(locks)) {
    if (!(key in values) || value == null) continue
    values[key] = value
    source[key] = 'Accommodation lock'
    locked[key] = true
  }
  return { values, source, locked }
}
export function visibleSupports(resolved) {
  return SUPPORTS.filter(({ key }) => resolved.values[key] !== false && resolved.values[key] != null)
}
