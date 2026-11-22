(() => {
  'use strict';

  const API_BASE = 'https://cartelera-api.consorcioweb.workers.dev';
  const TOKEN_KEY = 'cartelera.token';
  const EXPIRES_KEY = 'cartelera.expires';
  const STATUS_LABELS = { vista: 'Vista', 'no-vista': 'No vista' };

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>'
  };

  const $ = (selector) => document.querySelector(selector);

  const els = {
    loginView: $('#login-view'),
    loginForm: $('#login-form'),
    loginUser: $('#login-user'),
    loginPass: $('#login-pass'),
    loginError: $('#login-error'),
    togglePass: $('#toggle-pass'),
    iconEye: $('#icon-eye'),
    iconEyeOff: $('#icon-eye-off'),
    appView: $('#app-view'),
    logoutBtn: $('#logout-btn'),
    formPanel: $('#form-panel'),
    formTitle: $('#form-title'),
    form: $('#item-form'),
    urlInput: $('#url-input'),
    descInput: $('#desc-input'),
    submitBtn: $('#submit-btn'),
    cancelEditBtn: $('#cancel-edit-btn'),
    formError: $('#form-error'),
    list: $('#items-list'),
    emptyState: $('#empty-state'),
    stats: $('#stats'),
    confirmDialog: $('#confirm-dialog'),
    confirmText: $('#confirm-text'),
    toast: $('#toast')
  };

  let items = [];
  let editingId = null;
  let pendingDeleteId = null;
  let toastTimer = 0;
  let loading = false;
  let submitting = false;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function getSessionToken() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
    if (!token || !expiresAt || expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    return token;
  }

  function saveSession(token, expiresAt) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  }

  async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (auth) {
      const token = getSessionToken();
      if (!token) {
        expireSession();
        throw new ApiError('La sesión expiró. Ingresa de nuevo.', 401);
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión.', 0);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (response.status === 401 && auth) expireSession();
      throw new ApiError(payload?.error || 'No se pudo completar la solicitud.', response.status);
    }

    return payload;
  }

  function expireSession() {
    if (els.appView.hidden) return;
    clearSession();
    items = [];
    setView(false);
    showLoginError('La sesión expiró. Ingresa de nuevo.');
  }

  function setView(authenticated) {
    els.loginView.hidden = authenticated;
    els.appView.hidden = !authenticated;

    if (authenticated) {
      els.loginError.hidden = true;
      els.loginPass.value = '';
      loadItems();
      return;
    }

    loading = false;
    clearSession();
    items = [];
    els.list.textContent = '';
    els.stats.hidden = true;
    els.emptyState.hidden = false;
    els.emptyState.textContent = 'Aún no hay URLs en la lista. Agrega la primera arriba.';
    resetForm();
    els.loginError.hidden = true;
    els.loginPass.value = '';
    els.loginUser.focus();
  }

  function showLoginError(message) {
    els.loginError.textContent = message;
    els.loginError.hidden = false;
  }

  async function loadItems() {
    loading = true;
    els.list.textContent = '';
    els.stats.hidden = true;
    els.emptyState.hidden = false;
    els.emptyState.textContent = 'Cargando URLs…';
    syncFormUi();

    try {
      const data = await apiFetch('/api/urls');
      items = Array.isArray(data?.items) ? data.items.map(normalizeItem) : [];
      loading = false;
      els.emptyState.textContent = 'Aún no hay URLs en la lista. Agrega la primera arriba.';
      syncFormUi();
      render();
    } catch (error) {
      loading = false;
      syncFormUi();
      if (error.status === 401) return;
      els.emptyState.hidden = false;
      els.emptyState.textContent = 'No se pudieron cargar las URLs. Revisa la conexión y recarga la página.';
      els.stats.hidden = true;
      showToast(error.message);
    }
  }

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    const submitButton = els.loginForm.querySelector('button[type="submit"]');
    const originalLabel = submitButton.textContent;
    els.loginError.hidden = true;
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Ingresando…';

    try {
      const data = await apiFetch('/api/login', {
        method: 'POST',
        auth: false,
        body: {
          username: els.loginUser.value,
          password: els.loginPass.value
        }
      });

      saveSession(data.token, Number(data.expiresAt) || Date.now() + 12 * 60 * 60 * 1000);
      els.loginForm.reset();
      setView(true);
    } catch (error) {
      if (error.status === 401) showLoginError('Usuario o clave incorrectos.');
      else showLoginError(error.message);
      els.loginPass.value = '';
      els.loginPass.focus();
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });

  els.togglePass.addEventListener('click', () => {
    const show = els.loginPass.type === 'password';
    els.loginPass.type = show ? 'text' : 'password';
    els.iconEye.hidden = show;
    els.iconEyeOff.hidden = !show;
    els.togglePass.setAttribute('aria-pressed', String(show));
    els.togglePass.setAttribute('aria-label', show ? 'Ocultar clave' : 'Mostrar clave');
    els.loginPass.focus();
  });

  els.logoutBtn.addEventListener('click', () => {
    clearSession();
    setView(false);
  });

  function normalizeUrl(value) {
    const input = value.trim();
    if (!input) return null;

    let parsed;
    try {
      parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.includes('.')) return null;
    return parsed.href;
  }

  function normalizeItem(raw) {
    return {
      id: String(raw?.id ?? ''),
      url: String(raw?.url ?? ''),
      description: typeof raw?.description === 'string' ? raw.description : '',
      status: raw?.status === 'vista' ? 'vista' : 'no-vista'
    };
  }

  function prettyUrl(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.formError.hidden = true;
    els.formError.textContent = '';
    syncFormUi();
  }

  function syncFormUi() {
    els.formTitle.textContent = editingId ? 'Modificar URL' : 'Agregar URL';
    els.submitBtn.textContent = editingId ? 'Guardar cambios' : 'Agregar';
    els.cancelEditBtn.hidden = !editingId;
    els.formPanel.classList.toggle('is-editing', Boolean(editingId));
    els.submitBtn.disabled = submitting || loading;
    els.cancelEditBtn.disabled = submitting;
  }

  function setSubmitting(busy) {
    submitting = busy;
    syncFormUi();
    if (busy) els.submitBtn.textContent = editingId ? 'Guardando…' : 'Agregando…';
  }

  function startEdit(item) {
    editingId = item.id;
    els.urlInput.value = item.url;
    els.descInput.value = item.description;

    const radio = els.form.querySelector(`input[name="status"][value="${item.status}"]`);
    if (radio) radio.checked = true;

    els.formError.hidden = true;
    syncFormUi();
    render();
    els.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.urlInput.focus({ preventScroll: true });
  }

  els.cancelEditBtn.addEventListener('click', () => {
    if (submitting) return;
    resetForm();
    render();
    els.urlInput.focus();
  });

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (loading) {
      showToast('Cargando la lista. Intenta de nuevo en un momento.');
      return;
    }

    els.formError.hidden = true;
    const url = normalizeUrl(els.urlInput.value);
    if (!url) {
      els.formError.textContent = 'Ingresa una URL válida (por ejemplo, https://ejemplo.com).';
      els.formError.hidden = false;
      els.urlInput.focus();
      return;
    }

    const description = els.descInput.value.trim();
    const status = els.form.elements.status.value === 'vista' ? 'vista' : 'no-vista';
    const wasEditing = Boolean(editingId);
    const targetId = editingId;

    setSubmitting(true);

    try {
      if (wasEditing) {
        const data = await apiFetch(`/api/urls/${encodeURIComponent(targetId)}`, {
          method: 'PUT',
          body: { url, description, status }
        });
        const index = items.findIndex((entry) => entry.id === targetId);
        if (index !== -1) items[index] = normalizeItem(data.item);
        resetForm();
        render();
        showToast('Cambios guardados');
      } else {
        const data = await apiFetch('/api/urls', {
          method: 'POST',
          body: { url, description, status }
        });
        items.unshift(normalizeItem(data.item));
        resetForm();
        render();
        els.urlInput.focus();
        showToast('URL agregada');
      }
    } catch (error) {
      if (error.status !== 401) {
        els.formError.textContent = error.message;
        els.formError.hidden = false;
      }
    } finally {
      setSubmitting(false);
    }
  });

  function askDelete(item) {
    pendingDeleteId = item.id;
    const target = item.description ? `«${item.description}»` : `«${prettyUrl(item.url)}»`;
    els.confirmText.textContent = `Se eliminará ${target}. Esta acción no se puede deshacer.`;
    els.confirmDialog.showModal();
  }

  els.confirmDialog.addEventListener('close', async () => {
    const id = pendingDeleteId;
    const confirmed = els.confirmDialog.returnValue === 'confirm';
    pendingDeleteId = null;
    els.confirmDialog.returnValue = '';

    if (!id || !confirmed) return;

    try {
      await apiFetch(`/api/urls/${encodeURIComponent(id)}`, { method: 'DELETE' });
      items = items.filter((item) => item.id !== id);
      if (editingId === id) resetForm();
      render();
      showToast('URL eliminada');
    } catch (error) {
      if (error.status !== 401) showToast(error.message);
    }
  });

  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const item = items.find((entry) => entry.id === button.dataset.id);
    if (!item) return;

    if (button.dataset.action === 'edit') {
      startEdit(item);
    } else if (button.dataset.action === 'delete') {
      askDelete(item);
    }
  });

  function iconButton(action, id, label, icon, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icon-btn ${extraClass}`.trim();
    button.dataset.action = action;
    button.dataset.id = id;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function createItemRow(item) {
    const row = document.createElement('li');
    row.className = 'item';
    if (item.id === editingId) row.classList.add('is-editing');

    const main = document.createElement('div');
    main.className = 'item-main';

    const link = document.createElement('a');
    link.className = 'item-url';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = prettyUrl(item.url);
    link.title = item.url;
    main.append(link);

    if (item.description) {
      const description = document.createElement('p');
      description.className = 'item-desc';
      description.textContent = item.description;
      description.title = item.description;
      main.append(description);
    }

    const badge = document.createElement('span');
    badge.className = item.status === 'vista' ? 'badge badge-vista' : 'badge badge-no-vista';
    badge.textContent = STATUS_LABELS[item.status] || 'No vista';

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(
      iconButton('edit', item.id, 'Modificar', ICONS.edit),
      iconButton('delete', item.id, 'Eliminar', ICONS.trash, 'danger')
    );

    row.append(main, badge, actions);
    return row;
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
  }

  function render() {
    els.list.textContent = '';

    for (const item of items) {
      els.list.append(createItemRow(item));
    }

    const total = items.length;
    const vistas = items.filter((item) => item.status === 'vista').length;

    if (!loading) {
      els.emptyState.hidden = total > 0;
    }
    els.stats.hidden = total === 0 || loading;

    if (total > 0 && !loading) {
      els.stats.textContent = [
        plural(total, 'URL', 'URLs'),
        plural(vistas, 'vista', 'vistas'),
        plural(total - vistas, 'no vista', 'no vistas')
      ].join(' · ');
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
  }

  if (getSessionToken()) {
    setView(true);
  } else {
    setView(false);
  }
})();
