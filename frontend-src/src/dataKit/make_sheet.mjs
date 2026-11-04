// Puts the table from options.js into data_sheet.html, so the client's page can't drift from the code.
// Run: node make_sheet.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DATA_OPTIONS } from './options.js'

export function sheetWithOptions(html, options) {
  return html.replace(/(<script id="options" type="application\/json">)[\s\S]*?(<\/script>)/, (_, open, close) => `${open}${JSON.stringify(options)}${close}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sheet = new URL('data_sheet.html', import.meta.url)
  writeFileSync(sheet, sheetWithOptions(readFileSync(sheet, 'utf8'), DATA_OPTIONS))
}
