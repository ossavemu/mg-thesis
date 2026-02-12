import './style.css'
import { marked } from 'marked'

const app = document.querySelector('#app')

/**
 * Process footnotes in markdown text.
 * Syntax: [^1] for reference, [^1]: text for definition.
 * Returns HTML with clickable superscript refs and a footnotes section.
 */
function processFootnotes(html, sectionId) {
  // Collect footnote definitions: [^N]: text
  const defs = {}
  html = html.replace(/<p>\[\^(\d+)\]:\s*(.*?)<\/p>/g, (_, id, text) => {
    defs[id] = text
    return ''
  })

  // Replace inline refs [^N] with superscript links
  html = html.replace(/\[\^(\d+)\]/g, (_, id) => {
    const fnId = `${sectionId}-fn-${id}`
    const refId = `${sectionId}-fnref-${id}`
    return `<sup class="footnote-ref"><a href="#${fnId}" id="${refId}">${id}</a></sup>`
  })

  // Build footnotes section if any definitions exist
  const ids = Object.keys(defs).sort((a, b) => +a - +b)
  if (ids.length > 0) {
    html += `<aside class="footnotes"><hr><ol>`
    for (const id of ids) {
      const fnId = `${sectionId}-fn-${id}`
      const refId = `${sectionId}-fnref-${id}`
      html += `<li id="${fnId}">${defs[id]} <a href="#${refId}" class="footnote-back">↩</a></li>`
    }
    html += `</ol></aside>`
  }

  return html
}

async function loadThesis() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/thesis.json`)
  const thesis = await res.json()

  let html = ''

  // Cover page
  html += `
    <div class="cover">
      <div class="program">${thesis.program}</div>
      <div class="university">${thesis.university}</div>
      ${thesis.location ? `<div class="location">${thesis.location}</div>` : ''}
      <div class="title">${thesis.title}</div>
      <div class="subtitle">${thesis.subtitle}</div>
      <div class="type">${thesis.type}</div>
      <div class="author-label">Presentada por:</div>
      <div class="author">${thesis.author}</div>
      <div class="year">${thesis.year}</div>
    </div>
  `

  // Table of contents
  html += `<nav class="toc"><h2>Contenido</h2><ul>`
  for (const chapter of thesis.chapters) {
    html += `<li class="toc-chapter"><a href="#${chapter.id}">${chapter.title}</a></li>`
    if (chapter.sections) {
      for (const section of chapter.sections) {
        const sectionId = section.file.replace('.md', '')
        html += `<li class="toc-section"><a href="#${sectionId}">${section.title}</a></li>`
      }
    }
  }
  html += `</ul></nav>`

  // Load chapters
  for (const chapter of thesis.chapters) {
    html += `<article class="chapter" id="${chapter.id}">`
    html += `<h1 class="chapter-title">${chapter.title}</h1>`

    if (chapter.sections) {
      for (const section of chapter.sections) {
        const sectionId = section.file.replace('.md', '')
        const mdRes = await fetch(`${import.meta.env.BASE_URL}data/${chapter.id}/${section.file}`)
        const mdText = await mdRes.text()
        const sectionHtml = processFootnotes(marked(mdText), sectionId)
        html += `<section id="${sectionId}">${sectionHtml}</section>`
      }
    }

    html += `</article>`
  }

  app.innerHTML = html
}

loadThesis().catch(err => {
  app.innerHTML = `<p class="loading">Error al cargar: ${err.message}</p>`
})
