// Any narrated word on another page moves the display to that page. Previous-word state is irrelevant.
export function pageForNarration(k, shownPage, kPage) {
  const spokenPage = kPage[k]
  return spokenPage !== undefined && spokenPage !== shownPage ? spokenPage : null
}

export function pageForAnchor(anchorK, currentPage, pageCount, kPage) {
  const anchorPage = anchorK === undefined ? undefined : kPage[anchorK]
  return Math.min(anchorPage === undefined ? currentPage : anchorPage, pageCount - 1)
}
