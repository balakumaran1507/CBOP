#!/usr/bin/env node
/**
 * Generate PWA icons: 192x192 and 512x512 PNG with dark background and "CB" text.
 * Run: node scripts/generate-icons.js
 */

const sharp = require('sharp')
const path  = require('path')
const fs    = require('fs')

const outputDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(outputDir, { recursive: true })

async function makeIcon(size) {
  const fontSize = Math.round(size * 0.33)
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#232F3E"/>
  <text
    x="50%"
    y="54%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize}"
    font-weight="bold"
    fill="#FFFFFF"
    letter-spacing="-${Math.round(size * 0.02)}"
  >CB</text>
</svg>`.trim()

  const outPath = path.join(outputDir, `icon-${size}.png`)
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  console.log(`Generated: ${outPath}`)
}

async function main() {
  await makeIcon(192)
  await makeIcon(512)
  console.log('Icons generated.')
}

main().catch(err => { console.error(err); process.exit(1) })
