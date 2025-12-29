/**
 * @file Debug panel HTML/CSS/JS for preview server
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getDebugPanelHTML(config: any): string {
  return `
<div id="debug-panel" class="debug-panel collapsed">
  <button id="debug-toggle" class="debug-toggle" title="Toggle Debug Panel">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 20V10M18 20V4M6 20v-4"/>
    </svg>
  </button>

  <div class="debug-content">
    <div class="debug-header">
      <h3>Debug Panel</h3>
      <button id="debug-close" class="debug-close">&times;</button>
    </div>

    <div class="debug-tabs">
      <button class="debug-tab active" data-tab="config">Config</button>
      <button class="debug-tab" data-tab="events">Events</button>
    </div>

    <div class="debug-tab-content" id="tab-config">
      <pre class="debug-json">${escapeHtml(JSON.stringify(config, null, 2))}</pre>
    </div>

    <div class="debug-tab-content hidden" id="tab-events">
      <div id="events-log">
        <div class="event-empty">No events yet. Interact with the map to see events.</div>
      </div>
    </div>
  </div>
</div>
  `;
}

export function getDebugPanelCSS(): string {
  return `
.debug-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 40px;
  width: 400px;
  background: #1f2937;
  color: #f3f4f6;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  z-index: 1000;
  transition: transform 0.3s ease;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.3);
}

.debug-panel.collapsed {
  transform: translateX(calc(100% - 48px));
}

.debug-toggle {
  position: absolute;
  left: -48px;
  top: 10px;
  width: 40px;
  height: 40px;
  background: #1f2937;
  border: none;
  border-radius: 8px 0 0 8px;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: -2px 0 4px rgba(0, 0, 0, 0.2);
}

.debug-toggle:hover {
  color: #f3f4f6;
  background: #374151;
}

.debug-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.debug-header {
  padding: 12px 16px;
  border-bottom: 1px solid #374151;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.debug-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.debug-close {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.debug-close:hover {
  color: #f3f4f6;
}

.debug-tabs {
  display: flex;
  border-bottom: 1px solid #374151;
}

.debug-tab {
  flex: 1;
  padding: 10px;
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: all 0.2s;
}

.debug-tab:hover {
  color: #f3f4f6;
}

.debug-tab.active {
  color: #3b82f6;
  border-bottom: 2px solid #3b82f6;
}

.debug-tab-content {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.debug-tab-content.hidden {
  display: none;
}

.debug-json {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #a5f3fc;
}

.event-item {
  padding: 8px 0;
  border-bottom: 1px solid #374151;
  font-size: 12px;
}

.event-time {
  color: #6b7280;
  margin-right: 8px;
  font-size: 11px;
}

.event-type {
  color: #fbbf24;
  font-weight: 500;
}

.event-data {
  color: #9ca3af;
  margin-top: 4px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11px;
}

.event-empty {
  color: #6b7280;
  text-align: center;
  padding: 32px 16px;
}
  `;
}

export function getDebugPanelJS(): string {
  return `
// Debug panel functionality
(function() {
  const panel = document.getElementById('debug-panel');
  const toggle = document.getElementById('debug-toggle');
  const close = document.getElementById('debug-close');
  const tabs = document.querySelectorAll('.debug-tab');
  const eventsLog = document.getElementById('events-log');
  let eventCount = 0;

  // Toggle panel
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  close.addEventListener('click', () => {
    panel.classList.add('collapsed');
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.debug-tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
    });
  });

  // Log events
  window.logDebugEvent = function(type, data) {
    eventCount++;
    const time = new Date().toLocaleTimeString();
    const item = document.createElement('div');
    item.className = 'event-item';

    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

    item.innerHTML = \`
      <div>
        <span class="event-time">\${time}</span>
        <span class="event-type">\${type}</span>
      </div>
      \${data ? '<div class="event-data">' + dataStr.substring(0, 100) + (dataStr.length > 100 ? '...' : '') + '</div>' : ''}
    \`;

    // Remove empty message if exists
    const emptyMsg = eventsLog.querySelector('.event-empty');
    if (emptyMsg) {
      emptyMsg.remove();
    }

    eventsLog.insertBefore(item, eventsLog.firstChild);

    // Keep only last 50 events
    while (eventsLog.children.length > 50) {
      eventsLog.removeChild(eventsLog.lastChild);
    }
  };

  // Listen to map events if ml-map exists
  const observer = new MutationObserver(() => {
    const mlMap = document.querySelector('ml-map');
    if (mlMap && !mlMap.dataset.debugListenersAttached) {
      mlMap.dataset.debugListenersAttached = 'true';

      mlMap.addEventListener('ml-map:load', (e) => {
        window.logDebugEvent('map:load', { center: e.detail?.center, zoom: e.detail?.zoom });
      });

      mlMap.addEventListener('ml-map:error', (e) => {
        window.logDebugEvent('map:error', e.detail);
      });

      // Log when map is attached
      window.logDebugEvent('map:ready', 'Map element initialized');
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
  `;
}
