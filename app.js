(() => {
  'use strict';

  const USER_HASH = '8504655fa1bac5cadf3d067e80f564f0979bb68ba23f55129b71285d3859677d';
  const PASS_HASH = '931d96ff40cc386729eac3b27a8af57ae000e515e35a43849f3652eb53bca72f';
  const SESSION_KEY = 'cartelera.session';
  const STORAGE_KEY = 'cartelera.urls.v1';
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

  let items = readItems();
  let editingId = null;
  let pendingDeleteId = null;
  let toastTimer = 0;

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return null;

    let url;
    try {
      const parsed = new URL(raw.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      url = parsed.href;
    } catch {
      return null;
    }

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      url,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 160) : '',
      status: raw.status === 'vista' ? 'vista' : 'no-vista',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function readItems() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.map(sanitizeItem).filter(Boolean);
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      showToast('No se pudo guardar en este navegador');
    }
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function setView(authenticated) {
    els.loginView.hidden = authenticated;
    els.appView.hidden = !authenticated;

    if (authenticated) {
      render();
    } else {
      resetForm();
      els.loginError.hidden = true;
      els.loginPass.value = '';
      els.loginUser.focus();
    }
  }

  function showLoginError(message) {
    els.loginError.textContent = message;
    els.loginError.hidden = false;
  }

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.loginError.hidden = true;

    let match = false;
    try {
      const [userHash, passHash] = await Promise.all([
        sha256(els.loginUser.value),
        sha256(els.loginPass.value)
      ]);
      match = userHash === USER_HASH && passHash === PASS_HASH;
    } catch {
      showLoginError('No se pudo verificar el acceso en este navegador.');
      return;
    }

    if (!match) {
      showLoginError('Usuario o clave incorrectos.');
      els.loginPass.value = '';
      els.loginPass.focus();
      return;
    }

    sessionStorage.setItem(SESSION_KEY, '1');
    els.loginForm.reset();
    setView(true);
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
    sessionStorage.removeItem(SESSION_KEY);
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

  function prettyUrl(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.formTitle.textContent = 'Agregar URL';
    els.submitBtn.textContent = 'Agregar';
    els.cancelEditBtn.hidden = true;
    els.formPanel.classList.remove('is-editing');
    els.formError.hidden = true;
    els.formError.textContent = '';
  }

  function startEdit(item) {
    editingId = item.id;
    els.urlInput.value = item.url;
    els.descInput.value = item.description;

    const radio = els.form.querySelector(`input[name="status"][value="${item.status}"]`);
    if (radio) radio.checked = true;

    els.formTitle.textContent = 'Modificar URL';
    els.submitBtn.textContent = 'Guardar cambios';
    els.cancelEditBtn.hidden = false;
    els.formPanel.classList.add('is-editing');
    els.formError.hidden = true;

    render();
    els.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.urlInput.focus({ preventScroll: true });
  }

  els.cancelEditBtn.addEventListener('click', () => {
    resetForm();
    render();
    els.urlInput.focus();
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
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
    const now = Date.now();

    if (editingId) {
      const item = items.find((entry) => entry.id === editingId);
      if (item) {
        item.url = url;
        item.description = description;
        item.status = status;
        item.updatedAt = now;
        persist();
        resetForm();
        render();
        showToast('Cambios guardados');
        return;
      }
    }

    items.unshift({
      id: uid(),
      url,
      description,
      status,
      createdAt: now,
      updatedAt: now
    });
    persist();
    resetForm();
    render();
    els.urlInput.focus();
    showToast('URL agregada');
  });

  function askDelete(item) {
    pendingDeleteId = item.id;
    const target = item.description ? `«${item.description}»` : `«${prettyUrl(item.url)}»`;
    els.confirmText.textContent = `Se eliminará ${target}. Esta acción no se puede deshacer.`;
    els.confirmDialog.showModal();
  }

  els.confirmDialog.addEventListener('close', () => {
    const id = pendingDeleteId;
    const confirmed = els.confirmDialog.returnValue === 'confirm';
    pendingDeleteId = null;
    els.confirmDialog.returnValue = '';

    if (!id || !confirmed) return;

    items = items.filter((item) => item.id !== id);
    persist();
    if (editingId === id) resetForm();
    render();
    showToast('URL eliminada');
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

    els.emptyState.hidden = total > 0;
    els.stats.hidden = total === 0;

    if (total > 0) {
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

  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    setView(true);
  } else {
    setView(false);
  }
})();
