document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    function setOpen(open) {
      links.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    }
    toggle.addEventListener('click', function () {
      setOpen(!links.classList.contains('open'));
    });
    // close the mobile menu on Escape or after picking a link
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && links.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
  }

  // mark the active section: <body data-section="services"> matches <a data-nav="services">
  var section = document.body.getAttribute('data-section');
  if (section) {
    document.querySelectorAll('.nav-links a[data-nav="' + section + '"]').forEach(function (a) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    });
  }

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
