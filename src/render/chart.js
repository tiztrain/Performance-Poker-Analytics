// ---------- Stack-impact chart ----------
import { fmtSigned } from './format.js';

export function renderImpactChart(hands, svgEl, onBarClick) {
  const values = hands.map(h => h.heroNetBB).filter(v => v !== null);
  if (!values.length) {
    svgEl.style.display = 'none';
    return;
  }

  const maxAbs = Math.max(1, ...values.map(v => Math.abs(v)));
  const barWidth = 10;
  const gap = 2;
  const height = 160;
  const midY = height / 2;
  const width = Math.max(hands.length * (barWidth + gap), 300);

  svgEl.setAttribute('width', width);
  svgEl.setAttribute('height', height);
  svgEl.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  const tooltip = document.getElementById('chart-tooltip');
  let svgContent =
    '<line x1="0" y1="' + midY + '" x2="' + width + '" y2="' + midY + '" stroke="#2a2f37" stroke-width="1"/>';

  hands.forEach((h, i) => {
    const v = h.heroNetBB;
    if (v === null) return;
    const barH = Math.max(1, (Math.abs(v) / maxAbs) * (midY - 6));
    const x = i * (barWidth + gap);
    const y = v >= 0 ? midY - barH : midY;
    const color = v >= 0 ? '#5a9c7c' : '#c0524f';
    svgContent +=
      '<rect class="impact-bar" data-idx="' +
      i +
      '" data-hand-id="' +
      h.id +
      '" x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      barWidth +
      '" height="' +
      barH +
      '" fill="' +
      color +
      '" rx="1" style="cursor:pointer;"/>';
  });

  svgEl.innerHTML = svgContent;
  svgEl.style.display = 'block';

  svgEl.querySelectorAll('.impact-bar').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const idx = parseInt(rect.dataset.idx);
      const h = hands[idx];
      tooltip.innerHTML =
        '#' +
        h.id +
        '<br>' +
        fmtSigned(h.heroNetChips, h.bb) +
        (h.heroFoldedOnStreet ? ' (folded ' + h.heroFoldedOnStreet + ')' : '') +
        '<br><span style="color:var(--text-faint);">click to view</span>';
      tooltip.style.display = 'block';
    });
    rect.addEventListener('mousemove', e => {
      tooltip.style.left = e.clientX + 12 + 'px';
      tooltip.style.top = e.clientY - 10 + 'px';
    });
    rect.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
    rect.addEventListener('click', () => {
      if (onBarClick) onBarClick(rect.dataset.handId);
    });
  });
}

export function statCardClass(value, goodMin, watchMin) {
  if (value === null) return '';
  const v = parseFloat(value);
  if (v >= goodMin) return 'good';
  if (v >= watchMin) return 'watch';
  return 'leak';
}
