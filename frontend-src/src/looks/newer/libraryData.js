import { assetUrl, loadIndex } from '../../api'

// Pictures and words remain in the local passage data. Nothing is copied into this look.
export async function loadLibrary(onIndex = () => {}) {
  const items = await loadIndex()
  // The index is enough to browse. Passage artwork and vocabulary can arrive later.
  onIndex(items.map(item => ({ ...item, image: null, imageAlt: '', vocab: [] })))
  return Promise.all(items.map(async (item) => {
    try {
      const response = await fetch(assetUrl(`data/${item.uuid}.json`))
      if (!response.ok) throw new Error(String(response.status))
      const passage = await response.json()
      const body = document.createElement('div')
      body.innerHTML = passage.html || ''
      const image = body.querySelector('figure img')
      return {
        ...item,
        image: image?.getAttribute('src') ? assetUrl(image.getAttribute('src')) : null,
        imageAlt: image?.getAttribute('alt') || '',
        vocab: Object.values(passage.vocab || {}).sort((a, b) => a.word.localeCompare(b.word)),
      }
    } catch {
      return { ...item, image: null, imageAlt: '', vocab: [] }
    }
  }))
}

export const isEarly = (item) => {
  const grade = String(item.grade).toLowerCase()
  return grade === 'k' || grade === '1' || grade === '2' || grade === 'first' || grade === 'second'
}
