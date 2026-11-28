/* Phira 玩家面板逻辑 + 公共 API 工具（无构建、无依赖） */
(function () {
  'use strict';

  var CONFIG = window.PHIRA_CONFIG || {};
  var STORAGE_TOKEN = 'phira_web_token';
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
      /* 隐私模式下可能禁用 localStorage，忽略即可 */
    }
  }

  function normalizeBase(value) {
    return String(value === null || value === undefined ? '' : value)
      .trim()
      .replace(/\/+$/, '');
  }

  function getApiBase() {
    // 玩家面板固定使用部署配置，普通用户不能修改 API 地址
    return normalizeBase(CONFIG.apiBase);
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
      throw new ApiError('服务器地址未配置，请联系管理员', 0);
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
      throw new ApiError('无法连接服务器，请检查网络或联系管理员', 0);
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

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
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

  function validateChartInput(input, errorNode, required) {
    var raw = input.value.trim();
    if (!raw) {
      if (required) {
        setFieldError(input, errorNode, '请输入谱面 ID');
        return false;
      }
      clearFieldError(input, errorNode);
      return false;
    }
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      setFieldError(input, errorNode, '谱面 ID 必须是正整数');
      return false;
    }
    clearFieldError(input, errorNode);
    return true;
  }

  /* ---------------- 玩家面板状态 ---------------- */

  var state = {
    token: storageGet(STORAGE_TOKEN),
    me: null,
    rooms: [],
    selectedRoomId: '',
    selectedRoom: null,
    refreshing: false,
    actionPending: false,
    lastSync: 0,
  };

  function setSync(text, isError) {
    var node = $('#sync-status');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('is-error', Boolean(isError));
  }

  function saveToken(token) {
    state.token = token || '';
    storageSet(STORAGE_TOKEN, state.token);
  }

  function showLogin() {
    var loginView = $('#login-view');
    var appView = $('#app-view');
    if (loginView) loginView.hidden = false;
    if (appView) appView.hidden = true;
    var chip = $('#user-chip');
    var logoutButton = $('#btn-logout');
    if (chip) chip.hidden = true;
    if (logoutButton) logoutButton.hidden = true;
  }

  function showApp() {
    var loginView = $('#login-view');
    var appView = $('#app-view');
    if (loginView) loginView.hidden = true;
    if (appView) appView.hidden = false;
    var logoutButton = $('#btn-logout');
    if (logoutButton) logoutButton.hidden = false;
  }

  function setLoginError(message) {
    var node = $('#login-error');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function updateUserChip() {
    var chip = $('#user-chip');
    var nameNode = $('#user-name');
    var avatarNode = $('#user-avatar');
    if (!chip || !nameNode || !avatarNode) return;
    if (!state.me || !state.me.user) {
      chip.hidden = true;
      return;
    }
    var name = state.me.user.name || 'Phira ' + state.me.user.id;
    nameNode.textContent = name;
    avatarNode.textContent = String(name).slice(0, 1).toUpperCase();
    chip.hidden = false;
  }

  function sessionExpired(message) {
    saveToken('');
    state.me = null;
    state.rooms = [];
    state.selectedRoomId = '';
    state.selectedRoom = null;
    state.lastSync = 0;
    showLogin();
    updateUserChip();
    setLoginError(message);
    setSync('尚未同步', false);
    toast(message, 'error');
  }

  function handleSyncError(error, manual) {
    if (error.status === 401) {
      sessionExpired('登录已过期，请重新登录');
      return;
    }
    setSync('同步失败：' + error.message, true);
    if (manual) toast(error.message, 'error');
  }

  function handleActionError(error) {
    if (error.status === 401) {
      sessionExpired('登录已过期，请重新登录');
      return;
    }
    toast(error.message, 'error');
  }

  /* ---------------- 数据刷新 ---------------- */

  async function refreshAll(manual) {
    if (state.refreshing) return;
    if (!state.token) {
      showLogin();
      return;
    }
    state.refreshing = true;
    try {
      var results = await Promise.all([
        request('/api/web/me', { token: state.token }),
        request('/api/rooms'),
      ]);
      state.me = results[0];
      state.rooms = (results[1] && results[1].rooms) || [];

      if (state.selectedRoomId) {
        try {
          var detail = await request('/api/room?id=' + encodeURIComponent(state.selectedRoomId));
          state.selectedRoom = detail.room;
        } catch (detailError) {
          if (detailError.status === 404) {
            state.selectedRoomId = '';
            state.selectedRoom = null;
            if (manual) toast('所选房间已不存在', 'info');
          }
        }
      }

      state.lastSync = Date.now();
      renderAll();
      setSync('已同步 ' + formatClock(state.lastSync), false);
    } catch (error) {
      handleSyncError(error, manual);
    } finally {
      state.refreshing = false;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function renderAll() {
    updateUserChip();
    renderMyRoom();
    renderRooms();
    renderRoomDetail();
    renderAccount();
  }

  function renderMyRoom() {
    var box = $('#my-room');
    if (!box) return;
    clear(box);

    if (!state.me) {
      box.appendChild(loadingState('正在加载账号信息…'));
      return;
    }

    var room = state.me.room;
    if (!room) {
      box.appendChild(
        el(
          'div',
          { class: 'empty' },
          el('p', { class: 'empty-title', text: '你当前不在房间中' }),
          el('p', { class: 'muted', text: '请先在 Phira 游戏客户端进入本服务器的房间，然后点击刷新。' }),
          el(
            'button',
            {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              onClick: function () { refreshAll(true); },
            },
            '立即刷新'
          )
        )
      );
      return;
    }

    box.appendChild(buildRoomSummary(room));

    var groups = el('div', { class: 'control-groups' });
    if (room.isHost) groups.appendChild(buildHostControls(room));
    groups.appendChild(buildMemberControls(room));
    box.appendChild(groups);
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
          room.live ? tag('旁观直播', 'tag-info') : null,
          room.isHost ? tag('我是房主', 'tag-ok') : null
        )
      )
    );

    wrap.appendChild(
      el(
        'div',
        { class: 'meta-grid' },
        metaItem(
          '房主',
          room.host ? room.host.name + '（' + room.host.id + '）' : '暂无房主'
        ),
        metaItem(
          '谱面',
          room.chart ? room.chart.name + '（' + room.chart.id + '）' : '未选谱'
        ),
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
        el(
          'tr',
          {},
          el('td', { colspan: '4', class: 'muted', text: '房间内暂无成员。' })
        )
      );
    } else {
      members.forEach(function (member) {
        tbody.appendChild(
          el(
            'tr',
            { class: state.me && state.me.user && member.id === state.me.user.id ? 'is-self' : null },
            el('td', { class: 'mono', text: String(member.id) }),
            el('td', { text: member.name || '—' }),
            el('td', {}, tag(member.monitor ? '旁观' : '玩家', member.monitor ? 'tag-muted' : 'tag-ok')),
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

  function buildHostControls(room) {
    var selectPhase = room.state === 'SelectChart';
    var hasChart = Boolean(room.chart);
    var members = room.members || [];
    var group = el(
      'div',
      { class: 'control-group' },
      el('div', { class: 'control-title', text: '房主操作' })
    );

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        actionButton(room.locked ? '解锁房间' : '锁定房间', '', false, '', function () {
          runRoomAction('lock', { locked: !room.locked }, { successText: room.locked ? '房间已解锁' : '房间已锁定' });
        }),
        actionButton(room.cycle ? '关闭轮换' : '开启轮换', '', false, '', function () {
          runRoomAction('cycle', { enabled: !room.cycle }, { successText: room.cycle ? '已关闭轮换' : '已开启轮换' });
        })
      )
    );

    var chartInput = el('input', {
      class: 'input',
      id: 'chart-id-input',
      type: 'number',
      min: '1',
      step: '1',
      inputmode: 'numeric',
      placeholder: '谱面 ID',
    });
    var chartError = el('p', { class: 'field-error', hidden: true });
    chartInput.addEventListener('input', function () {
      validateChartInput(chartInput, chartError, false);
    });

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'chart-id-input', text: '谱面 ID' }),
          chartInput,
          chartError
        ),
        actionButton(
          '选择谱面',
          'btn-primary',
          !selectPhase,
          '仅在未开始阶段可以选择谱面',
          function () {
            if (!validateChartInput(chartInput, chartError, true)) return;
            runRoomAction('select-chart', { chartId: Number(chartInput.value.trim()) }, { successText: '已提交选谱' });
          }
        )
      )
    );

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        actionButton(
          '开始游戏',
          'btn-primary',
          !selectPhase || !hasChart,
          !selectPhase ? '仅在未开始阶段可以开始游戏' : '请先选择谱面',
          function () {
            runRoomAction('start', {}, { successText: '已开始游戏' });
          }
        ),
        !hasChart ? el('span', { class: 'hint', text: '开始游戏前需要先选择谱面。' }) : null
      )
    );

    var targetInput = el('input', {
      class: 'input',
      id: 'target-input',
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
          el('label', { for: 'target-input', text: '目标玩家' }),
          targetInput
        ),
        actionButton(
          '踢出房间',
          'btn-danger',
          members.length === 0,
          '房间内没有可踢出的成员',
          function () {
            var target = parseTarget(targetInput.value);
            if (!target) {
              toast('请输入玩家 ID 或昵称', 'error');
              targetInput.focus();
              return;
            }
            var label = targetInput.value.trim();
            confirmAction({
              title: '踢出玩家',
              message: '确定将“' + label + '”踢出房间吗？该操作会立即生效。',
              confirmText: '踢出',
              danger: true,
            }).then(function (ok) {
              if (ok) runRoomAction('kick', target, { successText: '已踢出目标玩家' });
            });
          }
        ),
        actionButton(
          '转让房主',
          'btn-ghost',
          members.length === 0,
          '房间内没有其他成员',
          function () {
            var target = parseTarget(targetInput.value);
            if (!target) {
              toast('请输入玩家 ID 或昵称', 'error');
              targetInput.focus();
              return;
            }
            var label = targetInput.value.trim();
            confirmAction({
              title: '转让房主',
              message: '确定将房主转让给“' + label + '”吗？转让后你将失去房主权限。',
              confirmText: '转让',
              danger: true,
            }).then(function (ok) {
              if (ok) runRoomAction('set-host', target, { successText: '已转让房主' });
            });
          }
        )
      )
    );

    var reasons = [];
    if (!selectPhase) reasons.push('选谱与开始游戏仅在“未开始”阶段可用。');
    if (selectPhase && !hasChart) reasons.push('开始游戏前需要先选择谱面。');
    if (reasons.length) {
      group.appendChild(
        el(
          'ul',
          { class: 'hint-list' },
          reasons.map(function (reason) {
            return el('li', { text: reason });
          })
        )
      );
    }

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        actionButton('解散房间', 'btn-danger', false, '', function () {
          confirmAction({
            title: '解散房间',
            message: '确定解散房间“' + room.id + '”吗？房间内所有成员都会被移出，且无法恢复。',
            confirmText: '解散房间',
            danger: true,
          }).then(function (ok) {
            if (ok) runRoomAction('dissolve', {}, { successText: '房间已解散' });
          });
        })
      )
    );

    return group;
  }

  function buildMemberControls(room) {
    var readyPhase = room.state === 'WaitForReady';
    var playing = room.state === 'Playing';
    var group = el(
      'div',
      { class: 'control-group' },
      el('div', { class: 'control-title', text: '成员操作' })
    );

    group.appendChild(
      el(
        'div',
        { class: 'control-row' },
        actionButton('准备', 'btn-primary', !readyPhase, '仅在准备阶段可以准备', function () {
          runRoomAction('ready', {}, { successText: '已准备' });
        }),
        actionButton('取消准备', '', !readyPhase, '仅在准备阶段可以取消准备', function () {
          runRoomAction('cancel-ready', {}, { successText: '已取消准备' });
        }),
        actionButton('中止游戏', 'btn-danger', !playing, '仅在游戏进行中可以中止', function () {
          confirmAction({
            title: '中止游戏',
            message: '确定中止当前这局游戏吗？房间将回到选谱阶段。',
            confirmText: '中止',
            danger: true,
          }).then(function (ok) {
            if (ok) runRoomAction('abort', {}, { successText: '已中止游戏' });
          });
        })
      )
    );

    var reasons = [];
    if (!readyPhase) reasons.push('准备与取消准备仅在“准备中”阶段可用。');
    if (!playing) reasons.push('中止仅在“游戏中”阶段可用。');
    if (reasons.length) {
      group.appendChild(
        el(
          'ul',
          { class: 'hint-list' },
          reasons.map(function (reason) {
            return el('li', { text: reason });
          })
        )
      );
    }

    return group;
  }

  async function runRoomAction(action, extra, options) {
    var opts = options || {};
    if (!state.token) {
      sessionExpired('登录已过期，请重新登录');
      return;
    }
    if (state.actionPending) return;
    state.actionPending = true;
    try {
      await request('/api/room/action', {
        method: 'POST',
        body: Object.assign({ sessionToken: state.token, action: action }, extra || {}),
      });
      toast(opts.successText || '操作成功', 'success');
      await refreshAll(false);
    } catch (error) {
      handleActionError(error);
    } finally {
      state.actionPending = false;
    }
  }

  function renderRooms() {
    var tbody = $('#rooms-body');
    if (!tbody) return;
    clear(tbody);

    var rooms = state.rooms || [];
    var emptyNode = $('#rooms-empty');
    var wrapNode = $('#rooms-wrap');
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
              { class: 'tag-row' },
              tag(room.locked ? '已锁定' : '未锁定', room.locked ? 'tag-warn' : 'tag-muted'),
              room.live ? tag('直播', 'tag-info') : null
            )
          ),
          el('td', { text: room.host ? room.host.name : '—' }),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onClick: function () { selectRoom(room.id); },
              },
              '详情'
            )
          )
        )
      );
    });
  }

  function renderRoomDetail() {
    var card = $('#room-detail-card');
    var box = $('#room-detail');
    if (!card || !box) return;

    if (!state.selectedRoomId) {
      card.hidden = true;
      clear(box);
      return;
    }

    card.hidden = false;
    clear(box);
    var sub = $('#room-detail-sub');
    if (sub) sub.textContent = '房间 ' + state.selectedRoomId + ' · 只读视图';

    if (!state.selectedRoom) {
      box.appendChild(loadingState('正在加载房间详情…'));
      return;
    }

    box.appendChild(buildRoomSummary(state.selectedRoom));
    box.appendChild(
      el('p', {
        class: 'hint',
        text: '此面板为只读视图。房间内的操作请在游戏客户端或“我的房间”中完成。',
      })
    );
  }

  function selectRoom(roomId) {
    state.selectedRoomId = roomId;
    state.selectedRoom = null;
    renderRooms();
    renderRoomDetail();

    request('/api/room?id=' + encodeURIComponent(roomId))
      .then(function (data) {
        if (state.selectedRoomId !== roomId) return;
        state.selectedRoom = data.room;
        renderRoomDetail();
      })
      .catch(function (error) {
        if (state.selectedRoomId !== roomId) return;
        if (error.status === 404) {
          state.selectedRoomId = '';
          state.selectedRoom = null;
          renderRooms();
          renderRoomDetail();
          toast('房间已不存在', 'info');
          return;
        }
        handleSyncError(error, true);
        renderRoomDetail();
      });
  }

  function renderAccount() {
    var box = $('#account');
    if (!box) return;
    clear(box);

    var me = state.me;
    if (!me) {
      box.appendChild(loadingState('正在加载账号信息…'));
      return;
    }

    box.appendChild(
      el(
        'div',
        { class: 'meta-grid' },
        metaItem('Phira ID', String(me.user.id)),
        metaItem('昵称', me.user.name || '—'),
        metaItem(
          '在线状态',
          tag(me.online ? '在线' : '离线', me.online ? 'tag-ok' : 'tag-danger')
        ),
        metaItem('会话到期', formatTime(me.expiresAt))
      )
    );

    if (!me.online) {
      box.appendChild(
        el('p', {
          class: 'hint',
          text: '当前 Phira 账号不在线。请先在游戏中登录本服务器，才能操作房间。',
        })
      );
    }

    var bindingGroup = el(
      'div',
      { class: 'control-group' },
      el('div', { class: 'control-title', text: 'QQ 绑定' })
    );

    if (me.binding) {
      bindingGroup.appendChild(
        el(
          'div',
          { class: 'meta-grid' },
          metaItem('平台', platformLabel(me.binding.platform)),
          metaItem('QQ 号', String(me.binding.userId)),
          metaItem('绑定时间', formatTime(me.binding.boundAt))
        )
      );
      bindingGroup.appendChild(
        el(
          'div',
          { class: 'control-row' },
          actionButton('解绑 QQ', 'btn-danger btn-sm', false, '', function () {
            confirmAction({
              title: '解除 QQ 绑定',
              message:
                '确定解除 QQ ' +
                me.binding.userId +
                ' 与当前 Phira 账号的绑定吗？解绑后需要重新登录绑定。',
              confirmText: '解除绑定',
              danger: true,
            }).then(function (ok) {
              if (ok) unbindQq();
            });
          })
        )
      );
    } else {
      bindingGroup.appendChild(
        el('p', {
          class: 'hint',
          text: '尚未绑定 QQ。在 QQ 中向机器人发送 /p登录 获取绑定链接。',
        })
      );
    }

    box.appendChild(bindingGroup);
  }

  async function unbindQq() {
    if (state.actionPending) return;
    state.actionPending = true;
    try {
      await request('/api/web/unbind', { method: 'POST', token: state.token });
      toast('已解除 QQ 绑定', 'success');
      await refreshAll(false);
    } catch (error) {
      handleActionError(error);
    } finally {
      state.actionPending = false;
    }
  }

  /* ---------------- 登录 / 退出 ---------------- */

  async function handleLogin(event) {
    if (event) event.preventDefault();

    var emailInput = $('#login-email');
    var passwordInput = $('#login-password');
    var submitButton = $('#login-submit');
    var email = emailInput ? emailInput.value.trim() : '';
    var password = passwordInput ? passwordInput.value : '';

    setLoginError('');

    if (!getApiBase()) {
      setLoginError('服务器地址未配置，请联系管理员');
      toast('服务器地址未配置，请联系管理员', 'error');
      return;
    }
    if (!email) {
      setLoginError('请输入 Phira 邮箱');
      if (emailInput) emailInput.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLoginError('邮箱格式不正确');
      if (emailInput) emailInput.focus();
      return;
    }
    if (!password) {
      setLoginError('请输入密码');
      if (passwordInput) passwordInput.focus();
      return;
    }

    setBusy(submitButton, true);
    try {
      var data = await request('/api/web/login', {
        method: 'POST',
        body: { email: email, password: password },
      });
      saveToken(data.token);
      state.me = {
        user: data.user,
        online: false,
        binding: data.binding || null,
        room: null,
        expiresAt: data.expiresAt,
      };
      if (passwordInput) passwordInput.value = '';
      setLoginError('');
      showApp();
      renderAll();
      toast('登录成功', 'success');
      await refreshAll(true);
    } catch (error) {
      setLoginError(error.message);
      toast(error.message, 'error');
    } finally {
      setBusy(submitButton, false);
    }
  }

  async function handleLogout() {
    var token = state.token;
    try {
      if (token) await request('/api/web/logout', { method: 'POST', token: token });
    } catch (error) {
      /* 退出失败也要清理本地状态 */
    }
    saveToken('');
    state.me = null;
    state.rooms = [];
    state.selectedRoomId = '';
    state.selectedRoom = null;
    state.lastSync = 0;
    setLoginError('');
    setSync('尚未同步', false);
    showLogin();
    updateUserChip();
    toast('已退出登录', 'info');
  }

  /* ---------------- 初始化 ---------------- */

  function startTimer() {
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (!state.token) return;
      refreshAll(false);
    }, REFRESH_MS);
  }

  function bindEvents() {
    var loginForm = $('#login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    var logoutButton = $('#btn-logout');
    if (logoutButton) logoutButton.addEventListener('click', handleLogout);

    var refreshButton = $('#btn-refresh');
    if (refreshButton) {
      refreshButton.addEventListener('click', function () {
        if (!getApiBase()) {
          toast('服务器地址未配置，请联系管理员', 'error');
          return;
        }
        if (!state.token) {
          showLogin();
          setLoginError('请先登录');
          return;
        }
        refreshAll(true);
      });
    }

    var closeDetail = $('#btn-close-detail');
    if (closeDetail) {
      closeDetail.addEventListener('click', function () {
        state.selectedRoomId = '';
        state.selectedRoom = null;
        renderRooms();
        renderRoomDetail();
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.token) refreshAll(false);
    });
  }

  function init() {
    var siteName = CONFIG.siteName || 'Phira 管理面板';
    var siteNode = $('#site-name');
    if (siteNode) siteNode.textContent = siteName;
    document.title = siteName + ' · 玩家面板';

    bindEvents();

    if (!getApiBase()) {
      showLogin();
      setLoginError('服务器地址未配置，请联系管理员');
    } else if (state.token) {
      showApp();
      renderAll();
      refreshAll(true);
    } else {
      showLogin();
    }

    startTimer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
