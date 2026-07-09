/**
 * AssociationCanvas — Vanilla JS node-graph engine
 * Runs inside a React-managed container via useRef.
 * All DOM/SVG/RAF operations are self-contained; React only mounts/unmounts.
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const SPRING_K = 0.28;
const SPRING_DAMP = 0.78;
const REPULSION_K = 0.012;
const MIN_SIBLING_DIST = 90;

export default class AssociationCanvas {
  /**
   * @param {HTMLElement} container  — the DOM node React provides via ref
   * @param {string}     apiBase    — backend base URL (e.g. "http://localhost:8000")
   */
  constructor(container, apiBase) {
    this._container = container;
    this._apiBase = apiBase;

    // ---- state ----
    this._scale = 1;
    this._tx = 0;
    this._ty = 0;
    this._nodes = new Map();
    this._connections = [];
    this._nextId = 1;
    this._selectedId = null;
    this._undoStack = [];
    this._searchWord = '';

    // interaction
    this._isDragging = false;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartTX = 0;
    this._panStartTY = 0;
    this._dragNode = null;
    this._dragOffX = 0;
    this._dragOffY = 0;

    // physics
    this._physicsActive = false;
    this._physicsSet = new Set();
    this._rafId = null;

    // DOM
    this._root = null;
    this._transformEl = null;
    this._svgEl = null;
    this._nodesLayer = null;
    this._inputEl = null;
    this._zoomLabel = null;

    this._createDOM();
    this._bindEvents();
  }

  /* ================================================================
     DOM CREATION
     ================================================================ */
  _createDOM() {
    const c = this._container;
    c.innerHTML = '';

    // Root
    const root = document.createElement('div');
    root.className = 'cm-canvas-root';
    c.appendChild(root);
    this._root = root;

    // Transform container
    const tc = document.createElement('div');
    tc.id = 'cm-transform-container';
    tc.className = 'cm-transform';
    root.appendChild(tc);
    this._transformEl = tc;

    // SVG layer
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cm-svg');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '1px';
    svg.style.height = '1px';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    tc.appendChild(svg);
    this._svgEl = svg;

    // Nodes layer
    const nl = document.createElement('div');
    nl.className = 'cm-nodes-layer';
    tc.appendChild(nl);
    this._nodesLayer = nl;

    // Top bar (search input)
    const bar = document.createElement('div');
    bar.className = 'cm-top-bar';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入一个词，按 Enter 发散联想...';
    input.className = 'cm-top-bar-input';
    this._inputEl = input;

    const searchBtn = document.createElement('button');
    searchBtn.className = 'cm-top-bar-btn';
    searchBtn.textContent = '→';
    searchBtn.title = '发散';

    const backBtn = document.createElement('button');
    backBtn.className = 'cm-top-bar-btn';
    backBtn.textContent = '✕';
    backBtn.title = '关闭';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'cm-top-bar-btn';
    clearBtn.textContent = '🗑';
    clearBtn.title = '清空画布';

    bar.appendChild(input);
    bar.appendChild(searchBtn);
    bar.appendChild(clearBtn);
    bar.appendChild(backBtn);
    root.appendChild(bar);

    // Canvas controls (bottom-left)
    const ctrl = document.createElement('div');
    ctrl.className = 'cm-controls';

    const zIn = this._ctrlBtn('+', '放大');
    const zOut = this._ctrlBtn('−', '缩小');
    const sep1 = document.createElement('div');
    sep1.className = 'cm-ctrl-sep';
    const fit = this._ctrlBtn('⊡', '适应视图');
    const sep2 = document.createElement('div');
    sep2.className = 'cm-ctrl-sep';
    const zLabel = document.createElement('div');
    zLabel.className = 'cm-zoom-label';
    zLabel.textContent = '100%';
    this._zoomLabel = zLabel;

    ctrl.append(zIn, zOut, sep1, fit, sep2, zLabel);
    root.appendChild(ctrl);

    // Welcome
    const welcome = document.createElement('div');
    welcome.className = 'cm-welcome';
    welcome.innerHTML = '<div class="cm-welcome-icon">💡</div><div class="cm-welcome-text">输入一个词，开始创意发散</div>';
    this._welcomeEl = welcome;
    root.appendChild(welcome);

    // ---- Button handlers ----
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._doSearch(input.value);
      }
    });
    searchBtn.addEventListener('click', () => this._doSearch(input.value));
    clearBtn.addEventListener('click', () => this._clearGraph());
    backBtn.addEventListener('click', () => {
      this._container.dispatchEvent(new CustomEvent('canvas-close'));
    });

    zIn.addEventListener('click', () => {
      this._zoomTo(this._scale * 1.25, window.innerWidth / 2, window.innerHeight / 2);
    });
    zOut.addEventListener('click', () => {
      this._zoomTo(this._scale / 1.25, window.innerWidth / 2, window.innerHeight / 2);
    });
    fit.addEventListener('click', () => this._fitView());
  }

  _ctrlBtn(text, title) {
    const b = document.createElement('button');
    b.className = 'cm-ctrl-btn';
    b.textContent = text;
    b.title = title;
    return b;
  }

  /* ================================================================
     EVENT BINDING (document-level)
     ================================================================ */
  _bindEvents() {
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);

    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('keydown', this._onKeyDown);
  }

  /* --- Exclusion filter --- */
  _isExcluded(target) {
    return !!target.closest('.cm-top-bar, .cm-controls');
  }

  /* --- Mouse handlers --- */
  _handleMouseDown(e) {
    if (this._isExcluded(e.target)) return;

    // Skip buttons — they have direct click handlers
    if (e.target.closest('.cm-plus-btn') || e.target.closest('.cm-collapse-btn')) return;

    const nodeEl = e.target.closest('.mind-node');

    // Node click / drag
    if (nodeEl) {
      e.stopPropagation();
      const nid = parseInt(nodeEl.dataset.id);
      this._selectNode(nid);

      const node = this._nodes.get(nid);
      if (!node) return;
      const w = this._screenToWorld(e.clientX, e.clientY);
      this._dragNode = node;
      this._dragOffX = node.x - w.x;
      this._dragOffY = node.y - w.y;
      this._isDragging = true;
      node.el.classList.add('dragging');

      // Record spring offsets for direct children only
      for (const cid of node.children) {
        const child = this._nodes.get(cid);
        if (child) {
          child._soX = child.x - node.x;
          child._soY = child.y - node.y;
        }
      }
      this._startPhysics(nid);
      return;
    }

    // Canvas pan (blank area)
    this._isPanning = true;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._panStartTX = this._tx;
    this._panStartTY = this._ty;
    this._root.classList.add('panning');
    this._selectNode(null);
  }

  _handleMouseMove(e) {
    if (this._dragNode) {
      const w = this._screenToWorld(e.clientX, e.clientY);
      this._dragNode.x = w.x + this._dragOffX;
      this._dragNode.y = w.y + this._dragOffY;
      this._dragNode.el.style.left = this._dragNode.x + 'px';
      this._dragNode.el.style.top = this._dragNode.y + 'px';
      // Only update connections for the dragged node and its direct children
      for (const conn of this._connections) {
        if (conn.from === this._dragNode.id || conn.to === this._dragNode.id) {
          this._updateConnectionPath(conn);
        }
      }
      return;
    }
    if (this._isPanning) {
      this._tx = this._panStartTX + (e.clientX - this._panStartX);
      this._ty = this._panStartTY + (e.clientY - this._panStartY);
      this._applyTransform();
    }
  }

  _handleMouseUp() {
    if (this._dragNode) {
      this._dragNode.el.classList.remove('dragging');
      this._isDragging = false;
      this._dragNode = null;
      // Don't stop physics immediately — let spring settle naturally
      return;
    }
    if (this._isPanning) {
      this._isPanning = false;
      this._root.classList.remove('panning');
    }
  }

  _handleWheel(e) {
    if (this._isExcluded(e.target)) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    this._zoomTo(this._scale * (1 + delta), e.clientX, e.clientY);
  }

  _handleKeyDown(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      this._undo();
    }
  }

  /* ================================================================
     COORDINATE TRANSFORM
     ================================================================ */
  _updateSubtreeConnections(node) {
    for (const conn of this._connections) {
      if (conn.from === node.id || conn.to === node.id) {
        this._updateConnectionPath(conn);
      }
    }
    for (const cid of node.children) {
      const child = this._nodes.get(cid);
      if (child) this._updateSubtreeConnections(child);
    }
  }

  _followDescendants(parent) {
    for (const cid of parent.children) {
      const child = this._nodes.get(cid);
      if (!child || !child.el) continue;
      if (child._soX === undefined) {
        child._soX = child.x - parent.x;
        child._soY = child.y - parent.y;
      }
      child.x = parent.x + child._soX;
      child.y = parent.y + child._soY;
      child.el.style.left = child.x + 'px';
      child.el.style.top = child.y + 'px';
      const conn = this._connections.find(c => c.from === parent.id && c.to === cid);
      if (conn) this._updateConnectionPath(conn);
      this._followDescendants(child);
    }
  }

  _screenToWorld(clientX, clientY) {
    return {
      x: (clientX - this._tx) / this._scale,
      y: (clientY - this._ty) / this._scale,
    };
  }

  /** Exposed for external callers if needed */
  screenToWorld(clientX, clientY) {
    return this._screenToWorld(clientX, clientY);
  }

  _applyTransform() {
    this._transformEl.style.transform =
      `translate(${this._tx}px, ${this._ty}px) scale(${this._scale})`;
    if (this._zoomLabel) {
      this._zoomLabel.textContent = Math.round(this._scale * 100) + '%';
    }
  }

  _zoomTo(newScale, pivotCX, pivotCY) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const wb = this._screenToWorld(pivotCX, pivotCY);
    this._scale = newScale;
    this._tx = pivotCX - wb.x * this._scale;
    this._ty = pivotCY - wb.y * this._scale;
    this._applyTransform();
  }

  _fitView() {
    if (this._nodes.size === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this._nodes.forEach((n) => {
      if (n.collapsed && n.parentId != null) return;
      minX = Math.min(minX, n.x - 80);
      maxX = Math.max(maxX, n.x + 80);
      minY = Math.min(minY, n.y - 40);
      maxY = Math.max(maxY, n.y + 40);
    });
    const gw = (maxX - minX) || 1;
    const gh = (maxY - minY) || 1;
    const pad = 80;
    const sx = (window.innerWidth - pad * 2) / gw;
    const sy = (window.innerHeight - pad * 2) / gh;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(sx, sy)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this._scale = ns;
    this._tx = window.innerWidth / 2 - cx * ns;
    this._ty = window.innerHeight / 2 - cy * ns;
    this._applyTransform();
  }

  /* ================================================================
     NODE RENDERING
     ================================================================ */
  _renderNode(node) {
    const el = document.createElement('div');
    el.className = 'mind-node' + (node.isRoot ? ' root' : ' child');
    el.dataset.id = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    if (!node.isRoot) {
      el.style.setProperty('--cm-float-delay', (Math.random() * 5).toFixed(1) + 's');
    }

    const zh = document.createElement('div');
    zh.className = 'mind-node-zh';
    zh.textContent = node.zh;
    el.appendChild(zh);

    if (node.en) {
      const en = document.createElement('div');
      en.className = 'mind-node-en';
      en.textContent = node.en;
      el.appendChild(en);
    }

    // Badge
    if (node.children.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'cm-badge';
      badge.textContent = node.children.length;
      el.appendChild(badge);
    }

    // Collapse button
    if (node.children.length > 0) {
      const col = document.createElement('div');
      col.className = 'cm-collapse-btn';
      col.textContent = node.collapsed ? '+' : '−';
      col.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this._toggleCollapse(node.id);
      });
      el.appendChild(col);
    }

    // Plus button
    const plus = document.createElement('div');
    plus.className = 'cm-plus-btn';
    plus.textContent = '+';
    plus.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[+] expand node', node.id, node.zh);
      this._expandNode(node.id);
    });
    el.appendChild(plus);

    node.el = el;
    this._nodesLayer.appendChild(el);
    return el;
  }

  _updateNodeEl(node) {
    if (!node.el) return;
    node.el.style.left = node.x + 'px';
    node.el.style.top = node.y + 'px';

    // Badge
    let badge = node.el.querySelector('.cm-badge');
    if (node.children.length > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'cm-badge';
        node.el.appendChild(badge);
      }
      badge.textContent = node.children.length;
    } else if (badge) {
      badge.remove();
    }

    // Collapse
    let col = node.el.querySelector('.cm-collapse-btn');
    if (node.children.length > 0) {
      if (!col) {
        col = document.createElement('div');
        col.className = 'cm-collapse-btn';
        node.el.appendChild(col);
      }
      col.textContent = node.collapsed ? '+' : '−';
    } else if (col) {
      col.remove();
    }
  }

  _removeNodeEl(node) {
    if (node.el && node.el.parentNode) {
      node.el.parentNode.removeChild(node.el);
      node.el = null;
    }
  }

  /* ================================================================
     SVG BEZIER CONNECTIONS
     ================================================================ */
  _renderConnections() {
    while (this._svgEl.firstChild) this._svgEl.removeChild(this._svgEl.firstChild);
    for (const conn of this._connections) {
      const p = this._nodes.get(conn.from);
      const c = this._nodes.get(conn.to);
      if (!p || !c) continue;
      if (p.collapsed) continue;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', this._computeBezierPath(p.x, p.y, c.x, c.y));
      path.dataset.from = conn.from;
      path.dataset.to = conn.to;
      this._svgEl.appendChild(path);
    }
  }

  _computeBezierPath(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dist = Math.abs(dx) || 1;
    const tension = Math.min(dist * 0.4, 120);
    // Control points: horizontal component smoothing
    const c1x = x1 + tension;
    const c1y = y1;
    const c2x = x2 - tension;
    const c2y = y2;
    return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
  }

  _updateConnectionPath(conn) {
    const path = this._svgEl.querySelector(`path[data-from="${conn.from}"][data-to="${conn.to}"]`);
    if (!path) return;
    const p = this._nodes.get(conn.from);
    const c = this._nodes.get(conn.to);
    if (!p || !c) return;
    path.setAttribute('d', this._computeBezierPath(p.x, p.y, c.x, c.y));
  }

  /* ================================================================
     NODE INTERACTION
     ================================================================ */
  _selectNode(id) {
    if (this._selectedId != null) {
      const prev = this._nodes.get(this._selectedId);
      if (prev && prev.el) prev.el.classList.remove('selected');
    }
    if (this._selectedId === id) {
      this._selectedId = null;
      return;
    }
    this._selectedId = id;
    const node = this._nodes.get(id);
    if (node && node.el) node.el.classList.add('selected');
  }

  async _expandNode(parentId) {
    const parent = this._nodes.get(parentId);
    console.log('[expandNode] called for', parentId, 'parent:', parent?.zh, 'loading:', parent?._loading, 'children:', parent?.children?.length);
    if (!parent || parent._loading) return;

    // If collapsed, just toggle
    if (parent.collapsed) {
      parent.collapsed = false;
      this._showSubtree(parentId);
      this._updateNodeEl(parent);
      this._renderConnections();
      return;
    }

    // If already has children, do nothing (use collapse button)
    if (parent.children.length > 0) return;

    // Save undo snapshot
    this._saveUndoSnapshot();

    parent._loading = true;
    const plus = parent.el?.querySelector('.cm-plus-btn');
    if (plus) plus.innerHTML = '<div class="cm-spinner"></div>';

    try {
      const words = await this._fetchAssociations(parent.zh);
      if (!words || words.length === 0) {
        if (plus) plus.textContent = '+';
        parent._loading = false;
        return;
      }

      const angleStep = (Math.PI * 1.2) / Math.max(words.length - 1, 1);
      const startAngle = -Math.PI * 0.6;
      const radius = 180 + Math.random() * 60;

      words.forEach((w, i) => {
        const angle = startAngle + angleStep * i;
        const r = radius + (Math.random() - 0.5) * 40;
        const a = angle + (Math.random() - 0.5) * 0.2;

        const child = {
          id: this._nextId++,
          zh: w.zh, en: w.en || '',
          x: parent.x + Math.cos(a) * r,
          y: parent.y + Math.sin(a) * r,
          parentId: parentId,
          children: [],
          collapsed: false,
          el: null,
          _loading: false,
          _soX: undefined,
          _soY: undefined,
        };
        this._nodes.set(child.id, child);
        parent.children.push(child.id);
        this._connections.push({ from: parentId, to: child.id });
        this._renderNode(child);
      });

      this._updateNodeEl(parent);
      this._renderConnections();
      this._updateWelcome();
    } catch (err) {
      console.error('Expand failed:', err);
    }

    parent._loading = false;
    if (plus) plus.textContent = '+';
  }

  _toggleCollapse(parentId) {
    const parent = this._nodes.get(parentId);
    if (!parent || parent.children.length === 0) return;
    parent.collapsed = !parent.collapsed;
    if (parent.collapsed) {
      this._hideSubtree(parentId);
    } else {
      this._showSubtree(parentId);
    }
    this._updateNodeEl(parent);
    this._renderConnections();
  }

  _hideSubtree(parentId) {
    const parent = this._nodes.get(parentId);
    if (!parent) return;
    for (const cid of parent.children) {
      const child = this._nodes.get(cid);
      if (!child) continue;
      if (child.el) child.el.style.display = 'none';
      this._hideSubtree(cid);
    }
  }

  _showSubtree(parentId) {
    const parent = this._nodes.get(parentId);
    if (!parent) return;
    for (const cid of parent.children) {
      const child = this._nodes.get(cid);
      if (!child) continue;
      if (child.el) child.el.style.display = '';
      if (!child.collapsed) this._showSubtree(cid);
    }
  }

  /* ================================================================
     SPRING PHYSICS (HOOKE'S LAW + DAMPING)
     ================================================================ */
  _startPhysics(parentId) {
    this._physicsSet.add(parentId);
    if (!this._physicsActive) {
      this._physicsActive = true;
      this._rafId = requestAnimationFrame(() => this._physicsTick());
    }
  }

  _stopPhysics(parentId) {
    this._physicsSet.delete(parentId);
    if (this._physicsSet.size === 0) {
      this._physicsActive = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._nodes.forEach((n) => { n._vx = 0; n._vy = 0; });
    }
  }

  _physicsTick() {
    if (!this._physicsActive) return;

    let anyMoving = false;

    this._physicsSet.forEach((parentId) => {
      const parent = this._nodes.get(parentId);
      if (!parent) return;

      for (const childId of parent.children) {
        const child = this._nodes.get(childId);
        if (!child || !child.el) continue;

        // Initialize spring offset if needed
        if (child._soX === undefined) {
          child._soX = child.x - parent.x;
          child._soY = child.y - parent.y;
        }

        // Target position = parent + original offset
        const targetX = parent.x + child._soX;
        const targetY = parent.y + child._soY;

        // Hooke's law: F = -k * displacement
        const dx = targetX - child.x;
        const dy = targetY - child.y;

        // Velocity update with spring force + damping
        child._vx = ((child._vx || 0) + dx * SPRING_K) * SPRING_DAMP;
        child._vy = ((child._vy || 0) + dy * SPRING_K) * SPRING_DAMP;

        // Sibling collision repulsion
        for (const otherId of parent.children) {
          if (otherId === childId) continue;
          const other = this._nodes.get(otherId);
          if (!other) continue;
          const cdx = child.x - other.x;
          const cdy = child.y - other.y;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          if (cdist < MIN_SIBLING_DIST) {
            const force = (MIN_SIBLING_DIST - cdist) * REPULSION_K;
            child._vx += (cdx / cdist) * force;
            child._vy += (cdy / cdist) * force;
          }
        }

        // Apply velocity
        child.x += child._vx;
        child.y += child._vy;
        child.el.style.left = child.x + 'px';
        child.el.style.top = child.y + 'px';

        // Update connection
        const conn = this._connections.find(c => c.from === parentId && c.to === childId);
        if (conn) this._updateConnectionPath(conn);

        if (Math.abs(child._vx) > 0.08 || Math.abs(child._vy) > 0.08) anyMoving = true;
      }
    });

    if (this._isDragging || anyMoving) {
      this._rafId = requestAnimationFrame(() => this._physicsTick());
    } else {
      // Settle
      this._physicsActive = false;
      this._physicsSet.forEach(pid => {
        const p = this._nodes.get(pid);
        if (p) {
          for (const cid of p.children) {
            const c = this._nodes.get(cid);
            if (c) { c._vx = 0; c._vy = 0; delete c._soX; delete c._soY; }
          }
        }
      });
      this._physicsSet.clear();
    }
  }

  /* ================================================================
     UNDO
     ================================================================ */
  _saveUndoSnapshot() {
    this._undoStack.push({
      nodeIds: new Set(this._nodes.keys()),
      connLen: this._connections.length,
    });
  }

  _undo() {
    if (this._undoStack.length === 0) return;
    const snap = this._undoStack.pop();

    this._connections.splice(snap.connLen);

    const toRemove = [];
    this._nodes.forEach((node, id) => {
      if (!snap.nodeIds.has(id)) toRemove.push(id);
    });

    for (const id of toRemove) {
      const node = this._nodes.get(id);
      if (!node) continue;
      if (node.parentId != null) {
        const parent = this._nodes.get(node.parentId);
        if (parent) {
          parent.children = parent.children.filter(c => c !== id);
          this._updateNodeEl(parent);
        }
      }
      this._removeNodeEl(node);
      this._nodes.delete(id);
    }

    this._selectedId = null;
    this._renderConnections();
  }

  /* ================================================================
     SEARCH & API
     ================================================================ */
  async _doSearch(word) {
    word = (word || '').trim();
    if (!word) return;

    this._searchWord = word;
    this._clearGraph();
    this._updateWelcome();

    // Center of viewport in world coords
    const cx = (window.innerWidth / 2 - this._tx) / this._scale;
    const cy = (window.innerHeight / 2 - this._ty) / this._scale;

    const root = {
      id: this._nextId++,
      zh: word, en: '',
      x: cx, y: cy,
      parentId: null,
      children: [],
      collapsed: false,
      el: null,
      _loading: false,
      isRoot: true,
    };
    this._nodes.set(root.id, root);
    this._renderNode(root);
    this._updateWelcome();

    // Auto-expand root
    await this._expandNode(root.id);
  }

  async _fetchAssociations(word) {
    try {
      const resp = await fetch(`${this._apiBase}/api/associate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.detail || '请求失败');
      }
      const data = await resp.json();
      console.log('[fetchAssociations] word:', word, 'results:', data?.length);
      return data;
    } catch (err) {
      console.error('[fetchAssociations] API error:', err);
      return [];
    }
  }

  _clearGraph() {
    this._nodes.forEach(n => this._removeNodeEl(n));
    this._nodes.clear();
    this._connections = [];
    this._nextId = 1;
    this._selectedId = null;
    this._undoStack = [];
    this._physicsSet.clear();
    this._physicsActive = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    while (this._svgEl.firstChild) this._svgEl.removeChild(this._svgEl.firstChild);
    this._updateWelcome();
  }

  _updateWelcome() {
    if (this._welcomeEl) {
      this._welcomeEl.style.display = this._nodes.size > 0 ? 'none' : '';
    }
  }

  /* ================================================================
     DESTROY
     ================================================================ */
  destroy() {
    // Cancel physics RAF
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._physicsActive = false;
    this._physicsSet.clear();

    // Remove document-level listeners
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('keydown', this._onKeyDown);

    // Clear all node DOM refs
    this._nodes.forEach(n => { n.el = null; });
    this._nodes.clear();
    this._connections = [];
    this._undoStack = [];

    // Clear container
    if (this._container) this._container.innerHTML = '';

    // Null out references
    this._root = null;
    this._transformEl = null;
    this._svgEl = null;
    this._nodesLayer = null;
    this._inputEl = null;
    this._zoomLabel = null;
    this._welcomeEl = null;
    this._dragNode = null;
    this._container = null;
  }
}
