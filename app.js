'use strict';
const menu = document.querySelector('#menu');
const aside = document.querySelector('#sidebar');
menu?.addEventListener('click', () => {
  const open = aside.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {aside.classList.remove('open');menu?.setAttribute('aria-expanded','false');}
});
const search = document.querySelector('#fund-search');
search?.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  let count = 0;
  document.querySelectorAll('[data-search]').forEach(row => {
    row.hidden = !row.dataset.search.toLowerCase().includes(query);
    if (!row.hidden) count++;
  });
  document.querySelector('#result-count').textContent = `${count} / 18 只`;
  document.querySelector('#no-results').hidden = count > 0;
});
