/**
 * Core alert logic.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';

export async function create({ condition, price, message }) {
  // Try opening via button click first
  const opened = await evaluate(`
    (function() {
      var btns = Array.from(document.querySelectorAll('button'));
      var btn = btns.find(b => b.textContent.trim() === 'Alert')
        || document.querySelector('[aria-label="Create Alert"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);

  if (!opened) {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 1, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });
  }

  await new Promise(r => setTimeout(r, 1200));

  // Find the price input — it's the one already pre-filled with a number
  // Use _valueTracker trick to properly update React controlled inputs
  const priceSet = await evaluate(`
    (function() {
      function setReactInputValue(el, val) {
        var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSet.call(el, val);
        // Reset React's value tracker so it detects the change
        var tracker = el._valueTracker;
        if (tracker) tracker.setValue('');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
      // Price input is the one with a numeric value already set
      var priceInput = inputs.find(function(el) { return /^[\d,\.]+$/.test(el.value.trim()); });
      if (priceInput) {
        setReactInputValue(priceInput, ${safeString(String(price))});
        return priceInput.value;
      }
      return false;
    })()
  `);

  if (message) {
    await evaluate(`
      (function() {
        var textarea = document.querySelector('[class*="alert"] textarea')
          || document.querySelector('textarea[placeholder*="message"]');
        if (textarea) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          nativeSet.call(textarea, ${JSON.stringify(message)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
  }

  await new Promise(r => setTimeout(r, 500));
  const created = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button[data-name="submit"], button');
      for (var i = 0; i < btns.length; i++) {
        if (/^create$/i.test(btns[i].textContent.trim())) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  return { success: !!created, price, condition, message: message || '(none)', price_set: !!priceSet, source: 'dom_fallback' };
}

export async function list() {
  // Use pricealerts REST API — returns structured data with alert_id, symbol, price, conditions
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  return { success: true, alert_count: result?.alerts?.length || 0, source: 'internal_api', alerts: result?.alerts || [], error: result?.error };
}

export async function deleteAlerts({ delete_all, alert_ids }) {
  // Delete specific alerts by ID via REST API
  if (alert_ids && alert_ids.length > 0) {
    const results = await evaluateAsync(`
      (async function() {
        const ids = ${JSON.stringify(alert_ids)};
        const out = [];
        for (const id of ids) {
          const r = await fetch('https://pricealerts.tradingview.com/delete_alert', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                       'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' },
            body: 'alert_id=' + id
          });
          const d = await r.json();
          out.push({ id, status: d.s });
        }
        return out;
      })()
    `);
    return { success: true, results, source: 'rest_api' };
  }

  if (delete_all) {
    // Get all alert IDs then delete them
    const listResult = await evaluateAsync(`
      fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
        .then(r => r.json())
        .then(d => (d.r || []).map(a => a.alert_id))
    `);
    const ids = Array.isArray(listResult) ? listResult : [];
    if (ids.length === 0) return { success: true, deleted: 0, source: 'rest_api' };

    const delResults = await evaluateAsync(`
      (async function() {
        const ids = ${JSON.stringify(ids)};
        const out = [];
        for (const id of ids) {
          const r = await fetch('https://pricealerts.tradingview.com/delete_alert', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                       'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '' },
            body: 'alert_id=' + id
          });
          const d = await r.json();
          out.push({ id, status: d.s });
        }
        return out;
      })()
    `);
    const deleted = Array.isArray(delResults) ? delResults.filter(r => r.status === 'ok').length : 0;
    return { success: true, deleted, results: delResults, source: 'rest_api' };
  }
  throw new Error('Provide alert_ids array or delete_all: true.');
}
