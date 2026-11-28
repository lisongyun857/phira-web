/* 谱面搜索选择器：直连 Phira 官方谱面接口，玩家面板与管理面板共用 */
(function () {
  'use strict';

  var API = 'https://phira.5wyxi.com/chart';
  var PAGE_SIZE = 30;
  var CACHE_MS = 5 * 60 * 1000;

  var cache = new Map();
  var dom = null;
  var state = {
    page: 1,
    query: '',
    count: 0,
    totalPages: 1,
    loading: false,
    onSelect: null,
    selectedId: null,
    audio: null,
    audioButton: null,
    requestId: 0,
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else node.setAttribute(key, value);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child === null || child === undefined) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  function formatRating(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无评级';
    return value.toFixed(3);
  }

  function buildDom() {
    if (dom) return dom;

    var title = el('h2', { id: 'chart-picker-title', text: '选择谱面' });
    var closeButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '关闭' });
    var searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: '搜索谱面名称、曲师或谱师；留空浏览全部',
      autocomplete: 'off',
    });
    var searchButton = el('button', { class: 'btn btn-primary', type: 'submit', text: '搜索' });
    var searchForm = el('form', { class: 'chart-picker-search' }, [searchInput, searchButton]);
    var status = el('p', { class: 'chart-picker-status muted', text: '' });
    var grid = el('div', { class: 'chart-grid' });
    var prev = el('button', { class: 'btn btn-ghost', type: 'button', text: '上一页' });
    var next = el('button', { class: 'btn btn-ghost', type: 'button', text: '下一页' });
    var pageInfo = el('span', { class: 'chart-picker-page muted', text: '' });

    var modal = el('div', { class: 'modal chart-picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chart-picker-title' }, [
      el('div', { class: 'modal-head' }, [
        title,
        closeButton,
      ]),
      el('div', { class: 'modal-body chart-picker-body' }, [searchForm, status, grid]),
      el('div', { class: 'modal-foot chart-picker-foot' }, [prev, pageInfo, next]),
    ]);
    var overlay = el('div', { class: 'modal-backdrop chart-picker-backdrop', hidden: 'hidden' }, modal);

    document.body.appendChild(overlay);

    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      load(1, searchInput.value.trim());
    });
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    prev.addEventListener('click', function () {
      if (state.loading || state.page <= 1) return;
      load(state.page - 1, state.query);
    });
    next.addEventListener('click', function () {
      if (state.loading || state.page >= state.totalPages) return;
      load(state.page + 1, state.query);
    });

    dom = {
      overlay: overlay,
      title: title,
      searchInput: searchInput,
      status: status,
      grid: grid,
      prev: prev,
      next: next,
      pageInfo: pageInfo,
    };
    return dom;
  }

  function setStatus(text, isError) {
    if (!dom) return;
    dom.status.textContent = text || '';
    dom.status.classList.toggle('is-error', Boolean(isError));
  }

  function stopAudio() {
    if (state.audio) {
      try {
        state.audio.pause();
      } catch {
        // 忽略音频停止失败
      }
    }
    if (state.audioButton) {
      state.audioButton.textContent = '试听';
      state.audioButton = null;
    }
  }

  function togglePreview(chart, button) {
    if (!chart.preview) return;
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.addEventListener('ended', stopAudio);
    }
    var audio = state.audio;

    if (state.audioButton === button && !audio.paused) {
      stopAudio();
      return;
    }
    stopAudio();
    audio.src = chart.preview;
    var playing = audio.play();
    if (playing && typeof playing.catch === 'function') {
      playing.catch(function () {
        setStatus('试听加载失败，可能是网络或音频地址不可用', true);
        stopAudio();
      });
    }
    state.audioButton = button;
    button.textContent = '停止';
  }

  function coverNode(chart) {
    var wrap = el('div', { class: 'chart-card-cover' });
    if (chart.illustration) {
      var img = el('img', {
        src: chart.illustration,
        alt: chart.name || '谱面封面',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      });
      img.addEventListener('error', function () {
        img.remove();
        wrap.classList.add('is-placeholder');
        wrap.textContent = '无封面';
      });
      wrap.appendChild(img);
    } else {
      wrap.classList.add('is-placeholder');
      wrap.textContent = '无封面';
    }
    return wrap;
  }

  function buildCard(chart) {
    var selectButton = el('button', {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      text: state.selectedId === chart.id ? '当前谱面' : '选择',
    });
    selectButton.addEventListener('click', function () {
      if (typeof state.onSelect === 'function') state.onSelect(chart);
      close();
    });

    var actions = el('div', { class: 'chart-card-actions' });
    if (chart.preview) {
      var previewButton = el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        text: '试听',
      });
      previewButton.addEventListener('click', function () {
        togglePreview(chart, previewButton);
      });
      actions.appendChild(previewButton);
    }
    actions.appendChild(selectButton);

    var meta = el('p', { class: 'chart-card-meta' }, [
      el('span', { text: chart.composer || '未知曲师' }),
      el('span', { class: 'chart-card-dot', text: '·' }),
      el('span', { text: chart.charter || '未知谱师' }),
    ]);

    var card = el(
      'article',
      {
        class: 'chart-card' + (state.selectedId === chart.id ? ' is-selected' : ''),
      },
      [
        coverNode(chart),
        el('div', { class: 'chart-card-body' }, [
          el('h3', { class: 'chart-card-title', text: chart.name || '未命名谱面', title: chart.name || '' }),
          meta,
          el('div', { class: 'chart-card-tags' }, [
            el('span', { class: 'tag tag-info', text: chart.level || ('Lv.' + chart.difficulty) }),
            el('span', { class: 'tag tag-muted', text: 'ID ' + chart.id }),
            el('span', { class: 'tag tag-muted', text: '★ ' + formatRating(chart.rating) }),
          ]),
          actions,
        ]),
      ]
    );
    return card;
  }

  function render(data) {
    var results = Array.isArray(data.results) ? data.results : [];
    state.count = Number(data.count) || 0;
    state.totalPages = Math.max(1, Math.ceil(state.count / PAGE_SIZE));

    dom.grid.textContent = '';
    if (results.length === 0) {
      dom.grid.appendChild(
        el('div', { class: 'chart-picker-empty muted', text: '没有找到匹配的谱面，换个关键词试试。' })
      );
    } else {
      results.forEach(function (chart) {
        dom.grid.appendChild(buildCard(chart));
      });
    }

    dom.pageInfo.textContent =
      '第 ' + state.page + ' / ' + state.totalPages + ' 页 · 共 ' + state.count + ' 张';
    dom.prev.disabled = state.page <= 1;
    dom.next.disabled = state.page >= state.totalPages;
  }

  function setLoading(loading) {
    state.loading = loading;
    dom.prev.disabled = loading || state.page <= 1;
    dom.next.disabled = loading || state.page >= state.totalPages;
    if (loading) setStatus('正在加载谱面…', false);
  }

  function load(page, query) {
    ensureDom();
    state.page = Math.max(1, page || 1);
    state.query = query || '';
    var requestId = ++state.requestId;
    var key = state.query + '|' + state.page;
    var cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      setStatus(
        state.query ? '搜索“' + state.query + '”' : '全部谱面（按更新时间排序）',
        false
      );
      render(cached.data);
      return;
    }

    setLoading(true);
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    fetch(API + '?search=' + encodeURIComponent(state.query) + '&page=' + state.page, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(function (response) {
        if (!response.ok) throw new Error('谱面接口返回 HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.results)) throw new Error('谱面接口返回数据异常');
        cache.set(key, { at: Date.now(), data: data });
        if (requestId !== state.requestId) return;
        setLoading(false);
        setStatus(
          state.query ? '搜索“' + state.query + '”' : '全部谱面（按更新时间排序）',
          false
        );
        render(data);
      })
      .catch(function (error) {
        if (requestId !== state.requestId) return;
        setLoading(false);
        var message = error && error.name === 'AbortError' ? '请求超时，请重试' : error.message;
        setStatus('加载失败：' + message, true);
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  function ensureDom() {
    if (!dom) buildDom();
    return dom;
  }

  function open(options) {
    var opts = options || {};
    ensureDom();
    state.onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    state.selectedId = opts.selectedId === undefined ? null : opts.selectedId;
    dom.title.textContent = opts.title || '选择谱面';
    dom.overlay.hidden = false;
    document.addEventListener('keydown', onKeydown);
    dom.searchInput.value = state.query;
    load(1, state.query);
    setTimeout(function () {
      dom.searchInput.focus();
    }, 0);
  }

  function close() {
    if (!dom) return;
    dom.overlay.hidden = true;
    stopAudio();
    document.removeEventListener('keydown', onKeydown);
  }

  window.ChartPicker = {
    open: open,
    close: close,
  };
})();
