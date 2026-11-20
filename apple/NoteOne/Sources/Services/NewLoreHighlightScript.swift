import Foundation

/// Adds field-relative selection and formatting to the existing report DOM.
enum NewLoreHighlightScript {
    static var source: String {
        let labels = ["copy": L("复制", "Copy"), "quick": L("快记", "Quick note"),
                      "remove": L("取消格式", "Remove formatting"), "bold": L("加粗", "Bold"),
                      "underline": L("划线", "Underline"), "highlight": L("高亮", "Highlight"),
                      "saved": L("已保存到往事", "Saved to OldEcho")]
        let data = try! JSONSerialization.data(withJSONObject: labels)
        return template.replacingOccurrences(of: "__LORE_LABELS__", with: String(decoding: data, as: UTF8.self))
    }

    private static let template = #"""
    (() => {
      if (window.newLoreMarks) return;
      const labels = __LORE_LABELS__;
      const fields = [];
      let highlights = [], busy = false, menu = null, timer = null, pointerType = 'mouse';
      const send = payload => window.webkit.messageHandlers.newLoreHighlight.postMessage(payload);
      const httpLink = root => Array.from(root.querySelectorAll('a[href]')).find(a => /^https?:\/\//i.test(a.getAttribute('href')));
      const reason = p => /^(核心洞察|核心推荐|值得关注|Core Insight|Core Recommendation|Worth Following)[:：]/i.test((p.textContent || '').trim());

      function materialKey(element, source) {
        const section = element.closest('.report-section');
        const module = section?.dataset.moduleId || section?.id || section?.querySelector(':scope > h2')?.textContent?.trim() || 'standalone';
        return JSON.stringify([module, source.trim()]);
      }

      // Fields retain every original text node, including labels and inline links.
      function addField(key, name, elements, sourceUrl) {
        if (!elements.length) return;
        const field = { key, name, elements, sourceUrl };
        elements.forEach(element => {
          element.dataset.loreField = name;
          element.dataset.loreMaterial = key;
        });
        fields.push(field);
      }
      function scanCard(card) {
        const title = Array.from(card.querySelectorAll('h3,h4,h2')).find(h => !h.closest('.summary-block,.abstract-cn'));
        if (!title) return;
        const link = httpLink(title) || httpLink(card);
        const sourceUrl = link?.getAttribute('href');
        const identity = (sourceUrl || title.textContent || '').trim();
        if (!identity) return;
        const key = materialKey(card, identity);
        const paragraphs = Array.from(card.children).filter(p => p.tagName === 'P');
        const insight = paragraphs.find(p => p.matches('.recommendation') || reason(p));
        const lead = card.querySelector('p.lead') || paragraphs.find(p => !p.matches('.meta,.meta-list,.links,.recommendation,.muted,.empty-state') && !reason(p));
        let summary = Array.from(card.querySelectorAll('.abstract-cn p'));
        if (!summary.length) summary = Array.from(card.querySelectorAll('.summary-block p'));
        addField(key, 'title', [title], sourceUrl);
        if (lead) addField(key, 'oneLiner', [lead], sourceUrl);
        addField(key, 'summary', summary, sourceUrl);
        if (insight) addField(key, 'insight', [insight], sourceUrl);
      }
      document.querySelectorAll('.report-section').forEach(section => {
        const cards = Array.from(section.querySelectorAll('.card'));
        cards.forEach(scanCard);
        if (!cards.length) section.querySelectorAll('table.summary-table tbody tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) return;
          const title = cells[1], link = httpLink(title), sourceUrl = link?.getAttribute('href');
          const identity = (sourceUrl || title.textContent || '').trim();
          if (!identity) return;
          const key = materialKey(row, identity);
          addField(key, 'title', [title], sourceUrl);
          if (cells[3]) addField(key, 'oneLiner', [cells[3]], sourceUrl);
        });
      });
      // Older standalone module fragments can lack a report-section wrapper.
      if (!fields.length) document.querySelectorAll('.card').forEach(scanCard);

      function textOf(field) { return field.elements.map(element => element.textContent || '').join(''); }
      function contains(field, node) { return field.elements.some(element => element.contains(node)); }
      function offset(field, node, position) {
        let total = 0;
        for (const element of field.elements) {
          if (element.contains(node)) {
            const range = document.createRange();
            range.selectNodeContents(element);
            range.setEnd(node, position);
            return total + range.toString().length;
          }
          total += (element.textContent || '').length;
        }
        return total;
      }
      function readSelection() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!fields.some(field => contains(field, range.startContainer)) || !fields.some(field => contains(field, range.endContainer))) return null;
        const segments = [];
        fields.forEach(field => {
          if (!field.elements.some(element => range.intersectsNode(element))) return;
          const value = textOf(field);
          const start = contains(field, range.startContainer) ? offset(field, range.startContainer, range.startOffset) : 0;
          const end = contains(field, range.endContainer) ? offset(field, range.endContainer, range.endOffset) : value.length;
          const text = value.slice(start, end);
          if (end <= start || !text.trim()) return;
          segments.push({ materialKey: field.key, field: field.name, start, end, text,
            contextBefore: value.slice(Math.max(0, start - 24), start), contextAfter: value.slice(end, end + 24), sourceUrl: field.sourceUrl });
        });
        // Field declaration order differs from the DOM in some module layouts.
        segments.sort((a, b) => {
          const left = fields.find(f => f.key === a.materialKey && f.name === a.field).elements[0];
          const right = fields.find(f => f.key === b.materialKey && f.name === b.field).elements[0];
          return left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        return segments.length ? { text: segments.map(segment => segment.text).join('\n'), segments } : null;
      }
      function resolve(value, segment) {
        const contextMatches = start => (!segment.contextBefore || value.slice(0, start).endsWith(segment.contextBefore)) &&
          (!segment.contextAfter || value.slice(start + segment.text.length).startsWith(segment.contextAfter));
        if (value.slice(segment.start, segment.end) === segment.text && contextMatches(segment.start)) return { start: segment.start, end: segment.end };
        const matches = [];
        for (let start = value.indexOf(segment.text); start >= 0; start = value.indexOf(segment.text, start + 1)) matches.push(start);
        const contextual = matches.filter(contextMatches);
        const start = contextual.length === 1 ? contextual[0] : matches.length === 1 ? matches[0] : undefined;
        return start === undefined ? null : { start, end: start + segment.text.length };
      }
      function closeMenu() { if (menu) { menu.remove(); menu = null; } }
      function render(next) {
        closeMenu(); highlights = next;
        document.querySelectorAll('span[data-lore-ids]').forEach(mark => mark.replaceWith(...mark.childNodes));
        const matched = new Set();
        fields.forEach(field => {
          field.elements.forEach(element => element.normalize());
          const value = textOf(field), ranges = [];
          highlights.forEach((highlight, order) => highlight.segments.forEach((segment, index) => {
            if (segment.materialKey !== field.key || segment.field !== field.name) return;
            const position = resolve(value, segment);
            if (position) { ranges.push({ ...position, id: highlight.id, style: highlight.style, order }); matched.add(highlight.id + ':' + index); }
          }));
          let base = 0;
          const nodes = [];
          field.elements.forEach(element => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) { const node = walker.currentNode; nodes.push({ node, start: base, end: base + node.length }); base += node.length; }
          });
          nodes.forEach(({ node, start, end }) => {
            const covering = ranges.filter(range => range.start < end && range.end > start);
            if (!covering.length) return;
            const points = Array.from(new Set([start, end, ...covering.flatMap(range => [Math.max(start, range.start), Math.min(end, range.end)])])).sort((a, b) => a - b);
            const fragment = document.createDocumentFragment();
            for (let index = 0; index < points.length - 1; index++) {
              const a = points[index], b = points[index + 1];
              const active = covering.filter(range => range.start <= a && range.end >= b).sort((x, y) => (x.end - x.start) - (y.end - y.start) || y.order - x.order);
              const text = node.data.slice(a - start, b - start);
              if (!active.length) { fragment.append(document.createTextNode(text)); continue; }
              const mark = document.createElement('span');
              mark.dataset.loreIds = Array.from(new Set(active.map(range => range.id))).join(' ');
              mark.className = Array.from(new Set(active.map(range => 'lore-' + range.style))).join(' ');
              mark.textContent = text; mark.tabIndex = 0; mark.setAttribute('role', 'button');
              mark.setAttribute('aria-haspopup', 'menu'); fragment.append(mark);
            }
            node.replaceWith(fragment);
          });
        });
        const total = highlights.reduce((sum, highlight) => sum + highlight.segments.length, 0);
        return total - matched.size;
      }
      function openMenu(x, y, items) {
        closeMenu();
        menu = document.createElement('div'); menu.className = 'lore-menu'; menu.setAttribute('role', 'menu');
        items.forEach(item => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label;
          button.setAttribute('role', 'menuitem'); button.disabled = busy || Boolean(item.disabled);
          button.addEventListener('pointerdown', event => event.preventDefault());
          button.addEventListener('click', () => { const action = item.action; closeMenu(); action(); }); menu.append(button);
        });
        document.body.append(menu);
        const viewport = window.visualViewport, left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        menu.style.left = Math.max(left + 8, Math.min(x, left + (viewport?.width || innerWidth) - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(top + 8, Math.min(y + 8, top + (viewport?.height || innerHeight) - menu.offsetHeight - 8)) + 'px';
        menu.querySelector('button').focus({ preventScroll: true });
      }
      function fragmentMenu(event, mark) {
        const ids = mark.dataset.loreIds.split(' ').filter(id => highlights.some(highlight => highlight.id === id));
        const highlight = highlights.find(item => item.id === ids[0]);
        if (!highlight) return;
        event.preventDefault(); event.stopPropagation();
        const rect = mark.getBoundingClientRect();
        openMenu(event.clientX || rect.left, event.clientY || rect.bottom, [
          { label: labels.copy, action: () => send({ action: 'copy', ids }) },
          { label: labels.quick, disabled: highlight.quickNoted, action: () => send({ action: 'quick', ids }) },
          { label: labels.remove, action: () => send({ action: 'remove', ids }) }
        ]);
      }
      document.addEventListener('selectionchange', () => {
        clearTimeout(timer); timer = setTimeout(() => send({ action: 'selection', selection: readSelection() }), 120);
      });
      document.addEventListener('contextmenu', event => {
        const mark = event.target.closest?.('span[data-lore-ids]');
        if (mark) { fragmentMenu(event, mark); return; }
        const selection = readSelection();
        if (!selection) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY, ['bold', 'underline', 'highlight'].map(style => ({ label: labels[style], action: () => send({ action: 'save', style, selection }) })));
      }, true);
      document.addEventListener('click', event => {
        const mark = event.target.closest?.('span[data-lore-ids]');
        if (mark && (event.pointerType === 'touch' || pointerType === 'touch') && !window.getSelection()?.toString().trim()) fragmentMenu(event, mark);
      }, true);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { closeMenu(); return; }
        const mark = event.target.closest?.('span[data-lore-ids]');
        if (mark && ['Enter', ' ', 'ContextMenu'].includes(event.key)) fragmentMenu(event, mark);
        if (!menu || !menu.contains(event.target) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const buttons = Array.from(menu.querySelectorAll('button')).filter(button => !button.disabled);
        const index = buttons.indexOf(event.target);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      });
      document.addEventListener('pointerdown', event => { pointerType = event.pointerType; if (!menu?.contains(event.target)) closeMenu(); });
      document.addEventListener('pointercancel', () => { pointerType = ''; });
      document.addEventListener('scroll', closeMenu, true);
      window.addEventListener('resize', closeMenu);
      const css = document.createElement('style'); css.textContent = `
        .lore-highlight { background: #f8e4a0; color: inherit; border-radius: 2px; }
        .lore-bold { font-weight: 750; }
        .lore-underline { text-decoration: underline; text-decoration-color: #a78029; text-decoration-thickness: 2px; text-underline-offset: 3px; }
        span[data-lore-ids]:focus-visible { outline: 2px solid #6c47ff; outline-offset: 2px; }
        .lore-menu { position: fixed; z-index: 10000; min-width: 150px; padding: 5px; background: #fff; border: 1px solid #e3e0d8; border-radius: 8px; box-shadow: 0 6px 24px #0002; }
        .lore-menu button { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0; border-radius: 4px; background: transparent; color: #292722; font: 14px -apple-system, system-ui; cursor: pointer; }
        .lore-menu button:hover, .lore-menu button:focus-visible { background: #f3f1ed; }
        .lore-menu button:disabled { color: #999; cursor: default; }
      `; document.head.append(css);
      window.newLoreMarks = { render, readSelection, clearSelection: () => window.getSelection()?.removeAllRanges(), setBusy: value => { busy = value; if (busy) closeMenu(); } };
    })();
    """#
}
