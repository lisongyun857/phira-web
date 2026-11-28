/* 移动端适配辅助：可视高度、虚拟键盘聚焦、触摸设备标记 */
(function () {
  'use strict';

  var root = document.documentElement;

  function updateViewportHeight() {
    var viewport = window.visualViewport;
    var height = viewport && viewport.height ? viewport.height : window.innerHeight;
    if (!height) return;
    // 1% 可视高度，供弹层在虚拟键盘弹出时自适应
    root.style.setProperty('--app-vh', height * 0.01 + 'px');
  }

  var pending = false;
  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      updateViewportHeight();
    });
  }

  updateViewportHeight();
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleUpdate, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleUpdate, { passive: true });
  }

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    root.classList.add('is-touch');
  }

  // 虚拟键盘弹出后，把聚焦的输入框滚动到可视区域中间
  document.addEventListener('focusin', function (event) {
    var target = event.target;
    if (!target || !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target.type === 'checkbox' || target.type === 'radio') return;
    setTimeout(function () {
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        target.scrollIntoView();
      }
    }, 250);
  });

  // iOS Safari 双指缩放
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(
      name,
      function (event) {
        event.preventDefault();
      },
      { passive: false }
    );
  });
})();
