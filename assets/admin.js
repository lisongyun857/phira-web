/* Phira 管理员面板逻辑（无构建、无依赖） */
(function () {
  'use strict';

  var CONFIG = window.PHIRA_CONFIG || {};
  var STORAGE_API = 'phira_api_base';
  var STORAGE_TOKEN = 'phira_admin_token';
  var REFRESH_MS = 8000;
  var BINDINGS_PAGE_SIZE = 20;
  var LOG_LINE_LIMIT = 1000;
  var STREAM_RETRY_MS = 3000;

  /* ---------------- 存储与地址 ---------------- */

  function storageGet(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function storageSet(key, value) {
    try {
      if (value === '' || value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      /* 忽略隐私模式下的存储异常 */
    }
  }

  function normalizeBase(value) {
    return String(value === null || value === undefined ? '' : value)
      .trim()
      .replace(/\/+$/, '');
  }

  function getApiBase() {
    return normalizeBase(storageGet(STORAGE_API)) || normalizeBase(CONFIG.apiBase);
  }

  /* ---------------- 网络请求 ---------------- */

  function ApiError(message, status) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || 0;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ApiError);
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  async function request(path, options) {
    var opts = options || {};
    var base = getApiBase();
    if (!base) {
      throw new ApiError('尚未配置 API 地址，请先在“API 地址”中填写服务器地址', 0);
    }
    var headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    var response;
    try {
      response = await fetch(base + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (e) {
      throw new ApiError('无法连接服务器，请检查 API 地址和网络连接', 0);
    }

    var payload = null;
    try {
      payload = await response.json();
    } catch (e) {
      payload = null;
    }

    if (!response.ok || !payload || payload.ok !== true) {
      var message =
        payload && payload.error
          ? String(payload.error)
          : '请求失败（HTTP ' + response.status + '）';
      throw new ApiError(message, response.status);
    }
    return payload.data;
  }

  /** 管理请求：默认附带当前管理员令牌 */
  function adminRequest(path, options) {
    var opts = {};
    var source = options || {};
    Object.keys(source).forEach(function (key) {
      opts[key] = source[key];
    });
    if (opts.token === undefined) opts.token = state.token || undefined;
    return request(path, opts);
  }

  /* ---------------- DOM / 文案工具 ---------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function appendChildren(node, children) {
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child === null || child === undefined || child === false || child === true) continue;
      if (Array.isArray(child)) {
        appendChildren(node, child);
        continue;
      }
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function el(tag, props) {
    var node = document.createElement(tag);
    var options = props || {};
    Object.keys(options).forEach(function (key) {
      var value = options[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = String(value);
      } else if (key === 'dataset') {
        Object.keys(value).forEach(function (dataKey) {
          node.dataset[dataKey] = String(value[dataKey]);
        });
      } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    });
    appendChildren(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function formatDuration(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    if (days > 0) return days + ' 天 ' + hours + ' 小时 ' + minutes + ' 分';
    if (hours > 0) return hours + ' 小时 ' + minutes + ' 分';
    if (minutes > 0) return minutes + ' 分 ' + secs + ' 秒';
    return secs + ' 秒';
  }

  function formatTime(value) {
    if (value === null || value === undefined || value === '') return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return (
      date.getFullYear() +
      '-' +
      pad2(date.getMonth() + 1) +
      '-' +
      pad2(date.getDate()) +
      ' ' +
      pad2(date.getHours()) +
      ':' +
      pad2(date.getMinutes())
    );
  }

  function formatClock(timestamp) {
    var date = new Date(timestamp);
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function formatFileDate(date) {
    var value = date || new Date();
    return String(value.getFullYear()) + pad2(value.getMonth() + 1) + pad2(value.getDate());
  }

  function stateLabel(stateName) {
    switch (stateName) {
      case 'SelectChart':
        return '未开始';
      case 'WaitForReady':
        return '准备中';
      case 'Playing':
        return '游戏中';
      default:
        return '未知阶段';
    }
  }

  function stateTagClass(stateName) {
    if (stateName === 'WaitForReady') return 'tag-warn';
    if (stateName === 'Playing') return 'tag-info';
    return 'tag-muted';
  }

  function platformLabel(platform) {
    if (!platform) return '—';
    if (String(platform).toLowerCase() === 'qq') return 'QQ';
    return String(platform);
  }

  function banTypeLabel(type) {
    return type === 'user' ? 'Phira ID' : 'IP';
  }

  function tag(text, className) {
    return el('span', { class: 'tag ' + (className || 'tag-muted'), text: text });
  }

  function metaItem(label, value) {
    var valueNode =
      value instanceof Node ? value : el('span', { class: 'meta-value', text: value });
    return el(
      'div',
      { class: 'meta' },
      el('span', { class: 'meta-label', text: label }),
      valueNode
    );
  }

  function listValue(list) {
    var items = Array.isArray(list) ? list : [];
    return el('span', {
      class: 'meta-value pre-line',
      text: items.length ? items.join('\n') : '—',
    });
  }

  function loadingState(text) {
    return el(
      'div',
      { class: 'loading-state' },
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      text
    );
  }

  function toast(message, type) {
    var stack = $('#toast-stack');
    if (!stack) return;
    var variant = type === 'success' || type === 'error' || type === 'info' ? type : 'info';
    var node = el('div', { class: 'toast toast-' + variant, role: 'status' }, String(message));
    stack.appendChild(node);
    while (stack.children.length > 5) stack.removeChild(stack.firstChild);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, 3600);
  }

  function setFieldError(input, errorNode, message) {
    if (input) input.classList.add('is-invalid');
    if (errorNode) {
      errorNode.textContent = message;
      errorNode.hidden = false;
    }
  }

  function clearFieldError(input, errorNode) {
    if (input) input.classList.remove('is-invalid');
    if (errorNode) {
      errorNode.textContent = '';
      errorNode.hidden = true;
    }
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.disabled = true;
      button.classList.add('is-busy');
    } else {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  function confirmAction(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var settled = false;
      var backdrop = el('div', { class: 'modal-backdrop' });
      var dialog = el('div', {
        class: 'modal',
        role: 'dialog',
        'aria-modal': 'true',
      });

      function finish(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(value);
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') finish(false);
      }

      var cancelButton = el(
        'button',
        { class: 'btn btn-ghost', type: 'button', onClick: function () { finish(false); } },
        '取消'
      );
      var confirmButton = el(
        'button',
        {
          class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
          type: 'button',
          onClick: function () { finish(true); },
        },
        opts.confirmText || '确认'
      );

      dialog.appendChild(el('div', { class: 'modal-head' }, el('h2', { text: opts.title || '请确认' })));
      dialog.appendChild(
        el('div', { class: 'modal-body' }, el('p', { class: 'modal-text', text: opts.message || '' }))
      );
      dialog.appendChild(el('div', { class: 'modal-foot' }, cancelButton, confirmButton));
      backdrop.appendChild(dialog);
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) finish(false);
      });
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(backdrop);
      cancelButton.focus();
    });
  }

  function parseTarget(raw) {
    var value = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) return { targetId: Number(value) };
    return { targetName: value };
  }

  function validateRoomId(input, errorNode, required) {
    var raw = input.value.trim();
    if (!raw) {
      if (required) {
        setFieldError(input, errorNode, '请输入房间 ID');
        return false;
      }
      clearFieldError(input, errorNode);
      return false;
    }
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(raw)) {
      setFieldError(input, errorNode, '只能包含字母、数字、-、_，长度 1~20');
      return false;
    }
    clearFieldError(input, errorNode);
    return true;
  }

  function validateQq(input, errorNode, required) {
    var raw = input.value.trim();
    if (!raw) {
      if (required) {
        setFieldError(input, errorNode, '请输入 QQ 号');
        return false;
      }
      clearFieldError(input, errorNode);
      return false;
    }
    if (!/^\d{5,12}$/.test(raw)) {
      setFieldError(input, errorNode, 'QQ 号应为 5~12 位数字');
      return false;
    }
    clearFieldError(input, errorNode);
    return true;
  }

  /* ---------------- 状态 ---------------- */

  var state = {
    token: storageGet(STORAGE_TOKEN),
    authed: false,
    status: null,
    users: [],
    rooms: [],
    bans: [],
    bindings: [],
    bindingRows: [],
    selectedBindings: {},
    bindingPage: 1,
    bindingPageSize: BINDINGS_PAGE_SIZE,
    bindingTotal: 0,
    bindingSearch: '',
    playerSearch: '',
    selectedRoomId: '',
    selectedRoom: null,
    activeTab: 'overview',
    logLines: 200,
    lastLink: '',
    config: null,
    stream: null,
    streamTimer: null,
    streamManualStop: false,
    streamLineCount: 0,
    busy: {},
  };

  function markSync(text, isError) {
    var node = $('#admin-sync');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('is-error', Boolean(isError));
  }

  function updateApiChip() {
    var chip = $('#admin-api-chip');
    if (!chip) return;
    var base = getApiBase();
    chip.textContent = base || 'API 未配置';
    chip.title = base || '尚未配置 API 地址';
    chip.classList.toggle('is-missing', !base);
  }

  function setLoginError(message) {
    var node = $('#admin-login-error');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function resetData() {
    state.status = null;
    state.users = [];
    state.rooms = [];
    state.bans = [];
    state.bindings = [];
    state.bindingRows = [];
    state.selectedBindings = {};
    state.bindingPage = 1;
    state.bindingTotal = 0;
    state.bindingSearch = '';
    state.playerSearch = '';
    state.selectedRoomId = '';
    state.selectedRoom = null;
    state.config = null;
    state.lastLink = '';
    state.streamLineCount = 0;
    var streamPre = $('#log-stream');
    if (streamPre) streamPre.textContent = '尚未开始实时日志。';
  }

  function showLogin() {
    var loginView = $('#admin-login-view');
    var appView = $('#admin-app-view');
    var nav = $('#admin-nav');
    var logoutButton = $('#admin-logout');
    var baseInput = $('#admin-api-base');
    var passwordInput = $('#admin-password');
    var details = $('#admin-api-details');
    var playerSearch = $('#players-search');
    var bindingsSearch = $('#bindings-search');
    if (loginView) loginView.hidden = false;
    if (appView) appView.hidden = true;
    if (nav) nav.hidden = true;
    if (logoutButton) logoutButton.hidden = true;
    if (baseInput) baseInput.value = getApiBase();
    if (passwordInput) passwordInput.value = '';
    if (details) details.open = !getApiBase();
    if (playerSearch) playerSearch.value = '';
    if (bindingsSearch) bindingsSearch.value = '';
    updateApiChip();
  }

  function showApp() {
    var loginView = $('#admin-login-view');
    var appView = $('#admin-app-view');
    var nav = $('#admin-nav');
    var logoutButton = $('#admin-logout');
    if (loginView) loginView.hidden = true;
    if (appView) appView.hidden = false;
    if (nav) nav.hidden = false;
    if (logoutButton) logoutButton.hidden = false;
    updateApiChip();
  }

  function expireSession(message) {
    var text = message || '管理员登录已过期';
    var hadSession = Boolean(state.token) || state.authed;
    stopLogStream(true);
    state.authed = false;
    state.token = '';
    storageSet(STORAGE_TOKEN, '');
    resetData();
    showLogin();
    setLoginError(text);
    markSync('尚未同步', false);
    if (hadSession) toast(text, 'error');
  }

  function handleError(error, silent) {
    if (error.status === 401) {
      expireSession('管理员登录已过期');
      return;
    }
    markSync('请求失败：' + error.message, true);
    if (!silent) toast(error.message, 'error');
  }

  /* ---------------- 登录 / 校验 ---------------- */

  function parseApiBase(raw) {
    var base = normalizeBase(raw);
    if (!base) return { error: '请填写 API 地址' };
    var parsed = null;
    try {
      parsed = new URL(base);
    } catch (e) {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return { error: 'API 地址需要以 http:// 或 https:// 开头' };
    }
    return { base: base };
  }

  async function attemptLogin(event) {
    if (event) event.preventDefault();
    var baseInput = $('#admin-api-base');
    var passwordInput = $('#admin-password');
    var submitButton = $('#admin-login-submit');
    if (!baseInput || !passwordInput) return;

    var parsed = parseApiBase(baseInput.value);
    if (parsed.error) {
      setLoginError(parsed.error);
      baseInput.focus();
      return;
    }
    var password = passwordInput.value;
    if (!password) {
      setLoginError('请输入管理员密码');
      passwordInput.focus();
      return;
    }
    if (password.length < 6) {
      setLoginError('密码至少 6 位');
      passwordInput.focus();
      return;
    }

    storageSet(STORAGE_API, parsed.base);
    updateApiChip();

    setBusy(submitButton, true);
    setLoginError('');
    try {
      var data = await request('/api/admin/login', {
        method: 'POST',
        body: { password: password },
      });
      state.token = data && data.token ? String(data.token) : '';
      if (!state.token) throw new ApiError('服务器未返回管理员令牌', 0);
      state.authed = true;
      storageSet(STORAGE_TOKEN, state.token);
      passwordInput.value = '';
      setLoginError('');
      showApp();
      switchTab('overview');
      toast('登录成功', 'success');
    } catch (error) {
      if (error.status === 401) {
        setLoginError('密码错误');
      } else if (error.status === 429 || error.status === 503) {
        setLoginError(error.message);
      } else {
        setLoginError(error.message);
      }
      if (error.status !== 401) toast(error.message, 'error');
      if (!state.authed) showLogin();
    } finally {
      setBusy(submitButton, false);
    }
  }

  async function verifySession() {
    if (!state.token) {
      showLogin();
      return;
    }
    try {
      var data = await request('/api/admin/config', { token: state.token });
      state.config = data.config || null;
      state.authed = true;
      showApp();
      switchTab('overview');
    } catch (error) {
      if (error.status === 401) {
        expireSession('管理员登录已过期');
      } else {
        state.authed = false;
        showLogin();
        setLoginError('无法验证登录状态：' + error.message);
      }
    }
  }

  async function handleLogout() {
    var token = state.token;
    stopLogStream(true);
    try {
      if (token) await request('/api/admin/logout', { method: 'POST', token: token });
    } catch (error) {
      /* 退出失败也要本地清除 */
    }
    state.token = '';
    state.authed = false;
    storageSet(STORAGE_TOKEN, '');
    resetData();
    showLogin();
    setLoginError('');
    markSync('尚未同步', false);
    toast('已退出登录', 'info');
  }

  /* ---------------- 标签页 ---------------- */

  var TABS = ['overview', 'rooms', 'players', 'bindings', 'logs', 'announce', 'settings'];

  function switchTab(tab) {
    if (TABS.indexOf(tab) === -1) tab = 'overview';
    state.activeTab = tab;

    var buttons = document.querySelectorAll('#admin-nav .nav-btn');
    Array.prototype.forEach.call(buttons, function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-tab') === tab);
    });

    TABS.forEach(function (name) {
      var panel = $('#tab-' + name);
      if (panel) panel.hidden = name !== tab;
    });

    if (tab === 'overview') {
      loadStatus(false);
      loadUsers(false);
    } else if (tab === 'rooms') {
      loadRooms(false);
    } else if (tab === 'players') {
      loadUsers(false);
      loadBans(false);
    } else if (tab === 'bindings') {
      loadBindings(false);
    } else if (tab === 'logs') {
      loadLogs(false);
    } else if (tab === 'settings') {
      loadConfig(false);
    }
  }

  /* ---------------- 概览 ---------------- */

  async function loadStatus(silent) {
    if (state.busy.status) return;
    state.busy.status = true;
    try {
      state.status = await adminRequest('/api/status');
      renderStatus();
      markSync('已同步 ' + formatClock(Date.now()), false);
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.status = false;
    }
  }

  function renderStatus() {
    var status = state.status;
    if (!status) return;

    var uptime = $('#stat-uptime');
    var users = $('#stat-users');
    var sessions = $('#stat-sessions');
    var rooms = $('#stat-rooms');
    var memory = $('#stat-memory');
    if (uptime) uptime.textContent = formatDuration(status.uptime);
    if (users) users.textContent = String(status.users === undefined ? '—' : status.users);
    if (sessions) sessions.textContent = String(status.sessions === undefined ? '—' : status.sessions);
    if (rooms) rooms.textContent = String(status.rooms === undefined ? '—' : status.rooms);
    if (memory) {
      memory.textContent =
        status.memoryMB === undefined || status.memoryMB === null
          ? '—'
          : status.memoryMB + ' MB';
    }

    var allowed = Boolean(status.allowClientCreateRoom);
    var tagNode = $('#creation-tag');
    if (tagNode) {
      tagNode.textContent = allowed ? '允许' : '禁止';
      tagNode.className = 'tag ' + (allowed ? 'tag-ok' : 'tag-danger');
    }
    var button = $('#btn-room-creation');
    if (button) {
      button.textContent = allowed ? '禁止客户端建房' : '允许客户端建房';
      button.className = 'btn ' + (allowed ? 'btn-danger' : 'btn-primary');
    }
    var hint = $('#creation-hint');
    if (hint) {
      hint.textContent = allowed
        ? '当前允许玩家在客户端创建房间。'
        : '当前禁止玩家在客户端创建房间；控制台、QQ 指令与管理员接口不受影响。';
    }
  }

  async function loadUsers(silent) {
    if (state.busy.users) return;
    state.busy.users = true;
    try {
      var data = await adminRequest('/api/users');
      state.users = data.users || [];
      renderUsers();
      renderPlayers();
      markSync('已同步 ' + formatClock(Date.now()), false);
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.users = false;
    }
  }

  function renderUsers() {
    var tbody = $('#users-body');
    if (!tbody) return;
    clear(tbody);

    var users = state.users || [];
    var emptyNode = $('#users-empty');
    var wrapNode = $('#users-wrap');
    if (emptyNode) emptyNode.hidden = users.length > 0;
    if (wrapNode) wrapNode.hidden = users.length === 0;

    if (!users.length) return;

    users.forEach(function (user) {
      tbody.appendChild(
        el(
          'tr',
          {},
          el('td', { class: 'mono', text: String(user.id) }),
          el('td', { text: user.name || '—' }),
          el('td', { class: 'mono', text: user.room || '—' }),
          el('td', {}, tag(user.monitor ? '旁观' : '玩家', user.monitor ? 'tag-muted' : 'tag-ok')),
          el('td', {}, tag(user.online ? '在线' : '离线', user.online ? 'tag-ok' : 'tag-danger'))
        )
      );
    });
  }

  async function toggleRoomCreation() {
    if (!state.status) return;
    var enabled = !state.status.allowClientCreateRoom;
    if (!enabled) {
      var ok = await confirmAction({
        title: '禁止客户端建房',
        message:
          '禁止后玩家将无法在 Phira 客户端创建新房间；控制台、QQ 指令与管理员接口不受影响。确定继续吗？',
        confirmText: '禁止建房',
        danger: true,
      });
      if (!ok) return;
    }

    var button = $('#btn-room-creation');
    setBusy(button, true);
    try {
      var data = await adminRequest('/api/room-creation', {
        method: 'POST',
        body: { enabled: enabled },
      });
      if (state.status) state.status.allowClientCreateRoom = Boolean(data.enabled);
      renderStatus();
      toast(data.enabled ? '已允许客户端建房' : '已禁止客户端建房', 'success');
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  /* ---------------- 房间 ---------------- */

  async function loadRooms(silent) {
    if (state.busy.rooms) return;
    state.busy.rooms = true;
    try {
      var data = await adminRequest('/api/rooms?all=1');
      state.rooms = data.rooms || [];
      if (
        state.selectedRoomId &&
        !state.rooms.some(function (room) {
          return room.id === state.selectedRoomId;
        })
      ) {
        state.selectedRoomId = '';
        state.selectedRoom = null;
        renderRoomDetail();
      }
      renderRooms();
      markSync('已同步 ' + formatClock(Date.now()), false);
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.rooms = false;
    }
  }

  function renderRooms() {
    var tbody = $('#admin-rooms-body');
    if (!tbody) return;
    clear(tbody);

    var rooms = state.rooms || [];
    var emptyNode = $('#admin-rooms-empty');
    var wrapNode = $('#admin-rooms-wrap');
    if (emptyNode) emptyNode.hidden = rooms.length > 0;
    if (wrapNode) wrapNode.hidden = rooms.length === 0;

    rooms.forEach(function (room) {
      tbody.appendChild(
        el(
          'tr',
          { class: room.id === state.selectedRoomId ? 'is-selected' : null },
          el(
            'td',
            { class: 'mono' },
            room.id,
            room.hidden ? el('span', { class: 'tag tag-warn tag-inline', text: '隐藏' }) : null
          ),
          el('td', { class: 'mono', text: (room.users || 0) + ' / ' + (room.maxUsers || 0) }),
          el('td', { text: room.chart ? room.chart.name : '未选谱' }),
          el('td', {}, tag(stateLabel(room.state), stateTagClass(room.state))),
          el(
            'td',
            {},
            el(
              'div',
              { class: 'tag-row', title: '轮换状态请在房间详情中查看' },
              tag(room.locked ? '已锁定' : '未锁定', room.locked ? 'tag-warn' : 'tag-muted'),
              room.live ? tag('直播', 'tag-info') : null
            )
          ),
          el('td', { text: room.host ? room.host.name : '—' }),
          el(
            'td',
            {},
            el(
              'div',
              { class: 'tag-row' },
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  onClick: function () { selectRoom(room.id); },
                },
                '详情'
              ),
              el(
                'button',
                {
                  class: 'btn btn-danger btn-sm',
                  type: 'button',
                  onClick: function () { deleteRoom(room); },
                },
                '解散'
              )
            )
          )
        )
      );
    });
  }

  function selectRoom(roomId) {
    state.selectedRoomId = roomId;
    state.selectedRoom = null;
    renderRooms();
    renderRoomDetail();
    loadRoomDetail(roomId, false);
  }

  async function loadRoomDetail(roomId, silent) {
    if (state.busy.detail) return;
    state.busy.detail = true;
    try {
      var data = await adminRequest('/api/room?id=' + encodeURIComponent(roomId));
      if (state.selectedRoomId !== roomId) return;
      state.selectedRoom = data.room;
      renderRoomDetail();
    } catch (error) {
      if (state.selectedRoomId !== roomId) return;
      if (error.status === 404) {
        state.selectedRoomId = '';
        state.selectedRoom = null;
        renderRooms();
        renderRoomDetail();
        toast('房间已不存在', 'info');
        return;
      }
      handleError(error, silent);
    } finally {
      state.busy.detail = false;
    }
  }

  function renderRoomDetail() {
    var card = $('#admin-room-detail');
    var box = $('#admin-room-detail-body');
    var sub = $('#admin-room-detail-sub');
    if (!card || !box) return;

    if (!state.selectedRoomId) {
      card.hidden = true;
      clear(box);
      return;
    }

    card.hidden = false;
    clear(box);
    if (sub) sub.textContent = '房间 ' + state.selectedRoomId;

    if (!state.selectedRoom) {
      box.appendChild(loadingState('正在加载房间详情…'));
      return;
    }

    var room = state.selectedRoom;
    box.appendChild(buildRoomSummary(room));
    box.appendChild(buildAdminControls(room));
  }

  function buildRoomSummary(room) {
    var wrap = el('div', { class: 'room-summary' });

    wrap.appendChild(
      el(
        'div',
        { class: 'room-head' },
        el(
          'div',
          { class: 'room-title' },
          el('span', { class: 'room-id', text: '#' + room.id }),
          tag(room.stateName || stateLabel(room.state), stateTagClass(room.state))
        ),
        el(
          'div',
          { class: 'tag-row' },
          tag(room.locked ? '已锁定' : '未锁定', room.locked ? 'tag-warn' : 'tag-muted'),
          tag(room.cycle ? '轮换开启' : '轮换关闭', room.cycle ? 'tag-info' : 'tag-muted'),
          room.live ? tag('旁观直播', 'tag-info') : null
        )
      )
    );

    wrap.appendChild(
      el(
        'div',
        { class: 'meta-grid' },
        metaItem('房主', room.host ? room.host.name + '（' + room.host.id + '）' : '暂无房主'),
        metaItem('谱面', room.chart ? room.chart.name + '（' + room.chart.id + '）' : '未选谱'),
        metaItem('玩家', (room.users || 0) + ' / ' + (room.maxUsers || 0)),
        metaItem('旁观', String(room.monitors || 0))
      )
    );

    wrap.appendChild(buildMembersTable(room.members || []));
    return wrap;
  }

  function buildMembersTable(members) {
    var tbody = el('tbody');
    if (!members.length) {
      tbody.appendChild(
        el('tr', {}, el('td', { colspan: '4', class: 'muted', text: '房间内暂无成员。' }))
      );
    } else {
      members.forEach(function (member) {
        tbody.appendChild(
          el(
            'tr',
            {},
            el('td', { class: 'mono', text: String(member.id) }),
            el('td', { text: member.name || '—' }),
            el(
              'td',
              {},
              tag(member.monitor ? '旁观' : '玩家', member.monitor ? 'tag-muted' : 'tag-ok')
            ),
            el('td', {}, tag(member.online ? '在线' : '离线', member.online ? 'tag-ok' : 'tag-danger'))
          )
        );
      });
    }

    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'table table-compact' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: '玩家 ID' }),
            el('th', { text: '昵称' }),
            el('th', { text: '身份' }),
            el('th', { text: '状态' })
          )
        ),
        tbody
      )
    );
  }

  function actionButton(label, variant, disabled, reason, handler) {
    var button = el('button', {
      class: 'btn ' + (variant || ''),
      type: 'button',
    }, label);
    if (disabled) {
      button.disabled = true;
      if (reason) button.title = reason;
    } else if (handler) {
      button.addEventListener('click', handler);
    }
    return button;
  }

  function buildAdminControls(room) {
    var group = el(
      'div',
      { class: 'control-group' },
      el('div', { class: 'control-title', text: '管理操作' })
    );

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        actionButton(room.locked ? '解锁房间' : '锁定房间', '', false, '', function () {
          adminRoomAction(room.id, 'lock', { locked: !room.locked }, {
            successText: room.locked ? '房间已解锁' : '房间已锁定',
          });
        }),
        actionButton(room.cycle ? '关闭轮换' : '开启轮换', '', false, '', function () {
          adminRoomAction(room.id, 'cycle', { enabled: !room.cycle }, {
            successText: room.cycle ? '已关闭轮换' : '已开启轮换',
          });
        }),
        actionButton('解散房间', 'btn-danger', false, '', function () {
          confirmAction({
            title: '解散房间',
            message: '确定解散房间“' + room.id + '”吗？房间内所有成员都会被移出，且无法恢复。',
            confirmText: '解散房间',
            danger: true,
          }).then(function (ok) {
            if (ok) {
              adminRoomAction(room.id, 'dissolve', {}, { successText: '房间已解散' });
            }
          });
        })
      )
    );

    if (room.state === 'SelectChart') {
      var adminChartInput = el('input', {
        class: 'input',
        id: 'admin-chart-id-input',
        type: 'number',
        min: '1',
        step: '1',
        inputmode: 'numeric',
        placeholder: '谱面 ID',
      });
      group.appendChild(
        el(
          'div',
          { class: 'control-row' },
          el(
            'div',
            { class: 'field' },
            el('label', { for: 'admin-chart-id-input', text: '谱面 ID' }),
            adminChartInput
          ),
          actionButton('选择谱面', 'btn-primary', false, '', function () {
            var id = Number(adminChartInput.value.trim());
            if (!Number.isInteger(id) || id <= 0) {
              toast('请输入正整数谱面 ID', 'error');
              adminChartInput.focus();
              return;
            }
            adminRoomAction(room.id, 'select-chart', { chartId: id }, { successText: '已选择谱面' });
          }),
          actionButton('搜索选谱', 'btn-ghost', false, '', function () {
            if (!window.ChartPicker) return;
            ChartPicker.open({
              title: '选择谱面 · 房间 ' + room.id,
              selectedId: room.chart ? room.chart.id : null,
              onSelect: function (chart) {
                adminRoomAction(
                  room.id,
                  'select-chart',
                  { chartId: chart.id },
                  { successText: '已选择《' + chart.name + '》' }
                );
              },
            });
          })
        )
      );
    }

    var targetInput = el('input', {
      class: 'input',
      id: 'admin-target-input',
      type: 'text',
      autocomplete: 'off',
      placeholder: '玩家 ID 或昵称',
    });

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'admin-target-input', text: '目标玩家' }),
          targetInput
        ),
        actionButton('踢出房间', 'btn-danger', false, '', function () {
          var target = parseTarget(targetInput.value);
          if (!target) {
            toast('请输入玩家 ID 或昵称', 'error');
            targetInput.focus();
            return;
          }
          var label = targetInput.value.trim();
          confirmAction({
            title: '踢出玩家',
            message: '确定将“' + label + '”踢出房间“' + room.id + '”吗？',
            confirmText: '踢出',
            danger: true,
          }).then(function (ok) {
            if (ok) {
              adminRoomAction(room.id, 'kick', target, { successText: '已踢出目标玩家' });
            }
          });
        }),
        actionButton('转让房主', 'btn-ghost', false, '', function () {
          var target = parseTarget(targetInput.value);
          if (!target) {
            toast('请输入玩家 ID 或昵称', 'error');
            targetInput.focus();
            return;
          }
          var label = targetInput.value.trim();
          confirmAction({
            title: '转让房主',
            message: '确定将房间“' + room.id + '”的房主转让给“' + label + '”吗？',
            confirmText: '转让',
            danger: true,
          }).then(function (ok) {
            if (ok) {
              adminRoomAction(room.id, 'set-host', target, { successText: '已转让房主' });
            }
          });
        })
      )
    );

    var messageInput = el('input', {
      class: 'input',
      id: 'admin-message-input',
      type: 'text',
      autocomplete: 'off',
      placeholder: '发送给该房间的聊天消息',
    });

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'admin-message-input', text: '管理消息' }),
          messageInput
        ),
        actionButton('发送到该房间', 'btn-ghost', false, '', function () {
          sendRoomMessage(room.id, messageInput);
        })
      )
    );

    return group;
  }

  async function adminRoomAction(roomId, action, extra, options) {
    var opts = options || {};
    if (state.busy.action) return;
    state.busy.action = true;
    try {
      await adminRequest('/api/room/action', {
        method: 'POST',
        body: Object.assign({ admin: true, roomId: roomId, action: action }, extra || {}),
      });
      toast(opts.successText || '操作成功', 'success');
      await loadRooms(true);
      if (state.selectedRoomId === roomId) await loadRoomDetail(roomId, true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.action = false;
    }
  }

  async function sendRoomMessage(roomId, input) {
    var content = input.value.trim();
    if (!content) {
      toast('请输入消息内容', 'error');
      input.focus();
      return;
    }
    try {
      await adminRequest('/api/say', {
        method: 'POST',
        body: { target: roomId, content: content },
      });
      input.value = '';
      toast('已向房间 ' + roomId + ' 发送管理消息', 'success');
    } catch (error) {
      handleError(error, false);
    }
  }

  async function deleteRoom(room) {
    if (state.busy.action) return;
    var members = (room.users || 0) + (room.monitors || 0);
    var ok = await confirmAction({
      title: '解散房间',
      message:
        '确定解散房间“' +
        room.id +
        '”吗？房间内 ' +
        members +
        ' 名成员将被移出，且无法恢复。',
      confirmText: '解散',
      danger: true,
    });
    if (!ok) return;

    state.busy.action = true;
    try {
      var data = await adminRequest('/api/rooms/delete', {
        method: 'POST',
        body: { id: room.id },
      });
      toast('房间已解散，移出 ' + (data.members || 0) + ' 名成员', 'success');
      if (state.selectedRoomId === room.id) {
        state.selectedRoomId = '';
        state.selectedRoom = null;
        renderRoomDetail();
      }
      await loadRooms(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.action = false;
    }
  }

  async function createRoom() {
    var input = $('#create-room-id');
    var errorNode = $('#create-room-error');
    var button = $('#btn-create-room');
    if (!input) return;
    if (!validateRoomId(input, errorNode, true)) {
      input.focus();
      return;
    }

    var roomId = input.value.trim();
    setBusy(button, true);
    try {
      await adminRequest('/api/rooms/create', {
        method: 'POST',
        body: { id: roomId },
      });
      input.value = '';
      clearFieldError(input, errorNode);
      toast('已创建房间 ' + roomId, 'success');
      await loadRooms(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  async function broadcastAll() {
    var input = $('#broadcast-content');
    var errorNode = $('#broadcast-error');
    var button = $('#btn-broadcast');
    if (!input) return;

    var content = input.value.trim();
    if (!content) {
      setFieldError(input, errorNode, '请输入要发送的内容');
      input.focus();
      return;
    }
    clearFieldError(input, errorNode);

    setBusy(button, true);
    try {
      var data = await adminRequest('/api/say', {
        method: 'POST',
        body: { target: 'all', content: content },
      });
      input.value = '';
      toast('已向 ' + (data.rooms || 0) + ' 个房间发送管理消息', 'success');
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  /* ---------------- 玩家与封禁 ---------------- */

  function filteredUsers() {
    var query = state.playerSearch.trim().toLowerCase();
    var list = state.users || [];
    if (!query) return list;
    return list.filter(function (user) {
      return (
        String(user.id).toLowerCase().indexOf(query) !== -1 ||
        String(user.name || '').toLowerCase().indexOf(query) !== -1
      );
    });
  }

  function renderPlayers() {
    var tbody = $('#players-body');
    if (!tbody) return;
    clear(tbody);

    var users = filteredUsers();
    var emptyNode = $('#players-empty');
    var wrapNode = $('#players-wrap');
    if (emptyNode) {
      emptyNode.hidden = users.length > 0;
      emptyNode.textContent = state.playerSearch.trim()
        ? '没有匹配的玩家。'
        : '当前没有在线用户。';
    }
    if (wrapNode) wrapNode.hidden = users.length === 0;

    if (!users.length) return;

    users.forEach(function (user) {
      tbody.appendChild(
        el(
          'tr',
          {},
          el('td', { class: 'mono', text: String(user.id) }),
          el('td', { text: user.name || '—' }),
          el('td', { class: 'mono', text: user.room || '—' }),
          el('td', {}, tag(user.monitor ? '旁观' : '玩家', user.monitor ? 'tag-muted' : 'tag-ok')),
          el('td', {}, tag(user.online ? '在线' : '离线', user.online ? 'tag-ok' : 'tag-danger')),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'btn btn-danger btn-sm',
                type: 'button',
                onClick: function () { kickUser(user); },
              },
              '踢下线'
            )
          )
        )
      );
    });
  }

  async function kickUser(user) {
    if (state.busy.kick) return;
    var label = (user.name || '未命名') + '（' + user.id + '）';
    var ok = await confirmAction({
      title: '踢下线',
      message: '确定将“' + label + '”踢下线吗？玩家连接会被断开，可能需要重新登录。',
      confirmText: '踢下线',
      danger: true,
    });
    if (!ok) return;

    state.busy.kick = true;
    try {
      var data = await adminRequest('/api/admin/kick', {
        method: 'POST',
        body: { id: Number(user.id) },
      });
      if (data.kicked) {
        toast('已踢下线：' + (data.name || label), 'success');
      } else {
        toast('该玩家当前不在线', 'info');
      }
      await loadUsers(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.kick = false;
    }
  }

  async function loadBans(silent) {
    if (state.busy.bans) return;
    state.busy.bans = true;
    try {
      var data = await adminRequest('/api/admin/bans');
      state.bans = data.bans || [];
      renderBans();
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.bans = false;
    }
  }

  function renderBans() {
    var tbody = $('#bans-body');
    if (!tbody) return;
    clear(tbody);

    var bans = state.bans || [];
    var emptyNode = $('#bans-empty');
    var wrapNode = $('#bans-wrap');
    if (emptyNode) emptyNode.hidden = bans.length > 0;
    if (wrapNode) wrapNode.hidden = bans.length === 0;

    if (!bans.length) return;

    bans.forEach(function (ban) {
      var permanent = ban.expiresAt === null || ban.expiresAt === undefined;
      tbody.appendChild(
        el(
          'tr',
          {},
          el('td', {}, tag(banTypeLabel(ban.type), ban.type === 'user' ? 'tag-info' : 'tag-warn')),
          el('td', { class: 'mono', text: String(ban.value) }),
          el('td', { text: ban.reason || '—' }),
          el('td', { text: formatTime(ban.createdAt) }),
          el('td', {}, permanent ? tag('永久', 'tag-danger') : formatTime(ban.expiresAt)),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'btn btn-danger btn-sm',
                type: 'button',
                onClick: function () { removeBan(ban); },
              },
              '解除'
            )
          )
        )
      );
    });
  }

  async function createBan() {
    var typeSelect = $('#ban-type');
    var valueInput = $('#ban-value');
    var minutesInput = $('#ban-minutes');
    var reasonInput = $('#ban-reason');
    var errorNode = $('#ban-error');
    var button = $('#btn-ban');
    if (!typeSelect || !valueInput || !minutesInput) return;

    var type = typeSelect.value === 'user' ? 'user' : 'ip';
    var value = valueInput.value.trim();
    var minutesRaw = minutesInput.value.trim();
    var reason = reasonInput ? reasonInput.value.trim() : '';

    if (!value) {
      setFieldError(valueInput, errorNode, '请输入封禁值');
      valueInput.focus();
      return;
    }
    if (type === 'user') {
      if (!/^\d+$/.test(value) || Number(value) <= 0) {
        setFieldError(valueInput, errorNode, 'Phira ID 必须是正整数');
        valueInput.focus();
        return;
      }
    } else if (/\s/.test(value)) {
      setFieldError(valueInput, errorNode, 'IP 地址不能包含空格');
      valueInput.focus();
      return;
    }
    if (!/^\d+$/.test(minutesRaw)) {
      setFieldError(minutesInput, errorNode, '封禁时长必须是非负整数（分钟）');
      minutesInput.focus();
      return;
    }

    clearFieldError(valueInput, errorNode);
    clearFieldError(minutesInput, errorNode);
    if (reasonInput) clearFieldError(reasonInput, errorNode);

    setBusy(button, true);
    try {
      await adminRequest('/api/admin/ban', {
        method: 'POST',
        body: { type: type, value: value, minutes: Number(minutesRaw), reason: reason },
      });
      valueInput.value = '';
      if (reasonInput) reasonInput.value = '';
      toast('已添加封禁：' + value, 'success');
      await loadBans(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  async function removeBan(ban) {
    if (state.busy.ban) return;
    var ok = await confirmAction({
      title: '解除封禁',
      message: '确定解除对 ' + ban.value + ' 的' + banTypeLabel(ban.type) + '封禁吗？',
      confirmText: '解除封禁',
      danger: true,
    });
    if (!ok) return;

    state.busy.ban = true;
    try {
      var data = await adminRequest('/api/admin/ban', {
        method: 'DELETE',
        body: { type: ban.type, value: ban.value },
      });
      toast(data.removed ? '已解除封禁' : '该封禁已不存在', data.removed ? 'success' : 'info');
      await loadBans(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.ban = false;
    }
  }

  /* ---------------- 绑定 ---------------- */

  function bindingKey(binding) {
    return String(binding.platform) + ':' + String(binding.userId);
  }

  async function loadBindings(silent) {
    if (state.busy.bindings) return;
    state.busy.bindings = true;
    var requestedPage = state.bindingPage;
    var path =
      '/api/bindings?page=' +
      encodeURIComponent(requestedPage) +
      '&pageSize=' +
      encodeURIComponent(BINDINGS_PAGE_SIZE);
    if (state.bindingSearch) path += '&search=' + encodeURIComponent(state.bindingSearch);

    try {
      var data = await adminRequest(path);
      var pageSize = Number(data.pageSize) || BINDINGS_PAGE_SIZE;
      var total = Number(data.total) || 0;
      var totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (requestedPage > totalPages) {
        state.bindingPage = totalPages;
        state.busy.bindings = false;
        await loadBindings(silent);
        return;
      }
      state.bindingPage = requestedPage;
      state.bindingPageSize = pageSize;
      state.bindingTotal = total;
      state.bindings = data.bindings || [];
      state.selectedBindings = {};
      renderBindings();
      renderBindingsPager();
      markSync('已同步 ' + formatClock(Date.now()), false);
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.bindings = false;
    }
  }

  function renderBindings() {
    var tbody = $('#bindings-body');
    if (!tbody) return;
    clear(tbody);
    state.bindingRows = [];

    var bindings = state.bindings || [];
    var emptyNode = $('#bindings-empty');
    var wrapNode = $('#bindings-wrap');
    if (emptyNode) {
      emptyNode.hidden = bindings.length > 0;
      emptyNode.textContent = state.bindingSearch
        ? '没有匹配的绑定记录。'
        : '暂无绑定记录。';
    }
    if (wrapNode) wrapNode.hidden = bindings.length === 0;

    bindings.forEach(function (binding) {
      var key = bindingKey(binding);
      var checkbox = el('input', {
        class: 'checkbox',
        type: 'checkbox',
        'aria-label': '选择 ' + platformLabel(binding.platform) + ' ' + binding.userId,
      });
      checkbox.checked = Boolean(state.selectedBindings[key]);
      var row = el(
        'tr',
        { class: checkbox.checked ? 'is-selected' : null },
        el('td', { class: 'col-check' }, el('label', { class: 'check-tap' }, checkbox)),
        el('td', { text: platformLabel(binding.platform) }),
        el('td', { class: 'mono', text: String(binding.userId) }),
        el('td', { class: 'mono', text: String(binding.phiraId) }),
        el('td', { text: binding.phiraName || '—' }),
        el('td', { text: formatTime(binding.boundAt) })
      );
      checkbox.addEventListener('change', function () {
        setBindingSelected(key, checkbox.checked, row);
        updateBindingSelectionUI();
      });
      tbody.appendChild(row);
      state.bindingRows.push({ key: key, input: checkbox, row: row });
    });

    updateBindingSelectionUI();
  }

  function setBindingSelected(key, selected, row) {
    if (selected) {
      state.selectedBindings[key] = true;
    } else {
      delete state.selectedBindings[key];
    }
    if (row) row.classList.toggle('is-selected', Boolean(selected));
  }

  function updateBindingSelectionUI() {
    var count = Object.keys(state.selectedBindings).length;
    var total = state.bindingRows.length;
    var countNode = $('#bindings-selected-count');
    if (countNode) countNode.textContent = count ? '已选择 ' + count + ' 项' : '未选择';
    var batchButton = $('#btn-batch-unbind');
    if (batchButton) batchButton.disabled = count === 0;
    var selectAll = $('#bindings-select-all');
    if (selectAll) {
      selectAll.disabled = total === 0;
      selectAll.checked = total > 0 && count === total;
      selectAll.indeterminate = count > 0 && count < total;
    }
  }

  function renderBindingsPager() {
    var pageSize = state.bindingPageSize || BINDINGS_PAGE_SIZE;
    var totalPages = Math.max(1, Math.ceil(state.bindingTotal / pageSize));
    var info = $('#bindings-page-info');
    if (info) {
      info.textContent =
        '第 ' + state.bindingPage + ' / ' + totalPages + ' 页 · 共 ' + state.bindingTotal + ' 条';
    }
    var prev = $('#bindings-prev');
    var next = $('#bindings-next');
    if (prev) prev.disabled = state.bindingPage <= 1;
    if (next) next.disabled = state.bindingPage >= totalPages;
  }

  async function batchUnbind() {
    if (state.busy.unbind) return;
    var keys = Object.keys(state.selectedBindings).map(function (key) {
      var index = key.indexOf(':');
      return { platform: key.slice(0, index), userId: key.slice(index + 1) };
    });
    if (!keys.length) {
      toast('请先选择要解绑的绑定', 'error');
      return;
    }

    var ok = await confirmAction({
      title: '批量解绑',
      message: '确定解除选中的 ' + keys.length + ' 个绑定吗？解绑后对应 QQ 需要重新登录绑定。',
      confirmText: '批量解绑',
      danger: true,
    });
    if (!ok) return;

    var button = $('#btn-batch-unbind');
    state.busy.unbind = true;
    setBusy(button, true);
    try {
      var data = await adminRequest('/api/admin/bindings/unbind', {
        method: 'POST',
        body: { keys: keys },
      });
      toast('已解绑 ' + (data.unbound || 0) + ' 个绑定（共提交 ' + (data.total || keys.length) + ' 个）', 'success');
      state.selectedBindings = {};
      await loadBindings(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.unbind = false;
      setBusy(button, false);
      updateBindingSelectionUI();
    }
  }

  async function exportBindings() {
    if (state.busy.export) return;
    var button = $('#btn-export-bindings');
    state.busy.export = true;
    setBusy(button, true);
    try {
      var data = await adminRequest('/api/bindings');
      var bindings = (data && data.bindings) || [];
      var text = JSON.stringify(bindings, null, 2);
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'phira-bindings-' + formatFileDate(new Date()) + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      toast('已导出 ' + bindings.length + ' 条绑定', 'success');
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.export = false;
      setBusy(button, false);
    }
  }

  async function generateLink() {
    var input = $('#bind-qq');
    var errorNode = $('#bind-qq-error');
    var button = $('#btn-create-link');
    if (!input) return;
    if (!validateQq(input, errorNode, true)) {
      input.focus();
      return;
    }

    var qq = input.value.trim();
    setBusy(button, true);
    try {
      var data = await adminRequest('/api/login/link', {
        method: 'POST',
        body: { platform: 'qq', userId: qq },
      });
      showLink(data);
      toast('已生成绑定链接', 'success');
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  function showLink(data) {
    var box = $('#link-result');
    var anchor = $('#link-anchor');
    var expires = $('#link-expires');
    if (!box || !anchor) return;

    var link = data && data.link ? String(data.link) : '';
    state.lastLink = link;
    box.hidden = false;
    anchor.textContent = link || '—';
    if (/^https?:\/\//i.test(link)) {
      anchor.setAttribute('href', link);
    } else {
      anchor.removeAttribute('href');
    }
    if (expires) {
      expires.textContent = data && data.expiresAt ? '有效期至 ' + formatTime(data.expiresAt) : '';
    }
  }

  function copyLink() {
    var link = state.lastLink;
    if (!link) {
      toast('暂无可复制的链接', 'error');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(
        function () {
          toast('链接已复制', 'success');
        },
        function () {
          fallbackCopy(link);
        }
      );
      return;
    }
    fallbackCopy(link);
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (e) {
      copied = false;
    }
    if (area.parentNode) area.parentNode.removeChild(area);
    toast(copied ? '链接已复制' : '复制失败，请手动选择链接复制', copied ? 'success' : 'error');
  }

  /* ---------------- 公告 ---------------- */

  async function publishAnnounce() {
    var input = $('#announce-content');
    var errorNode = $('#announce-error');
    var button = $('#btn-announce');
    if (!input) return;

    var content = input.value.trim();
    if (!content) {
      setFieldError(input, errorNode, '请输入公告内容');
      input.focus();
      return;
    }
    clearFieldError(input, errorNode);

    var ok = await confirmAction({
      title: '发布公告',
      message: '确定向所有在线玩家发布这条公告吗？发送后无法撤回。',
      confirmText: '发布公告',
      danger: false,
    });
    if (!ok) return;

    setBusy(button, true);
    try {
      var data = await adminRequest('/api/announce', {
        method: 'POST',
        body: { content: content },
      });
      input.value = '';
      toast('公告已发送给 ' + (data.users || 0) + ' 名玩家', 'success');
    } catch (error) {
      handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  /* ---------------- 实时日志 ---------------- */

  function setStreamStatus(variant, text) {
    var node = $('#stream-status');
    if (!node) return;
    var className = 'tag-muted';
    if (variant === 'connected') className = 'tag-ok';
    else if (variant === 'connecting') className = 'tag-warn';
    else if (variant === 'error') className = 'tag-danger';
    node.className = 'tag ' + className;
    node.textContent = text;
  }

  function updateStreamButton() {
    var button = $('#btn-stream-toggle');
    if (!button) return;
    var active = Boolean(state.stream || state.streamTimer);
    button.textContent = active ? '停止实时' : '开始实时';
  }

  function appendLogLine(raw) {
    var pre = $('#log-stream');
    if (!pre) return;
    var line = raw;
    try {
      var parsed = JSON.parse(raw);
      if (typeof parsed === 'string') line = parsed;
    } catch (e) {
      /* 非 JSON 时按原文显示 */
    }
    if (state.streamLineCount === 0) pre.textContent = '';
    pre.appendChild(document.createTextNode(String(line) + '\n'));
    state.streamLineCount += 1;
    while (state.streamLineCount > LOG_LINE_LIMIT && pre.firstChild) {
      pre.removeChild(pre.firstChild);
      state.streamLineCount -= 1;
    }
    pre.scrollTop = pre.scrollHeight;
  }

  function clearStreamView() {
    var pre = $('#log-stream');
    state.streamLineCount = 0;
    if (pre) pre.textContent = state.stream ? '' : '尚未开始实时日志。';
  }

  function checkStreamAuth() {
    if (!state.authed || !state.token) return;
    request('/api/admin/config', { token: state.token })
      .then(function (data) {
        if (data && data.config) state.config = data.config;
      })
      .catch(function (error) {
        if (error.status === 401) expireSession('管理员登录已过期');
      });
  }

  function startLogStream() {
    if (!state.authed || !state.token) {
      toast('请先登录管理员面板', 'error');
      return;
    }
    if (state.stream) return;
    if (typeof EventSource === 'undefined') {
      setStreamStatus('error', '浏览器不支持 SSE');
      toast('当前浏览器不支持 EventSource', 'error');
      return;
    }
    var base = getApiBase();
    if (!base) {
      toast('尚未配置 API 地址', 'error');
      return;
    }

    state.streamManualStop = false;
    if (state.streamTimer) {
      clearTimeout(state.streamTimer);
      state.streamTimer = null;
    }

    var url = base + '/api/logs/stream?token=' + encodeURIComponent(state.token);
    var source;
    try {
      source = new EventSource(url);
    } catch (e) {
      setStreamStatus('error', '连接失败');
      scheduleStreamReconnect();
      updateStreamButton();
      return;
    }

    state.stream = source;
    setStreamStatus('connecting', '连接中…');
    updateStreamButton();

    source.addEventListener('log', function (event) {
      if (state.stream !== source) return;
      appendLogLine(event.data);
    });

    source.onopen = function () {
      if (state.stream !== source) return;
      setStreamStatus('connected', '已连接');
    };

    source.onerror = function () {
      if (state.stream !== source) return;
      state.stream = null;
      source.onopen = null;
      source.onerror = null;
      try {
        source.close();
      } catch (e) {
        /* 忽略关闭异常 */
      }
      if (state.streamManualStop) {
        setStreamStatus('stopped', '已停止');
        updateStreamButton();
        return;
      }
      setStreamStatus('error', '已断开，3 秒后重连');
      updateStreamButton();
      checkStreamAuth();
      scheduleStreamReconnect();
    };
  }

  function scheduleStreamReconnect() {
    if (state.streamManualStop || !state.authed) return;
    if (state.streamTimer) return;
    state.streamTimer = setTimeout(function () {
      state.streamTimer = null;
      if (state.streamManualStop || !state.authed) return;
      startLogStream();
    }, STREAM_RETRY_MS);
  }

  function stopLogStream(quiet) {
    state.streamManualStop = true;
    if (state.streamTimer) {
      clearTimeout(state.streamTimer);
      state.streamTimer = null;
    }
    var source = state.stream;
    state.stream = null;
    if (source) {
      source.onopen = null;
      source.onerror = null;
      try {
        source.close();
      } catch (e) {
        /* 忽略关闭异常 */
      }
    }
    if (!quiet) {
      setStreamStatus('stopped', '已停止');
      updateStreamButton();
    }
  }

  function toggleLogStream() {
    if (state.stream || state.streamTimer) {
      stopLogStream(false);
      return;
    }
    startLogStream();
  }

  async function loadLogs(silent) {
    if (state.busy.logs) return;
    state.busy.logs = true;

    var select = $('#log-lines');
    var lines = select ? Number(select.value) : state.logLines;
    if (!lines || lines < 1) lines = 200;
    state.logLines = lines;

    try {
      var data = await adminRequest('/api/logs?lines=' + encodeURIComponent(lines));
      renderLogs(data);
      markSync('已同步 ' + formatClock(Date.now()), false);
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.logs = false;
    }
  }

  function renderLogs(data) {
    var pre = $('#log-content');
    var fileNode = $('#log-file');
    if (fileNode) {
      fileNode.textContent = data && data.file ? '日志文件：' + data.file : '日志文件：—';
    }
    if (!pre) return;
    var lines = (data && data.lines) || [];
    pre.textContent = lines.length ? lines.join('\n') : '（日志为空）';
    pre.scrollTop = pre.scrollHeight;
  }

  /* ---------------- 系统设置 ---------------- */

  async function loadConfig(silent) {
    if (state.busy.config) return;
    state.busy.config = true;
    try {
      var data = await adminRequest('/api/admin/config');
      state.config = data.config || null;
      renderConfig();
    } catch (error) {
      handleError(error, silent);
    } finally {
      state.busy.config = false;
    }
  }

  function configuredTag(configured) {
    return tag(configured ? '已配置' : '未配置', configured ? 'tag-ok' : 'tag-muted');
  }

  function enabledTag(enabled) {
    return tag(enabled ? '已启用' : '已停用', enabled ? 'tag-ok' : 'tag-muted');
  }

  function renderConfig() {
    var grid = $('#config-grid');
    if (!grid) return;
    clear(grid);

    var config = state.config;
    if (!config) {
      grid.appendChild(el('p', { class: 'muted', text: '尚未加载服务端配置。' }));
      return;
    }

    grid.appendChild(metaItem('监听地址', config.host || '—'));
    grid.appendChild(metaItem('端口', config.port === undefined ? '—' : String(config.port)));
    grid.appendChild(metaItem('API 服务', enabledTag(Boolean(config.apiEnabled))));
    grid.appendChild(metaItem('access_token', configuredTag(Boolean(config.accessTokenConfigured))));
    grid.appendChild(metaItem('管理员密码', configuredTag(Boolean(config.adminPasswordConfigured))));
    grid.appendChild(metaItem('登录服务', enabledTag(Boolean(config.loginEnabled))));
    grid.appendChild(metaItem('QQ 机器人', enabledTag(Boolean(config.qqBotEnabled))));
    grid.appendChild(metaItem('客户端建房', enabledTag(Boolean(config.roomCreationAllowed))));
    grid.appendChild(metaItem('对外地址', config.publicUrl || '—'));
    grid.appendChild(metaItem('允许来源', listValue(config.allowedOrigins)));
    grid.appendChild(metaItem('保护接口', listValue(config.protectedPaths)));
    grid.appendChild(metaItem('公开接口', listValue(config.publicPaths)));
    grid.appendChild(metaItem('受信代理', listValue(config.trustedProxies)));

    var originsInput = $('#config-allowed-origins');
    if (originsInput) {
      originsInput.value = Array.isArray(config.allowedOrigins) ? config.allowedOrigins.join('\n') : '';
    }
  }

  async function saveAdminPassword() {
    var passwordInput = $('#config-admin-password');
    var confirmInput = $('#config-admin-password2');
    var errorNode = $('#config-password-error');
    var button = $('#btn-save-password');
    if (!passwordInput || !confirmInput) return;

    var password = passwordInput.value;
    var confirmation = confirmInput.value;

    clearFieldError(passwordInput, errorNode);
    clearFieldError(confirmInput, errorNode);

    if (!password) {
      setFieldError(passwordInput, errorNode, '请输入新密码');
      passwordInput.focus();
      return;
    }
    if (password.length < 6 || password.length > 64) {
      setFieldError(passwordInput, errorNode, '密码长度需为 6~64 位');
      passwordInput.focus();
      return;
    }
    if (password !== confirmation) {
      setFieldError(confirmInput, errorNode, '两次输入的密码不一致');
      confirmInput.focus();
      return;
    }

    setBusy(button, true);
    try {
      await adminRequest('/api/admin/config', {
        method: 'POST',
        body: { adminPassword: password },
      });
      passwordInput.value = '';
      confirmInput.value = '';
      toast('管理员密码已更新，当前会话保持有效', 'success');
      await loadConfig(true);
    } catch (error) {
      if (error.status !== 401) {
        setFieldError(passwordInput, errorNode, error.message);
        toast(error.message, 'error');
      } else {
        handleError(error, false);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function saveAccessToken() {
    var input = $('#config-access-token');
    var button = $('#btn-save-token');
    if (!input) return;
    var value = input.value.trim();

    setBusy(button, true);
    try {
      await adminRequest('/api/admin/config', {
        method: 'POST',
        body: { accessToken: value },
      });
      input.value = '';
      toast(value ? 'access_token 已更新，请同步更新 QQ 插件的 api_token' : '已清除 access_token', 'success');
      await loadConfig(true);
    } catch (error) {
      if (error.status !== 401) toast(error.message, 'error');
      else handleError(error, false);
    } finally {
      setBusy(button, false);
    }
  }

  async function saveAllowedOrigins() {
    var input = $('#config-allowed-origins');
    var errorNode = $('#config-origins-error');
    var button = $('#btn-save-origins');
    if (!input) return;

    var list = input.value
      .split('\n')
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return Boolean(item); });

    clearFieldError(input, errorNode);
    if (!list.length) {
      setFieldError(input, errorNode, '至少保留一个允许来源，可填写 *');
      input.focus();
      return;
    }

    setBusy(button, true);
    try {
      await adminRequest('/api/admin/config', {
        method: 'POST',
        body: { allowedOrigins: list },
      });
      toast('允许来源已更新', 'success');
      await loadConfig(true);
    } catch (error) {
      if (error.status !== 401) {
        setFieldError(input, errorNode, error.message);
        toast(error.message, 'error');
      } else {
        handleError(error, false);
      }
    } finally {
      setBusy(button, false);
    }
  }

  /* ---------------- API 地址设置弹层 ---------------- */

  function openSettings() {
    var modal = $('#admin-settings-modal');
    var input = $('#admin-api-base-input');
    var errorNode = $('#admin-api-base-error');
    if (!modal || !input) return;
    input.value = getApiBase();
    clearFieldError(input, errorNode);
    modal.hidden = false;
    setTimeout(function () {
      input.focus();
    }, 0);
  }

  function closeSettings() {
    var modal = $('#admin-settings-modal');
    if (modal) modal.hidden = true;
  }

  function saveSettings() {
    var input = $('#admin-api-base-input');
    var errorNode = $('#admin-api-base-error');
    if (!input) return;

    var parsed = parseApiBase(input.value);
    if (parsed.error) {
      setFieldError(input, errorNode, parsed.error);
      input.focus();
      return;
    }

    clearFieldError(input, errorNode);
    storageSet(STORAGE_API, parsed.base);
    closeSettings();
    updateApiChip();

    var loginBase = $('#admin-api-base');
    if (loginBase) loginBase.value = parsed.base;

    toast('已保存 API 地址', 'success');

    if (state.authed) {
      verifySession();
    } else {
      showLogin();
    }
  }

  /* ---------------- 自动刷新 ---------------- */

  function autoRefresh() {
    if (!state.authed) return;
    if (document.visibilityState !== 'visible') return;

    if (state.activeTab === 'overview') {
      loadStatus(true);
      loadUsers(true);
    } else if (state.activeTab === 'rooms') {
      loadRooms(true);
      if (state.selectedRoomId) loadRoomDetail(state.selectedRoomId, true);
    } else if (state.activeTab === 'players') {
      loadUsers(true);
      loadBans(true);
    }
  }

  function refreshActiveTab() {
    if (!state.authed) return;
    if (state.activeTab === 'overview') {
      loadStatus(false);
      loadUsers(false);
    } else if (state.activeTab === 'rooms') {
      loadRooms(false);
      if (state.selectedRoomId) loadRoomDetail(state.selectedRoomId, true);
    } else if (state.activeTab === 'players') {
      loadUsers(false);
      loadBans(false);
    } else if (state.activeTab === 'bindings') {
      loadBindings(false);
    } else if (state.activeTab === 'logs') {
      loadLogs(false);
    } else if (state.activeTab === 'settings') {
      loadConfig(false);
    }
  }

  /* ---------------- 初始化 ---------------- */

  function bindInputGuards() {
    var playerSearch = $('#players-search');
    if (playerSearch) {
      playerSearch.addEventListener('input', function () {
        state.playerSearch = playerSearch.value;
        renderPlayers();
      });
    }

    var banType = $('#ban-type');
    if (banType) {
      banType.addEventListener('change', function () {
        var valueInput = $('#ban-value');
        if (valueInput) {
          valueInput.placeholder = banType.value === 'user' ? '例如 12345' : '例如 203.0.113.7';
        }
        clearFieldError(valueInput, $('#ban-error'));
        clearFieldError($('#ban-minutes'), $('#ban-error'));
      });
    }

    ['#ban-value', '#ban-minutes', '#ban-reason'].forEach(function (selector) {
      var input = $(selector);
      if (!input) return;
      input.addEventListener('input', function () {
        clearFieldError(input, $('#ban-error'));
      });
      if (selector !== '#ban-reason') {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            createBan();
          }
        });
      }
    });

    var bindingsSearch = $('#bindings-search');
    if (bindingsSearch) {
      bindingsSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          state.bindingSearch = bindingsSearch.value.trim();
          state.bindingPage = 1;
          loadBindings(false);
        }
      });
    }

    ['#config-admin-password', '#config-admin-password2'].forEach(function (selector) {
      var input = $(selector);
      if (!input) return;
      input.addEventListener('input', function () {
        clearFieldError($('#config-admin-password'), $('#config-password-error'));
        clearFieldError($('#config-admin-password2'), $('#config-password-error'));
      });
    });

    var originsInput = $('#config-allowed-origins');
    if (originsInput) {
      originsInput.addEventListener('input', function () {
        clearFieldError(originsInput, $('#config-origins-error'));
      });
    }
  }

  function bindEvents() {
    var loginForm = $('#admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function (event) {
        attemptLogin(event);
      });
    }

    var nav = $('#admin-nav');
    if (nav) {
      nav.addEventListener('click', function (event) {
        var target = event.target.closest ? event.target.closest('.nav-btn') : null;
        if (!target) return;
        var tab = target.getAttribute('data-tab');
        if (tab) switchTab(tab);
      });
    }

    var logoutButton = $('#admin-logout');
    if (logoutButton) logoutButton.addEventListener('click', handleLogout);

    var refreshButton = $('#admin-refresh');
    if (refreshButton) refreshButton.addEventListener('click', refreshActiveTab);

    var settingsButton = $('#admin-settings');
    if (settingsButton) settingsButton.addEventListener('click', openSettings);

    var cancelSettings = $('#btn-admin-settings-cancel');
    if (cancelSettings) cancelSettings.addEventListener('click', closeSettings);

    var saveSettingsButton = $('#btn-admin-settings-save');
    if (saveSettingsButton) saveSettingsButton.addEventListener('click', saveSettings);

    var settingsModal = $('#admin-settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', function (event) {
        if (event.target === settingsModal) closeSettings();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var modal = $('#admin-settings-modal');
      if (modal && !modal.hidden) closeSettings();
    });

    var baseModalInput = $('#admin-api-base-input');
    if (baseModalInput) {
      baseModalInput.addEventListener('input', function () {
        clearFieldError(baseModalInput, $('#admin-api-base-error'));
      });
      baseModalInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveSettings();
        }
      });
    }

    var creationButton = $('#btn-room-creation');
    if (creationButton) creationButton.addEventListener('click', toggleRoomCreation);

    var roomsRefresh = $('#rooms-refresh');
    if (roomsRefresh) roomsRefresh.addEventListener('click', function () { loadRooms(false); });

    var createButton = $('#btn-create-room');
    if (createButton) createButton.addEventListener('click', createRoom);

    var createInput = $('#create-room-id');
    if (createInput) {
      createInput.addEventListener('input', function () {
        validateRoomId(createInput, $('#create-room-error'), false);
      });
      createInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          createRoom();
        }
      });
    }

    var broadcastButton = $('#btn-broadcast');
    if (broadcastButton) broadcastButton.addEventListener('click', broadcastAll);

    var broadcastInput = $('#broadcast-content');
    if (broadcastInput) {
      broadcastInput.addEventListener('input', function () {
        clearFieldError(broadcastInput, $('#broadcast-error'));
      });
      broadcastInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          broadcastAll();
        }
      });
    }

    var closeDetail = $('#btn-admin-close-detail');
    if (closeDetail) {
      closeDetail.addEventListener('click', function () {
        state.selectedRoomId = '';
        state.selectedRoom = null;
        renderRooms();
        renderRoomDetail();
      });
    }

    var playersRefresh = $('#players-refresh');
    if (playersRefresh) {
      playersRefresh.addEventListener('click', function () {
        loadUsers(false);
        loadBans(false);
      });
    }

    var banButton = $('#btn-ban');
    if (banButton) banButton.addEventListener('click', createBan);

    var bansRefresh = $('#bans-refresh');
    if (bansRefresh) bansRefresh.addEventListener('click', function () { loadBans(false); });

    var bindingsRefresh = $('#bindings-refresh');
    if (bindingsRefresh) {
      bindingsRefresh.addEventListener('click', function () { loadBindings(false); });
    }

    var bindingsSearchButton = $('#btn-bindings-search');
    if (bindingsSearchButton) {
      bindingsSearchButton.addEventListener('click', function () {
        var searchInput = $('#bindings-search');
        state.bindingSearch = searchInput ? searchInput.value.trim() : '';
        state.bindingPage = 1;
        loadBindings(false);
      });
    }

    var selectAll = $('#bindings-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        var checked = Boolean(selectAll.checked);
        state.selectedBindings = {};
        state.bindingRows.forEach(function (row) {
          row.input.checked = checked;
          row.row.classList.toggle('is-selected', checked);
          if (checked) state.selectedBindings[row.key] = true;
        });
        updateBindingSelectionUI();
      });
    }

    var batchButton = $('#btn-batch-unbind');
    if (batchButton) batchButton.addEventListener('click', batchUnbind);

    var exportButton = $('#btn-export-bindings');
    if (exportButton) exportButton.addEventListener('click', exportBindings);

    var bindingsPrev = $('#bindings-prev');
    if (bindingsPrev) {
      bindingsPrev.addEventListener('click', function () {
        if (state.bindingPage <= 1) return;
        state.bindingPage -= 1;
        loadBindings(false);
      });
    }

    var bindingsNext = $('#bindings-next');
    if (bindingsNext) {
      bindingsNext.addEventListener('click', function () {
        var totalPages = Math.max(
          1,
          Math.ceil(state.bindingTotal / (state.bindingPageSize || BINDINGS_PAGE_SIZE))
        );
        if (state.bindingPage >= totalPages) return;
        state.bindingPage += 1;
        loadBindings(false);
      });
    }

    var linkButton = $('#btn-create-link');
    if (linkButton) linkButton.addEventListener('click', generateLink);

    var qqInput = $('#bind-qq');
    if (qqInput) {
      qqInput.addEventListener('input', function () {
        validateQq(qqInput, $('#bind-qq-error'), false);
      });
      qqInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          generateLink();
        }
      });
    }

    var copyButton = $('#btn-copy-link');
    if (copyButton) copyButton.addEventListener('click', copyLink);

    var announceButton = $('#btn-announce');
    if (announceButton) announceButton.addEventListener('click', publishAnnounce);

    var announceInput = $('#announce-content');
    if (announceInput) {
      announceInput.addEventListener('input', function () {
        clearFieldError(announceInput, $('#announce-error'));
      });
    }

    var logsRefresh = $('#logs-refresh');
    if (logsRefresh) logsRefresh.addEventListener('click', function () { loadLogs(false); });

    var logLines = $('#log-lines');
    if (logLines) {
      logLines.addEventListener('change', function () {
        state.logLines = Number(logLines.value) || 200;
        loadLogs(false);
      });
    }

    var streamToggle = $('#btn-stream-toggle');
    if (streamToggle) streamToggle.addEventListener('click', toggleLogStream);

    var streamClear = $('#btn-stream-clear');
    if (streamClear) streamClear.addEventListener('click', clearStreamView);

    var settingsRefresh = $('#settings-refresh');
    if (settingsRefresh) settingsRefresh.addEventListener('click', function () { loadConfig(false); });

    var savePasswordButton = $('#btn-save-password');
    if (savePasswordButton) savePasswordButton.addEventListener('click', saveAdminPassword);

    var saveTokenButton = $('#btn-save-token');
    if (saveTokenButton) saveTokenButton.addEventListener('click', saveAccessToken);

    var saveOriginsButton = $('#btn-save-origins');
    if (saveOriginsButton) saveOriginsButton.addEventListener('click', saveAllowedOrigins);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.authed) autoRefresh();
    });

    window.addEventListener('beforeunload', function () {
      stopLogStream(true);
    });
    window.addEventListener('pagehide', function () {
      stopLogStream(true);
    });

    bindInputGuards();
  }

  function init() {
    var siteName = CONFIG.siteName || 'Phira 管理面板';
    var siteNode = $('#admin-site-name');
    if (siteNode) siteNode.textContent = siteName;
    document.title = siteName + ' · 管理员';

    bindEvents();

    var baseInput = $('#admin-api-base');
    var details = $('#admin-api-details');
    if (baseInput) baseInput.value = getApiBase();
    if (details) details.open = !getApiBase();
    updateApiChip();
    updateStreamButton();

    if (state.token && getApiBase()) {
      verifySession();
    } else {
      showLogin();
      if (!getApiBase()) setLoginError('请先填写 API 地址');
    }

    setInterval(function () {
      autoRefresh();
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
