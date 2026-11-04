// The engine reads data-l as an index into each voice's lead timings. Keep
// this markup in the reader's text container with the passage's data-i words.
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const leadSpans = (words, offset) =>
  words.map((word, i) => `<span class="sa-w" data-l="${offset + i}">${escapeHtml(word)}</span>`).join(' ')

export function leadWordsHtml(passage) {
  if (!passage) return ''
  const title = passage.title_words || []
  const byline = passage.by_words || []
  const shownByline = passage.lang === 'ES' && byline[0]?.toLowerCase() === 'by'
    ? ['de', ...byline.slice(1)] : byline
  return `<h1 class="sa-title">${leadSpans(title, 0)}</h1>` +
    (byline.length ? `<p class="sa-byline">${leadSpans(shownByline, title.length)}</p>` : '') +
    passage.html
}
