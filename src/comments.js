const LS_USERS = 'mgthesis_comment_users'
const LS_CURRENT = 'mgthesis_comment_current'
const LS_TOKEN_PREFIX = 'mgthesis_comment_token:'

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getApiBase() {
  const raw = (import.meta.env.VITE_COMMENTS_API_BASE || '').trim()
  return raw.replace(/\/+$/, '')
}

function loadUsers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_USERS) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveUsers(users) {
  localStorage.setItem(LS_USERS, JSON.stringify(users))
}

function getToken(username) {
  return localStorage.getItem(LS_TOKEN_PREFIX + username) || ''
}

function setToken(username, token) {
  localStorage.setItem(LS_TOKEN_PREFIX + username, token)
}

function getCurrentUser() {
  return localStorage.getItem(LS_CURRENT) || ''
}

function setCurrentUser(username) {
  localStorage.setItem(LS_CURRENT, username)
}

function normalizeUsername(raw) {
  return raw.trim().toLowerCase()
}

function usernameValid(username) {
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)
}

function currentThreadId() {
  const hash = (location.hash || '').replace(/^#/, '')
  return hash || 'global'
}

function formatTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

async function apiFetch(path, { method = 'GET', token = '', body } = {}) {
  const apiBase = getApiBase()
  if (!apiBase) {
    throw new Error('VITE_COMMENTS_API_BASE_not_set')
  }

  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['authorization'] = `Bearer ${token}`

  const res = await fetch(apiBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!res.ok) {
    const msg = data && data.error ? data.error : `http_${res.status}`
    throw new Error(msg)
  }

  return data
}

function buildModal() {
  const overlay = document.createElement('div')
  overlay.className = 'comment-modal-overlay hidden'
  overlay.innerHTML = `
    <div class="comment-modal" role="dialog" aria-modal="true" aria-label="Usuario para comentarios">
      <h3>Usuario para comentarios</h3>
      <div class="comment-modal-body">
        <label class="comment-radio">
          <input type="radio" name="commentUserMode" value="create" checked />
          <span>Crear nuevo usuario</span>
        </label>
        <input class="comment-input" name="newUsername" placeholder="usuario" autocomplete="username" />

        <label class="comment-radio">
          <input type="radio" name="commentUserMode" value="select" />
          <span>Seleccionar existente (guardado en este navegador)</span>
        </label>
        <select class="comment-select" name="existingUser"></select>

        <p class="comment-modal-hint">
          No se usan variables secretas en el frontend; el token queda guardado localmente.
        </p>
        <p class="comment-modal-error" hidden></p>
      </div>
      <div class="comment-modal-actions">
        <button class="comment-btn" data-action="cancel" type="button">Cancelar</button>
        <button class="comment-btn" data-action="save" type="button">Guardar</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  const modeEls = overlay.querySelectorAll('input[name="commentUserMode"]')
  const newUsernameEl = overlay.querySelector('input[name="newUsername"]')
  const existingSelectEl = overlay.querySelector('select[name="existingUser"]')
  const errorEl = overlay.querySelector('.comment-modal-error')

  function setMode(mode) {
    const isCreate = mode === 'create'
    newUsernameEl.disabled = !isCreate
    existingSelectEl.disabled = isCreate
    if (isCreate) {
      newUsernameEl.focus()
    } else {
      existingSelectEl.focus()
    }
  }

  modeEls.forEach(el => {
    el.addEventListener('change', () => setMode(overlay.querySelector('input[name="commentUserMode"]:checked').value))
  })

  function showError(message) {
    errorEl.hidden = !message
    if (message) errorEl.textContent = message
  }

  function refreshExistingOptions() {
    const users = loadUsers().filter(u => !!getToken(u))
    existingSelectEl.innerHTML = ''
    for (const u of users) {
      const opt = document.createElement('option')
      opt.value = u
      opt.textContent = u
      existingSelectEl.appendChild(opt)
    }

    const current = getCurrentUser()
    if (current && users.includes(current)) {
      existingSelectEl.value = current
    }

    const hasAny = users.length > 0
    const selectRadio = overlay.querySelector('input[value="select"]')
    selectRadio.disabled = !hasAny
    if (!hasAny) {
      overlay.querySelector('input[value="create"]').checked = true
      setMode('create')
    }
  }

  async function save() {
    showError('')
    const mode = overlay.querySelector('input[name="commentUserMode"]:checked').value

    if (mode === 'create') {
      const username = normalizeUsername(newUsernameEl.value)
      if (!usernameValid(username)) {
        showError('Usuario inválido (3-32, a-z0-9, _ o -).')
        return null
      }

      let data
      try {
        data = await apiFetch('/users', { method: 'POST', body: { username } })
      } catch (e) {
        showError(String(e.message || e))
        return null
      }

      setToken(username, data.token)
      const users = loadUsers()
      if (!users.includes(username)) {
        users.push(username)
        users.sort()
        saveUsers(users)
      }
      setCurrentUser(username)
      return username
    }

    // select
    const username = existingSelectEl.value
    if (!username) {
      showError('Selecciona un usuario.')
      return null
    }
    const token = getToken(username)
    if (!token) {
      showError('No hay token local para ese usuario.')
      return null
    }

    setCurrentUser(username)
    return username
  }

  function open() {
    refreshExistingOptions()
    showError('')
    overlay.classList.remove('hidden')
    setMode(overlay.querySelector('input[name="commentUserMode"]:checked').value)
  }

  function close() {
    overlay.classList.add('hidden')
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close()
  })

  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close)
  overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const result = await save()
    if (result) close()
    overlay.dispatchEvent(new CustomEvent('comment-user-changed', { detail: { username: result } }))
  })

  newUsernameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      overlay.querySelector('[data-action="save"]').click()
    }
  })

  existingSelectEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      overlay.querySelector('[data-action="save"]').click()
    }
  })

  return { overlay, open, close }
}

export function initComments() {
  const root = document.createElement('div')
  root.id = 'comments-root'
  root.className = 'comments-root'
  root.innerHTML = `
    <div class="comments-head">
      <h2>Comentarios</h2>
      <button type="button" class="comment-user-btn">Elegir usuario</button>
    </div>
    <div class="comments-sub">
      <span class="comments-thread-label"></span>
      <span class="comments-user-label"></span>
    </div>
    <div class="comments-error" hidden></div>
    <div class="comments-list" aria-live="polite"></div>
    <form class="comments-form">
      <textarea class="comments-text" rows="4" placeholder="Escribe un comentario..."></textarea>
      <div class="comments-actions">
        <button class="comment-btn" type="submit">Enviar</button>
      </div>
    </form>
  `

  const modal = buildModal()

  const userBtn = root.querySelector('.comment-user-btn')
  const threadLabel = root.querySelector('.comments-thread-label')
  const userLabel = root.querySelector('.comments-user-label')
  const errorEl = root.querySelector('.comments-error')
  const listEl = root.querySelector('.comments-list')
  const formEl = root.querySelector('.comments-form')
  const textEl = root.querySelector('.comments-text')

  let loading = false
  let activeThread = ''

  function showError(message) {
    errorEl.hidden = !message
    if (message) errorEl.textContent = message
  }

  function updateLabels() {
    const threadId = currentThreadId()
    const user = getCurrentUser()

    threadLabel.textContent = `Sección: ${threadId}`
    userLabel.textContent = user ? `Usuario: ${user}` : 'Usuario: (no seleccionado)'

    const hasUser = !!user && !!getToken(user)
    textEl.disabled = !hasUser
    formEl.querySelector('button[type="submit"]').disabled = !hasUser || loading
    userBtn.textContent = user ? 'Cambiar usuario' : 'Elegir usuario'
  }

  async function loadComments() {
    const threadId = currentThreadId()
    if (threadId === activeThread && !listEl.dataset.stale) return

    activeThread = threadId
    listEl.dataset.stale = ''
    showError('')

    updateLabels()

    try {
      loading = true
      updateLabels()
      const data = await apiFetch(`/threads/${encodeURIComponent(threadId)}/comments`)
      renderComments(data.comments || [])
    } catch (e) {
      const msg = String(e.message || e)
      if (msg === 'VITE_COMMENTS_API_BASE_not_set') {
        showError('Configura VITE_COMMENTS_API_BASE para habilitar comentarios.')
      } else {
        showError(msg)
      }
      listEl.innerHTML = ''
    } finally {
      loading = false
      updateLabels()
    }
  }

  function renderComments(comments) {
    const current = getCurrentUser()

    if (!Array.isArray(comments) || comments.length === 0) {
      listEl.innerHTML = '<p class="comments-empty">Sin comentarios.</p>'
      return
    }

    listEl.innerHTML = comments
      .map(c => {
        const canDelete = current && c.username === current
        return `
          <div class="comment-item" data-id="${escapeHtml(c.id)}">
            <div class="comment-meta">
              <span class="comment-author">${escapeHtml(c.username)}</span>
              <span class="comment-time">${escapeHtml(formatTime(c.createdAt))}</span>
              ${
                canDelete
                  ? `<button class="comment-link" data-action="delete" type="button">Borrar</button>`
                  : ''
              }
            </div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
          </div>
        `
      })
      .join('')
  }

  userBtn.addEventListener('click', () => modal.open())

  modal.overlay.addEventListener('comment-user-changed', () => {
    updateLabels()
    loadComments()
  })

  window.addEventListener('hashchange', () => {
    listEl.dataset.stale = '1'
    loadComments()
  })

  formEl.addEventListener('submit', async e => {
    e.preventDefault()
    showError('')

    const user = getCurrentUser()
    const token = user ? getToken(user) : ''
    if (!user || !token) {
      modal.open()
      return
    }

    const text = textEl.value.trim()
    if (!text) return

    try {
      loading = true
      updateLabels()
      await apiFetch(`/threads/${encodeURIComponent(currentThreadId())}/comments`, {
        method: 'POST',
        token,
        body: { text },
      })
      textEl.value = ''
      listEl.dataset.stale = '1'
      await loadComments()
    } catch (e2) {
      showError(String(e2.message || e2))
    } finally {
      loading = false
      updateLabels()
    }
  })

  listEl.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action="delete"]')
    if (!btn) return

    const item = btn.closest('.comment-item')
    const id = item?.dataset?.id
    if (!id) return

    const user = getCurrentUser()
    const token = user ? getToken(user) : ''
    if (!user || !token) {
      modal.open()
      return
    }

    try {
      loading = true
      updateLabels()
      await apiFetch(`/threads/${encodeURIComponent(currentThreadId())}/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        token,
      })
      listEl.dataset.stale = '1'
      await loadComments()
    } catch (e3) {
      showError(String(e3.message || e3))
    } finally {
      loading = false
      updateLabels()
    }
  })

  updateLabels()
  loadComments()

  return root
}
