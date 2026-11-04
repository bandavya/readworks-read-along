// Passage HTML is inserted with v-html, so image load/error events are
// delegated from its container rather than attached by a Vue child component.
export function watchPassageImages(root, lang) {
  const unavailable = lang === 'ES' ? 'Imagen no disponible todavía' : 'Image not available yet'

  function markMissing(img) {
    img.classList.add('is-missing')
    if (img.nextElementSibling?.classList.contains('sa-ph-box')) return
    const box = document.createElement('div')
    box.className = 'sa-ph-box'
    box.setAttribute('role', 'img')
    box.setAttribute('aria-label', img.alt || unavailable)
    const label = document.createElement('span')
    label.textContent = img.alt || unavailable
    box.appendChild(label)
    img.after(box)
  }

  function onError(event) {
    if (event.target instanceof HTMLImageElement) markMissing(event.target)
  }
  function onLoad(event) {
    const img = event.target
    if (!(img instanceof HTMLImageElement)) return
    img.classList.remove('is-missing')
    if (img.nextElementSibling?.classList.contains('sa-ph-box')) img.nextElementSibling.remove()
  }

  root.addEventListener('error', onError, true)
  root.addEventListener('load', onLoad, true)
  root.querySelectorAll('img').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) markMissing(img)
  })
  return () => {
    root.removeEventListener('error', onError, true)
    root.removeEventListener('load', onLoad, true)
  }
}
