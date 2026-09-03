/**
 * Smart Stay ASSD Live Content Extractor
 */
let debounceTimer = null;

function syncAssdTable() {
  const calendarTable = document.getElementById('calendar');
  if (!calendarTable) return;

  const rawHtml = calendarTable.outerHTML;

  chrome.storage.local.set({
    assd_last_sync: new Date().toISOString(),
    assd_table_html: rawHtml
  }, () => {
    console.log('[Smart Stay Hub] Calendar snapshot synced to storage.');
  });
}

function debouncedSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncAssdTable, 400);
}

// 1. Initial snapshot on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', debouncedSync);
} else {
  debouncedSync();
}

// 2. Watch for dynamic AJAX view updates in ASSD
const targetContainer = document.querySelector('.grid_x') || document.body;
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      debouncedSync();
      break;
    }
  }
});

observer.observe(targetContainer, { childList: true, subtree: true });

// 3. Optional: Floating launcher button right on the ASSD web interface
function injectLauncherButton() {
  if (document.getElementById('smartstay-launch-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'smartstay-launch-btn';
  btn.innerHTML = '📊 Open Operations Hub';
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: #008080;
    color: white;
    border: none;
    padding: 10px 18px;
    border-radius: 25px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    transition: transform 0.15s ease;
  `;

  btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
  btn.onmouseout = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => {
    try {
      const url = chrome.runtime?.getURL('dashboard.html');
      if (url) {
        window.open(url, '_blank');
      } else {
        location.reload();
      }
    } catch (e) {
      alert("Extension updated. Please refresh this page once.");
      location.reload();
    }
  };

  document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectLauncherButton);
} else {
  injectLauncherButton();
}