/* Phira 管理员面板逻辑（无构建、无依赖） */
(function () {
  'use strict';

  var CONFIG = window.PHIRA_CONFIG || {};
  var STORAGE_API = 'phira_api_base';
  var STORAGE_TOKEN = 'phira_admin_token';
  var REFRESH_MS = 8000;

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
      throw new ApiError('尚未配置 API 地址，请先在“设置”中填写服务器地址', 0);
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

  function stateLabel(state) {
    switch (state) {
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

  function stateTagClass(state) {
    if (state === 'WaitForReady') return 'tag-warn';
    if (state === 'Playing') return 'tag-info';
    return 'tag-muted';
  }

  function platformLabel(platform) {
    if (!platform) return '—';
    if (String(platform).toLowerCase() === 'qq') return 'QQ';
    return String(platform);
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
    bindings: [],
    selectedRoomId: '',
    selectedRoom: null,
    activeTab: 'overview',
    logLines: 200,
    lastLink: '',
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
    state.bindings = [];
    state.selectedRoomId = '';
    state.selectedRoom = null;
  }

  function showLogin() {
    var loginView = $('#admin-login-view');
    var appView = $('#admin-app-view');
    var nav = $('#admin-nav');
    var logoutButton = $('#admin-logout');
    var baseInput = $('#admin-api-base');
    var tokenInput = $('#admin-token');
    if (loginView) loginView.hidden = false;
    if (appView) appView.hidden = true;
    if (nav) nav.hidden = true;
    if (logoutButton) logoutButton.hidden = true;
    if (baseInput) baseInput.value = getApiBase();
    if (tokenInput) tokenInput.value = state.token || '';
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
    state.authed = false;
    state.token = '';
    storageSet(STORAGE_TOKEN, '');
    resetData();
    showLogin();
    setLoginError(message);
    markSync('尚未同步', false);
    toast(message, 'error');
  }

  function handleError(error, silent) {
    if (error.status === 401) {
      expireSession('访问令牌无效或已失效，请重新登录');
      return;
    }
    markSync('请求失败：' + error.message, true);
    if (!silent) toast(error.message, 'error');
  }

  /* ---------------- 登录 ---------------- */

  async function attemptLogin(silent) {
    var baseInput = $('#admin-api-base');
    var tokenInput = $('#admin-token');
    var submitButton = $('#admin-login-submit');
    if (!baseInput || !tokenInput) return;

    var base = normalizeBase(baseInput.value);
    if (!base) {
      setLoginError('请填写 API 地址');
      if (!silent) toast('请填写 API 地址', 'error');
      baseInput.focus();
      return;
    }

    var parsed = null;
    try {
      parsed = new URL(base);
    } catch (e) {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      setLoginError('API 地址需要以 http:// 或 https:// 开头');
      if (!silent) toast('API 地址需要以 http:// 或 https:// 开头', 'error');
      baseInput.focus();
      return;
    }

    storageSet(STORAGE_API, base);
    updateApiChip();

    var token = tokenInput.value.trim();
    setBusy(submitButton, true);
    setLoginError('');
    try {
      var status = await request('/api/status', { token: token || undefined });
      state.token = token;
      state.authed = true;
      state.status = status;
      storageSet(STORAGE_TOKEN, token);
      setLoginError('');
      showApp();
      switchTab(state.activeTab || 'overview');
      if (!silent) toast('登录成功', 'success');
    } catch (error) {
      setLoginError(
        error.status === 401 ? '访问令牌无效，请检查后重试' : error.message
      );
      if (!silent) toast(error.message, 'error');
      if (!state.authed) showLogin();
    } finally {
      setBusy(submitButton, false);
    }
  }

  async function handleLogout() {
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

  function switchTab(tab) {
    var valid = ['overview', 'rooms', 'bindings', 'announce', 'logs'];
    if (valid.indexOf(tab) === -1) tab = 'overview';
    state.activeTab = tab;

    var buttons = document.querySelectorAll('#admin-nav .nav-btn');
    Array.prototype.forEach.call(buttons, function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-tab') === tab);
    });

    valid.forEach(function (name) {
      var panel = $('#tab-' + name);
      if (panel) panel.hidden = name !== tab;
    });

    if (tab === 'overview') {
      loadStatus(false);
      loadUsers(false);
    } else if (tab === 'rooms') {
      loadRooms(false);
    } else if (tab === 'bindings') {
      loadBindings(false);
    } else if (tab === 'logs') {
      loadLogs(false);
    }
  }

  /* ---------------- 概览 ---------------- */

  async function loadStatus(silent) {
    if (state.busy.status) return;
    state.busy.status = true;
    try {
      state.status = await request('/api/status', { token: state.token || undefined });
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
      var data = await request('/api/users', { token: state.token || undefined });
      state.users = data.users || [];
      renderUsers();
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
      var data = await request('/api/room-creation', {
        method: 'POST',
        token: state.token || undefined,
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
      var data = await request('/api/rooms?all=1', { token: state.token || undefined });
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
      var data = await request('/api/room?id=' + encodeURIComponent(roomId), {
        token: state.token || undefined,
      });
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
      await request('/api/room/action', {
        method: 'POST',
        token: state.token || undefined,
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
      await request('/api/say', {
        method: 'POST',
        token: state.token || undefined,
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
      var data = await request('/api/rooms/delete', {
        method: 'POST',
        token: state.token || undefined,
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
      await request('/api/rooms/create', {
        method: 'POST',
        token: state.token || undefined,
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
      var data = await request('/api/say', {
        method: 'POST',
        token: state.token || undefined,
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

  /* ---------------- 绑定 ---------------- */

  async function loadBindings(silent) {
    if (state.busy.bindings) return;
    state.busy.bindings = true;
    try {
      var data = await request('/api/bindings', { token: state.token || undefined });
      state.bindings = data.bindings || [];
      renderBindings();
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

    var bindings = state.bindings || [];
    var emptyNode = $('#bindings-empty');
    var wrapNode = $('#bindings-wrap');
    if (emptyNode) emptyNode.hidden = bindings.length > 0;
    if (wrapNode) wrapNode.hidden = bindings.length === 0;

    if (!bindings.length) return;

    bindings.forEach(function (binding) {
      tbody.appendChild(
        el(
          'tr',
          {},
          el('td', { text: platformLabel(binding.platform) }),
          el('td', { class: 'mono', text: String(binding.userId) }),
          el('td', { class: 'mono', text: String(binding.phiraId) }),
          el('td', { text: binding.phiraName || '—' }),
          el('td', { text: formatTime(binding.boundAt) }),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'btn btn-danger btn-sm',
                type: 'button',
                onClick: function () { unbind(binding); },
              },
              '解绑'
            )
          )
        )
      );
    });
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
      var data = await request('/api/login/link', {
        method: 'POST',
        token: state.token || undefined,
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

  async function unbind(binding) {
    if (state.busy.action) return;
    var ok = await confirmAction({
      title: '解除绑定',
      message:
        '确定解除 QQ ' +
        binding.userId +
        ' 与 Phira 账号 ' +
        (binding.phiraName || '') +
        '（' +
        binding.phiraId +
        '）的绑定吗？解绑后该 QQ 需要重新登录绑定。',
      confirmText: '解除绑定',
      danger: true,
    });
    if (!ok) return;

    state.busy.action = true;
    try {
      await request('/api/login/binding', {
        method: 'DELETE',
        token: state.token || undefined,
        body: { platform: binding.platform, userId: binding.userId },
      });
      toast('已解除绑定', 'success');
      await loadBindings(true);
    } catch (error) {
      handleError(error, false);
    } finally {
      state.busy.action = false;
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
      var data = await request('/api/announce', {
        method: 'POST',
        token: state.token || undefined,
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

  /* ---------------- 日志 ---------------- */

  async function loadLogs(silent) {
    if (state.busy.logs) return;
    state.busy.logs = true;

    var select = $('#log-lines');
    var lines = select ? Number(select.value) : state.logLines;
    if (!lines || lines < 1) lines = 200;
    state.logLines = lines;

    try {
      var data = await request('/api/logs?lines=' + encodeURIComponent(lines), {
        token: state.token || undefined,
      });
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

  /* ---------------- 设置弹层 ---------------- */

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

    var value = normalizeBase(input.value);
    if (!value) {
      setFieldError(input, errorNode, '请填写 API 地址');
      input.focus();
      return;
    }

    var parsed = null;
    try {
      parsed = new URL(value);
    } catch (e) {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      setFieldError(input, errorNode, '地址需要以 http:// 或 https:// 开头');
      input.focus();
      return;
    }

    clearFieldError(input, errorNode);
    storageSet(STORAGE_API, value);
    closeSettings();
    updateApiChip();

    var loginBase = $('#admin-api-base');
    if (loginBase) loginBase.value = value;

    toast('已保存 API 地址', 'success');

    if (state.authed) {
      if (state.activeTab === 'overview') {
        loadStatus(true);
        loadUsers(true);
      } else if (state.activeTab === 'rooms') {
        loadRooms(true);
      } else if (state.activeTab === 'bindings') {
        loadBindings(true);
      } else if (state.activeTab === 'logs') {
        loadLogs(true);
      }
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
    } else if (state.activeTab === 'bindings') {
      loadBindings(true);
    } else if (state.activeTab === 'logs') {
      loadLogs(true);
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
    } else if (state.activeTab === 'bindings') {
      loadBindings(false);
    } else if (state.activeTab === 'logs') {
      loadLogs(false);
    }
  }

  /* ---------------- 初始化 ---------------- */

  function bindEvents() {
    var loginForm = $('#admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        attemptLogin(false);
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

    var bindingsRefresh = $('#bindings-refresh');
    if (bindingsRefresh) {
      bindingsRefresh.addEventListener('click', function () { loadBindings(false); });
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

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.authed) autoRefresh();
    });
  }

  function init() {
    var siteName = CONFIG.siteName || 'Phira 管理面板';
    var siteNode = $('#admin-site-name');
    if (siteNode) siteNode.textContent = siteName;
    document.title = siteName + ' · 管理员';

    bindEvents();

    var baseInput = $('#admin-api-base');
    var tokenInput = $('#admin-token');
    if (baseInput) baseInput.value = getApiBase();
    if (tokenInput) tokenInput.value = state.token || '';
    updateApiChip();

    if (state.token && getApiBase()) {
      attemptLogin(true);
    } else if (!getApiBase()) {
      showLogin();
      setLoginError('请先填写 API 地址');
    } else {
      showLogin();
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
