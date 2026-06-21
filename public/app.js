const form = document.querySelector('#create-key-form');
const message = document.querySelector('#form-message');
const submitButton = form.querySelector('button[type="submit"]');
const modeBadge = document.querySelector('#mode-badge');

window.lucide?.createIcons();
loadHealth();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const formData = new FormData(form);
  const cdk = String(formData.get('cdk') || '').trim();
  const nickname = String(formData.get('nickname') || '').trim();

  if (!cdk) {
    setFieldError('cdk', '请填写创建邀请码 CDK。');
  }
  if (!nickname) {
    setFieldError('nickname', '请填写用户昵称。');
  }
  if (!cdk || !nickname) {
    return;
  }

  setLoading(true);
  setMessage('正在创建 API 密钥...', 'success');

  try {
    const response = await fetch('/api/create-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cdk, nickname })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || '创建失败，请稍后重试。');
    }

    sessionStorage.setItem('createdApiKeyPayload', JSON.stringify(data));
    window.location.assign('/success.html');
  } catch (error) {
    setMessage(error.message, 'error');
    setLoading(false);
  }
});

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    modeBadge.textContent = data.mode === 'live' ? 'Live' : 'Demo';
  } catch {
    modeBadge.textContent = 'Offline';
  }
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.querySelector('span').textContent = isLoading ? '创建中...' : '创建 API 密钥';
}

function setFieldError(name, text) {
  const node = document.querySelector(`[data-error-for="${name}"]`);
  if (node) {
    node.textContent = text;
  }
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
  setMessage('', '');
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `form-message ${type || ''}`.trim();
}
