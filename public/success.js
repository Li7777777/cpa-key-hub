const raw = sessionStorage.getItem('createdApiKeyPayload');
sessionStorage.removeItem('createdApiKeyPayload');

const panel = document.querySelector('#success-panel');
const keyField = document.querySelector('#api-key');
const copyButton = document.querySelector('#copy-key');
const meta = document.querySelector('#success-meta');

window.lucide?.createIcons();

if (!raw) {
  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="section-kicker">Expired</p>
        <h2>完整密钥已不可见</h2>
      </div>
    </div>
    <p class="form-message error">此页面只显示刚创建的 API 密钥。请返回领取页重新创建。</p>
    <div class="button-row">
      <a class="secondary-button" href="/">返回领取页</a>
    </div>
  `;
} else {
  const payload = JSON.parse(raw);
  keyField.value = payload.apiKey || '';
  meta.innerHTML = `
    <span>使用者：${escapeHtml(payload.nickname || '-')}</span>
    <span>创建时间：${escapeHtml(formatDate(payload.createdAt))}</span>
    <span>运行模式：${payload.mode === 'live' ? 'Live' : 'Demo'}</span>
  `;
}

copyButton?.addEventListener('click', async () => {
  const value = keyField.value;
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    copyButton.title = '已复制';
  } catch {
    keyField.select();
    document.execCommand('copy');
  }
});

function formatDate(value) {
  if (!value) {
    return '-';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
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
