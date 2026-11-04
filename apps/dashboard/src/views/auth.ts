/** Masuk / daftar guru (kata sandi di-hash bcrypt di server; sesi = cookie httpOnly 12 jam). */
import { h, api, btn, setToken } from '../lib.js';

export function loginView(onDone: () => void): HTMLElement {
  let mode: 'masuk' | 'daftar' = 'masuk';
  const err = h('div', { class: 'err', role: 'alert' });
  const email = h('input', { class: 'in', type: 'email', autocomplete: 'username', placeholder: 'nama@sekolah.sch.id' }) as HTMLInputElement;
  // Ingat email saja pada perangkat ini. Kata sandi tetap dikelola Password Manager browser.
  try { email.value = localStorage.getItem('eduverse.guru.lastEmail') ?? ''; } catch { /* penyimpanan tidak tersedia */ }
  const pw = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', placeholder: 'Minimal 8 karakter' }) as HTMLInputElement;
  const name = h('input', { class: 'in', autocomplete: 'name', placeholder: 'mis. Bu Sari' }) as HTMLInputElement;
  const code = h('input', { class: 'in', placeholder: 'Dari admin sekolah (kosongkan untuk guru pertama)' }) as HTMLInputElement;
  const extra = h('div', { class: 'col' }, h('label', { class: 'f' }, 'Nama guru', name), h('label', { class: 'f' }, 'Kode pendaftaran guru', code));
  const title = h('h2', null, 'Masuk Dashboard Guru');
  const switcher = h('a', { href: '#' });
  const submit = btn('Masuk', 'hijau besar', async () => {
    err.textContent = '';
    try {
      if (mode === 'daftar') {
        await api('/auth/register', { method: 'POST', json: { email: email.value.trim(), password: pw.value, name: name.value.trim(), registrationCode: code.value.trim() || undefined } });
      }
      const r = await api<{ token: string }>('/auth/login', { method: 'POST', json: { email: email.value.trim(), password: pw.value } });
      setToken(r.token);
      try { localStorage.setItem('eduverse.guru.lastEmail', email.value.trim()); } catch { /* abaikan */ }
      onDone();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });
  const render = () => {
    extra.style.display = mode === 'daftar' ? '' : 'none';
    title.textContent = mode === 'masuk' ? 'Masuk Dashboard Guru' : 'Daftar Akun Guru';
    submit.textContent = mode === 'masuk' ? 'Masuk' : 'Daftar & Masuk';
    switcher.textContent = mode === 'masuk' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk';
    pw.autocomplete = mode === 'masuk' ? 'current-password' : 'new-password';
  };
  switcher.addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'masuk' ? 'daftar' : 'masuk';
    render();
  });
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit.click());
  render();
  return h(
    'div',
    { class: 'login' },
    h(
      'div',
      { class: 'card col' },
      h('div', { style: 'font-family:Fredoka;font-size:40px;font-weight:700;color:#3BA7FF;text-align:center' }, 'EDUVERSE'),
      title,
      h('label', { class: 'f' }, 'Email', email),
      h('label', { class: 'f' }, 'Kata sandi', pw),
      extra,
      err,
      submit,
      switcher,
    ),
  );
}
