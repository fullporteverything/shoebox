// Turns the single-file build into an Artifact page body: the Artifact host adds
// its own <!doctype>/<html>/<head>/<body>, so only the contents are kept.
import { readFileSync, writeFileSync } from 'node:fs'

const html = readFileSync('dist-artifact/index.html', 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
const keep = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
writeFileSync('dist-artifact/shoebox.html', `${keep.trim()}\n${body.trim()}\n`)
console.log('wrote dist-artifact/shoebox.html')
