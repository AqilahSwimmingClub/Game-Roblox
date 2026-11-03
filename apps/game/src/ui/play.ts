/** Layar 9–13: Pop-up Soal, Hasil Jawaban, Hasil Akhir, Podium, hitung mundur, peta besar. */
import { KOTA, KOTA_ZONES, type AnswerPayload, type AnswerResultMsg, type FinalResultMsg, type PodiumEntry, type PublicQuestion } from '@eduverse/shared';
import { h, btn, ui } from './dom.js';
import { sfx } from '../world/audio.js';

const LETTER = ['A', 'B', 'C', 'D', 'E'];

/**
 * Pop-up soal. `submit` mengirim jawaban ke server dan mengembalikan hasil validasi server.
 * Klien tidak pernah tahu kunci jawaban sebelum server menilai.
 */
export function showQuestion(q: PublicQuestion, submit: (a: AnswerPayload) => Promise<AnswerResultMsg | string>, onClose: (finished: boolean) => void) {
  let answer: AnswerPayload | null = null;
  let finished = false;
  const layer = h('div', { class: 'screen gelap', style: 'z-index:22' });
  const close = () => {
    layer.remove();
    onClose(finished);
  };
  const body = h('div', { class: 'isi' });
  const footer = h('div', { class: 'col', style: 'padding:0 18px' });
  const msg = h('div', { class: 'error center' });
  const jawab = btn('JAWAB', 'hijau besar', () => void send(), { disabled: true });
  const optBtns: HTMLButtonElement[] = [];

  const render = () => {
    body.replaceChildren(h('div', { class: 'teks' }, q.prompt));
    if (q.type === 'pg' || q.type === 'bs') {
      const opts = q.type === 'bs' ? ['Benar', 'Salah'] : q.options;
      const grid = h('div', { class: 'opsi' });
      opts.forEach((o, i) => {
        const b = h('button', { type: 'button' }, h('b', null, q.type === 'bs' ? (i === 0 ? 'B' : 'S') : LETTER[i]!), h('span', null, o)) as HTMLButtonElement;
        b.onclick = () => {
          if (b.disabled) return;
          sfx.click();
          answer = q.type === 'bs' ? { type: 'bs', value: i === 0 } : { type: 'pg', index: i };
          optBtns.forEach((x, k) => x.classList.toggle('pilih', k === i));
          jawab.disabled = false;
        };
        optBtns.push(b);
        grid.appendChild(b);
      });
      body.appendChild(grid);
    } else if (q.type === 'isian') {
      const inp = h('input', { class: 'field', placeholder: 'Ketik jawabanmu…', maxlength: 40, autocomplete: 'off' }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        answer = { type: 'isian', text: inp.value };
        jawab.disabled = inp.value.trim().length === 0;
      });
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && !jawab.disabled && void send());
      body.appendChild(inp);
      setTimeout(() => inp.focus(), 60);
    } else {
      // Menjodohkan: setiap baris kiri memilih pasangan dari kolom kanan
      const pairs: number[] = q.options.map(() => -1);
      const grid = h('div', { class: 'jodoh' });
      q.options.forEach((left, i) => {
        const sel = h('select', { class: 'field', 'aria-label': `Pasangan untuk ${left}` }, h('option', { value: '-1' }, 'Pilih pasangan…'), ...q.right.map((r, k) => h('option', { value: String(k) }, r))) as HTMLSelectElement;
        sel.onchange = () => {
          pairs[i] = Number(sel.value);
          answer = { type: 'jodoh', pairs: [...pairs] };
          jawab.disabled = pairs.some((p) => p < 0);
        };
        grid.append(h('div', { class: 'kiri' }, left), sel);
      });
      body.appendChild(grid);
    }
  };

  const send = async () => {
    if (!answer) return;
    jawab.disabled = true;
    msg.textContent = '';
    const r = await submit(answer);
    if (typeof r === 'string') {
      msg.textContent = r;
      jawab.disabled = false;
      return;
    }
    showResult(r);
  };

  const showResult = (r: AnswerResultMsg) => {
    if (q.type === 'pg' || q.type === 'bs') {
      const chosen = r.chosen.type === 'pg' ? r.chosen.index : r.chosen.type === 'bs' ? (r.chosen.value ? 0 : 1) : -1;
      optBtns.forEach((b) => b.classList.remove('pilih'));
      if (chosen >= 0) optBtns[chosen]?.classList.add(r.correct ? 'benar' : 'salah');
      if (r.correctAnswer) {
        const k = r.correctAnswer.type === 'pg' ? r.correctAnswer.index : r.correctAnswer.type === 'bs' ? (r.correctAnswer.value ? 0 : 1) : -1;
        if (k >= 0) optBtns[k]?.classList.add('benar');
      }
    }
    if (r.canRetry) {
      sfx.retry();
      msg.textContent = 'Hampir! Coba lagi (poin 50%).';
      optBtns.forEach((b, i) => {
        const chosen = r.chosen.type === 'pg' ? r.chosen.index : r.chosen.type === 'bs' ? (r.chosen.value ? 0 : 1) : -1;
        if (i === chosen) b.disabled = true;
        else b.classList.remove('salah');
      });
      answer = null;
      return;
    }
    finished = true;
    optBtns.forEach((b) => (b.disabled = true));
    footer.replaceChildren();
    if (r.correct) {
      sfx.correct();
      const d = r.breakdown;
      const parts = d ? [`Dasar +${d.dasar}`, d.cepat ? `Cepat +${d.cepat}` : '', d.tersembunyi ? `Lokasi tersembunyi +${d.tersembunyi}` : '', d.beruntun ? `Beruntun ${r.streak} +${d.beruntun}` : '', d.kejutan ? 'Soal Kejutan ×2' : ''].filter(Boolean) : [];
      footer.append(
        h('div', { class: 'stempel benar pop' }, `BENAR! +${d?.total ?? 0}`),
        h('div', { class: 'muted center', style: 'font-weight:900' }, parts.join(' · ')),
      );
      if (r.streak >= 3 && r.streak % 3 === 0) footer.append(h('div', { class: 'chip', style: 'background:#FF8A3D;color:#fff;align-self:center' }, `Beruntun ${r.streak} jawaban benar!`));
    } else {
      sfx.retry();
      let kunci = '';
      if (r.correctAnswer?.type === 'isian') kunci = ` Jawaban yang benar: ${r.correctAnswer.text}.`;
      if (r.correctAnswer?.type === 'jodoh') kunci = ' Pasangan yang benar: ' + q.options.map((l, i) => `${l} → ${q.right[(r.correctAnswer as { pairs: number[] }).pairs[i]!] ?? '?'}`).join('; ') + '.';
      footer.append(h('div', { class: 'stempel salah pop' }, 'Hampir!'), h('div', { class: 'center', style: 'font-weight:800' }, `Jawaban yang benar ditandai hijau.${kunci}`));
    }
    if (r.explanation) footer.append(h('div', { class: 'panel tipis', style: 'padding:10px 14px;font-weight:700' }, r.explanation));
    footer.append(btn('LANJUT JELAJAH', 'biru besar', close));
  };

  footer.append(msg, jawab);
  const head = h(
    'header',
    { style: q.surprise ? 'background:#8B5CF6' : '' },
    h('div', { class: 'grow' }, h('div', { style: 'font-family:Fredoka;font-size:20px' }, `${q.object} · ${q.location}`), h('div', { style: 'font-weight:800;font-size:15px' }, `${q.subject} · ${q.typeLabel}${q.attempt === 2 ? ' · Kesempatan kedua' : ''}`)),
    h('span', { class: 'poin-chip' }, `+${q.points}`),
    btn('X', 'putih kecil', close, { 'aria-label': 'Tutup soal', style: 'width:48px;padding:0' }),
  );
  render();
  layer.appendChild(h('div', { class: 'panel soal col pop', style: 'gap:14px' }, head, body, footer));
  ui.add(layer);
  sfx.open();
  return { close: () => layer.remove() };
}

/** Layar 12 — Hasil Akhir. */
export function showFinal(r: FinalResultMsg, onPodium: () => void) {
  const layer = h('div', { class: 'screen gelap', style: 'z-index:26' });
  const big = h('div', { class: 'countdown', style: 'font-size:min(14vw,90px)' }, 'Waktu Habis!');
  layer.appendChild(big);
  ui.add(layer);
  setTimeout(() => {
    layer.replaceChildren(
      h(
        'div',
        { class: 'panel card lebar col pop' },
        h('h2', { class: 'center', style: 'font-size:30px' }, 'Hasil Petualanganmu'),
        h(
          'div',
          { class: 'tiles' },
          h('div', { class: 'tile', style: 'background:#FFC93C' }, h('div', { class: 'v' }, String(r.poin)), h('div', { class: 'k' }, 'Total poin')),
          h('div', { class: 'tile', style: 'background:#BFEBD1' }, h('div', { class: 'v' }, `${r.benar}/${r.dijawab}`), h('div', { class: 'k' }, 'Benar / dijawab')),
          h('div', { class: 'tile', style: 'background:#CFE6FF' }, h('div', { class: 'v' }, r.rank ? `#${r.rank}` : '—'), h('div', { class: 'k' }, `dari ${r.total} siswa`)),
        ),
        h('div', { class: 'row wrap', style: 'justify-content:center' }, ...(r.lencana.length ? r.lencana : ['Berani Mencoba']).map((l) => h('span', { class: 'lencana' }, `Lencana: ${l}`))),
        h('p', { class: 'center muted', style: 'font-weight:800;margin:0' }, r.saran),
        h('p', { class: 'center', style: 'font-weight:900;margin:0' }, 'Tunggu gurumu membuka Podium Juara…'),
        btn('Tutup', 'putih', () => (layer.remove(), onPodium())),
      ),
    );
  }, 1800);
  return { close: () => layer.remove() };
}

/** Banner podium: urutan 3 → 2 → 1 dengan tabuhan drum, lalu musik kemenangan. */
export function podiumBanner(top3: PodiumEntry[], onReveal: (rank: number) => void, onFinish: () => void) {
  const text = h('h2', { style: 'font-size:clamp(20px,4vw,30px)' }, 'Dan juaranya adalah…');
  const el = h('div', { class: 'panel banner-bawah pop', style: 'z-index:24' }, text);
  ui.add(el);
  sfx.drum();
  let step = 0;
  const order = [3, 2, 1];
  const timer = setInterval(() => {
    const rank = order[step];
    if (rank === undefined) {
      clearInterval(timer);
      text.textContent = 'Selamat untuk semua penjelajah!';
      sfx.victory();
      onFinish();
      return;
    }
    const e = top3.find((t) => t.rank === rank);
    if (e) {
      text.textContent = `Juara ${rank}: ${e.nama} · ${e.poin} poin`;
      onReveal(rank);
    }
    step++;
  }, 2000);
  return {
    close: () => {
      clearInterval(timer);
      el.remove();
    },
  };
}

export function countdown(n: number) {
  const prev = document.getElementById('countdown');
  prev?.remove();
  sfx.countdown(n <= 0);
  const el = h('div', { id: 'countdown', class: 'screen transparan', style: 'z-index:30' }, h('div', { class: 'countdown' }, n > 0 ? String(n) : 'MULAI!'));
  ui.add(el);
  setTimeout(() => el.remove(), n > 0 ? 950 : 1200);
}

/** Peta besar Dunia Kota dengan label zona, posisi pemain, dan titik soal. */
export function showMap(px: number, pz: number, points: { x: number; z: number; done: boolean; surprise: boolean }[]) {
  const S = Math.min(window.innerWidth, window.innerHeight) * 0.78;
  const cv = h('canvas', { width: 900, height: 900, style: `width:${S}px;height:${S}px;border-radius:20px;background:#9ed98f` }) as HTMLCanvasElement;
  const c = cv.getContext('2d')!;
  const k = 900 / (KOTA.half * 2);
  const t = (v: number) => (v + KOTA.half) * k;
  for (const z of KOTA_ZONES) {
    c.fillStyle = '#' + z.color.toString(16).padStart(6, '0') + '55';
    for (const r of z.rects) c.fillRect(t(r.x - r.hx), t(r.z - r.hz), r.hx * 2 * k, r.hz * 2 * k);
  }
  c.fillStyle = '#3fb4e8';
  c.fillRect(0, t(KOTA.riverZ0), 900, (KOTA.riverZ1 - KOTA.riverZ0) * k);
  c.fillStyle = '#5d6678';
  const road = (x: number, z: number, w: number, d: number) => c.fillRect(t(x - w / 2), t(z - d / 2), Math.max(3, w * k), Math.max(3, d * k));
  road(0, -KOTA.ring, KOTA.ring * 2, 12);
  road(0, KOTA.ring, KOTA.ring * 2, 12);
  road(-KOTA.ring, 0, 12, KOTA.ring * 2);
  road(KOTA.ring, 0, 12, KOTA.ring * 2);
  road(0, 0, KOTA.half * 2, 12);
  road(0, 0, 12, KOTA.half * 2);
  road(0, KOTA.southZ, KOTA.half * 2, 9);
  road(-KOTA.sideX, 0, 9, KOTA.half * 2);
  road(KOTA.sideX, 0, 9, KOTA.half * 2);
  for (const p of points) {
    c.fillStyle = p.done ? '#2FBF71' : p.surprise ? '#8B5CF6' : '#FFC93C';
    c.beginPath();
    c.arc(t(p.x), t(p.z), 6, 0, Math.PI * 2);
    c.fill();
  }
  c.font = '800 20px Nunito, sans-serif';
  c.textAlign = 'center';
  c.fillStyle = '#1E2A4A';
  for (const z of KOTA_ZONES) c.fillText(z.nama, t(z.label.x), t(z.label.z));
  c.fillStyle = '#3BA7FF';
  c.strokeStyle = '#fff';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(t(px), t(pz), 11, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  const layer = h('div', { class: 'screen gelap', style: 'z-index:23;flex-direction:column;gap:12px' }, cv, h('div', { class: 'row' }, h('span', { class: 'chip' }, 'Kuning: soal'), h('span', { class: 'chip' }, 'Hijau: selesai'), h('span', { class: 'chip' }, 'Biru: kamu'), btn('Tutup Peta', 'putih', () => layer.remove())));
  ui.add(layer);
}

export function blocker(title: string, text: string, action?: { label: string; fn: () => void }) {
  document.getElementById('blocker')?.remove();
  const el = h('div', { id: 'blocker', class: 'screen gelap', style: 'z-index:40' }, h('div', { class: 'panel card col center pop', style: 'align-items:center' }, h('h2', null, title), h('p', { style: 'font-weight:800' }, text), action ? btn(action.label, 'hijau', action.fn) : null));
  ui.add(el);
  return { close: () => el.remove() };
}
