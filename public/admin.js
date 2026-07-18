const loginView = document.querySelector('#login-view');
const adminView = document.querySelector('#admin-view');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const logoutButton = document.querySelector('#logout-button');
const refreshButton = document.querySelector('#refresh-button');
const cdkForm = document.querySelector('#cdk-form');
const cdkMessage = document.querySelector('#cdk-message');
const cdkTable = document.querySelector('#cdk-table');
const recordTable = document.querySelector('#record-table');
const recordPagination = document.querySelector('#record-pagination');
const recordPageSummary = document.querySelector('#record-page-summary');
const recordPageStatus = document.querySelector('#record-page-status');
const recordPrevButton = document.querySelector('#record-prev-page');
const recordNextButton = document.querySelector('#record-next-page');
const RECORDS_PAGE_SIZE = 20;

let recordPaginationState = {
  page: 1,
  pageSize: RECORDS_PAGE_SIZE,
  totalRecords: 0,
  totalPages: 1
};
let recordsLoading = false;

window.lucide?.createIcons();
boot();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginMessage('');

  const adminCdk = String(new FormData(loginForm).get('adminCdk') || '').trim();
  if (!adminCdk) {
    setLoginFieldError('请填写管理 CDK。');
    return;
  }

  setLoginFieldError('');

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ adminCdk })
    });
    loginForm.reset();
    showAdmin();
    await loadDashboard();
  } catch (error) {
    setLoginMessage(error.message, 'error');
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLogin();
});

refreshButton.addEventListener('click', loadDashboard);

recordPrevButton.addEventListener('click', () => {
  loadRecordPage(recordPaginationState.page - 1);
});

recordNextButton.addEventListener('click', () => {
  loadRecordPage(recordPaginationState.page + 1);
});

cdkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setCdkMessage('');

  const formData = new FormData(cdkForm);
  const payload = {
    code: String(formData.get('code') || '').trim(),
    label: String(formData.get('label') || '').trim(),
    maxUses: Number(formData.get('maxUses') || 0)
  };

  if (!payload.code) {
    setCdkMessage('请填写 CDK。', 'error');
    return;
  }

  try {
    await api('/api/admin/cdks', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    cdkForm.reset();
    document.querySelector('#new-max-uses').value = 0;
    setCdkMessage('CDK 已添加。', 'success');
    await loadDashboard();
  } catch (error) {
    setCdkMessage(error.message, 'error');
  }
});

cdkTable.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const id = button.dataset.id;

  try {
    if (button.dataset.action === 'toggle') {
      await api(`/api/admin/cdks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: button.dataset.enabled !== 'true' })
      });
      await loadDashboard();
    }

    if (button.dataset.action === 'delete' && window.confirm('确认删除这个 CDK？')) {
      await api(`/api/admin/cdks/${id}`, { method: 'DELETE' });
      await loadDashboard();
    }
  } catch (error) {
    setCdkMessage(error.message, 'error');
  }
});

async function boot() {
  try {
    await api('/api/admin/me');
    showAdmin();
    await loadDashboard();
  } catch {
    showLogin();
  }
}

async function loadDashboard() {
  setRecordPaginationLoading(true);

  try {
    const [summary, cdks, records] = await Promise.all([
      api('/api/admin/summary'),
      api('/api/admin/cdks'),
      api(getRecordsUrl(recordPaginationState.page))
    ]);

    document.querySelector('#metric-active-cdks').textContent = summary.activeCdks;
    document.querySelector('#metric-records').textContent = summary.totalRecords;
    document.querySelector('#metric-mode').textContent = summary.mode === 'live' ? 'Live' : 'Demo';

    renderCdks(cdks.cdks || []);
    renderRecords(records.records || []);
    updateRecordPagination(records.pagination);
    window.lucide?.createIcons();
  } finally {
    setRecordPaginationLoading(false);
  }
}

async function loadRecordPage(page) {
  if (recordsLoading || page < 1 || page > recordPaginationState.totalPages) {
    return;
  }

  setRecordPaginationLoading(true);

  try {
    const records = await api(getRecordsUrl(page));
    renderRecords(records.records || []);
    updateRecordPagination(records.pagination);
  } catch (error) {
    recordPageSummary.textContent = error.message;
    recordPageSummary.classList.add('error');
  } finally {
    setRecordPaginationLoading(false);
  }
}

function getRecordsUrl(page) {
  return `/api/admin/records?page=${page}&pageSize=${RECORDS_PAGE_SIZE}`;
}

function renderCdks(items) {
  if (!items.length) {
    cdkTable.innerHTML = '<tr><td class="empty-row" colspan="6">暂无 CDK</td></tr>';
    return;
  }

  cdkTable.innerHTML = items
    .map((item) => {
      const quota = item.maxUses > 0 ? `${item.used}/${item.maxUses}` : `${item.used}/不限`;
      const statusClass = item.enabled ? 'status-label' : 'status-label off';
      return `
        <tr>
          <td class="mono">${escapeHtml(item.code)}</td>
          <td>${escapeHtml(item.label || '-')}</td>
          <td><span class="${statusClass}">${item.enabled ? '启用' : '停用'}</span></td>
          <td>${escapeHtml(quota)}</td>
          <td>${escapeHtml(formatDate(item.createdAt))}</td>
          <td>
            <div class="table-actions">
              <button class="tiny-button" type="button" data-action="toggle" data-id="${item.id}" data-enabled="${item.enabled}">
                ${item.enabled ? '停用' : '启用'}
              </button>
              <button class="tiny-button danger" type="button" data-action="delete" data-id="${item.id}">删除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderRecords(items) {
  if (!items.length) {
    recordTable.innerHTML = '<tr><td class="empty-row" colspan="5">暂无创建记录</td></tr>';
    return;
  }

  recordTable.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(formatDate(item.createdAt))}</td>
          <td class="mono">${escapeHtml(item.ip || '-')}</td>
          <td class="mono">${escapeHtml(item.cdk || '-')}</td>
          <td>${escapeHtml(item.nickname || '-')}</td>
          <td class="mono">${escapeHtml(item.keyPreview || '-')}</td>
        </tr>
      `
    )
    .join('');
}

function updateRecordPagination(pagination = {}) {
  recordPaginationState = {
    page: Number(pagination.page) || 1,
    pageSize: Number(pagination.pageSize) || RECORDS_PAGE_SIZE,
    totalRecords: Number(pagination.totalRecords) || 0,
    totalPages: Math.max(1, Number(pagination.totalPages) || 1)
  };

  const { page, pageSize, totalRecords, totalPages } = recordPaginationState;
  const firstRecord = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRecord = Math.min(page * pageSize, totalRecords);

  recordPageSummary.textContent =
    totalRecords === 0 ? '共 0 条记录' : `第 ${firstRecord}-${lastRecord} 条，共 ${totalRecords} 条`;
  recordPageSummary.classList.remove('error');
  recordPageStatus.textContent = `第 ${page} / ${totalPages} 页`;
}

function setRecordPaginationLoading(isLoading) {
  recordsLoading = isLoading;
  recordPagination.setAttribute('aria-busy', String(isLoading));
  recordPrevButton.disabled = isLoading || recordPaginationState.page <= 1;
  recordNextButton.disabled = isLoading || recordPaginationState.page >= recordPaginationState.totalPages;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || '请求失败。');
  }

  return data;
}

function showLogin() {
  loginView.classList.remove('hidden');
  adminView.classList.add('hidden');
  logoutButton.classList.add('hidden');
}

function showAdmin() {
  loginView.classList.add('hidden');
  adminView.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
}

function setLoginFieldError(text) {
  document.querySelector('[data-error-for="adminCdk"]').textContent = text;
}

function setLoginMessage(text, type) {
  loginMessage.textContent = text;
  loginMessage.className = `form-message ${type || ''}`.trim();
}

function setCdkMessage(text, type) {
  cdkMessage.textContent = text;
  cdkMessage.className = `form-message ${type || ''}`.trim();
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
