(() => {
  'use strict';
  const toast = document.querySelector('#toast');
  let toastTimer;
  function announce(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  // Keep links on the current port when the guide is served by the local app.
  // A separately hosted copy points readers to the documented local URL.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  document.querySelectorAll('[data-app-link]').forEach(link => {
    link.href = local ? new URL('/', location.origin).href : 'http://localhost:3000/';
    if (local && link.hasAttribute('data-app-address')) link.textContent = `${location.host} ↗`;
  });

  const tabs = [...document.querySelectorAll('[data-preview]')];
  function selectTab(tab, focus = false) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
    });
  });
  document.querySelector('#approve-example').addEventListener('click', event => {
    event.currentTarget.closest('.example-fact').dataset.approved = 'true';
    event.currentTarget.textContent = 'Example approved ✓';
    event.currentTarget.disabled = true;
    document.querySelector('#fact-example-status').textContent = 'Approved facts can be used in your drafts. This example only updates the preview.';
  });

  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.dataset.copy);
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        announce(button.dataset.copy === 'sample-content' ? 'Sample copied. Paste it into the app.' : 'Commands copied.');
        const label = button.querySelector('[data-copy-label]');
        if (label) {
          label.textContent = 'Copied';
          setTimeout(() => { label.textContent = 'Copy commands'; }, 2500);
        }
      } catch {
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        announce('Text selected. Press Command+C or Ctrl+C to copy.');
      }
    });
  });

  const dialog = document.querySelector('#sample-dialog');
  const content = document.querySelector('#sample-content');
  let sampleRequest = 0;
  document.querySelectorAll('[data-sample]').forEach(button => {
    button.addEventListener('click', async () => {
      const request = ++sampleRequest;
      const kind = button.dataset.sample;
      const path = `./samples/${kind}.txt`;
      button.disabled = true;
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Sample unavailable');
        const sample = await response.text();
        if (request !== sampleRequest) return;
        content.textContent = sample.trim();
        document.querySelector('#sample-title').textContent = kind === 'resume' ? 'Alex’s sample resume' : 'The sample job posting';
        document.querySelector('#sample-instructions').textContent = kind === 'resume' ? 'In the app, open Profile → Paste text. Paste this, then select Save profile.' : 'In the app, open Job → Paste job description. Paste this, then select Extract details.';
        document.querySelector('#download-sample').href = path;
        if (!dialog.open) dialog.showModal();
        content.scrollTop = 0;
      } catch {
        announce('Couldn’t load the sample. Please try again.');
      } finally { button.disabled = false; }
    });
  });
  document.querySelector('#close-sample').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });

  const storageKey = 'jobfather-judge-checklist-v1';
  const checks = [...document.querySelectorAll('[data-check]')];
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) checks.forEach(check => { check.checked = saved.includes(check.dataset.check); });
  } catch { storageAvailable = false; }
  function updateProgress(save = false) {
    const selected = checks.filter(check => check.checked).map(check => check.dataset.check);
    if (save) {
      try { localStorage.setItem(storageKey, JSON.stringify(selected)); }
      catch { storageAvailable = false; }
    }
    const count = selected.length;
    document.querySelector('#checklist-progress').textContent = `${count} / ${checks.length} complete`;
    document.querySelector('#progress-fill').style.width = `${count / checks.length * 100}%`;
    document.querySelector('.progress-track').setAttribute('aria-valuenow', String(count));
    document.querySelector('#checklist-message').textContent = count === checks.length
      ? 'Walkthrough complete. You’ve explored the full application flow.'
      : storageAvailable ? 'Check off steps as you go. Progress stays in this browser.' : 'Check off steps as you go. Browser storage is unavailable; progress lasts for this visit.';
  }
  checks.forEach(check => check.addEventListener('change', () => updateProgress(true)));
  document.querySelector('#reset-checklist').addEventListener('click', () => {
    checks.forEach(check => { check.checked = false; });
    updateProgress(true);
    announce('Walkthrough checklist reset. Your app data is unchanged.');
  });
  updateProgress();
})();
