/** Handler Socket.IO: namespace /play (siswa) dan /teacher (dashboard guru, wajib login). */
import type { Server, Socket } from 'socket.io';
import { EV, isWorldId, type SceneId } from '@eduverse/shared';
import { COOKIE, parseCookie, verifyTeacherToken } from '../auth.js';
import type { RuntimeRegistry, SessionRuntime } from './runtime.js';
import { config } from '../config.js';

type Ack = (r: unknown) => void;
const ackOf = (a: unknown): Ack => (typeof a === 'function' ? (a as Ack) : () => {});

/** Pembatas laju sederhana per kunci (IP / socket). */
class Bucket {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  take(key: string) {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.hits.clear();
    return true;
  }
}

/** IP klien di balik `hops` proxy tepercaya (ambil dari kanan agar tidak bisa dipalsukan klien). */
function ipOf(s: Socket, hops: number) {
  const xf = s.handshake.headers['x-forwarded-for'];
  if (typeof xf !== 'string' || !hops) return s.handshake.address;
  const list = xf.split(',').map((x) => x.trim()).filter(Boolean);
  return list[list.length - hops] ?? list[0] ?? s.handshake.address;
}

export function attachSockets(io: Server, registry: RuntimeRegistry, opts: { trustProxy: number }) {
  const play = io.of('/play');
  const teacher = io.of('/teacher');
  const joinLimiter = new Bucket(config.joinRatePerMin, 60_000); // per IP; kelas sering berbagi satu IP (NAT)
  const claimLimiter = new Bucket(10, 60_000);

  play.on('connection', (socket) => {
    let rt: SessionRuntime | null = null;
    const ip = ipOf(socket, opts.trustProxy);
    let stateCount = 0;
    let stateWindow = Date.now();

    socket.on(EV.join, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      try {
        if (!joinLimiter.take(ip)) return done({ ok: false, error: 'Terlalu banyak percobaan. Tunggu sebentar.' });
        const m = (raw ?? {}) as { code?: unknown; claimToken?: unknown };
        if (typeof m.code !== 'string' || !/^[A-Za-z0-9]{4,8}$/.test(m.code.trim())) return done({ ok: false, error: 'Kode kelas tidak valid.' });
        if (rt) rt.detach(socket);
        const found = await registry.byCode(m.code.trim());
        if (!found) return done({ ok: false, error: 'Kode kelas tidak ditemukan. Periksa lagi kodenya.' });
        rt = found;
        const s = rt.attach(socket, typeof m.claimToken === 'string' ? m.claimToken.slice(0, 64) : undefined);
        done({
          ok: true,
          state: rt.publicState(),
          roster: rt.rosterList(),
          preset: [...rt.students.values()].some((x) => x.preset),
          requireApproval: rt.settings.requireApproval,
          me: s ? { absen: s.absen, nama: s.nama, avatar: s.avatar, approved: s.approved, poin: s.score, benar: s.correct, dijawab: s.answered, lastScene: s.lastScene, dompet: { saldo: s.wallet, tas: { ...s.bag } } } : null,
        });
      } catch (e) {
        console.error('[join]', e);
        done({ ok: false, error: 'Server sedang sibuk. Coba lagi.' });
      }
    });

    socket.on(EV.claimIdentity, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Masukkan kode kelas dahulu.' });
      if (!claimLimiter.take(socket.id)) return done({ ok: false, error: 'Terlalu banyak percobaan.' });
      const m = (raw ?? {}) as { absen?: unknown; nama?: unknown };
      try {
        const r = await rt.claim(socket, Number(m.absen), typeof m.nama === 'string' ? m.nama : undefined);
        if (!r.ok) return done(r);
        done({ ok: true, token: r.token, me: { absen: r.student.absen, nama: r.student.nama, avatar: r.student.avatar, approved: r.student.approved } });
      } catch (e) {
        console.error('[claim]', e);
        done({ ok: false, error: 'Gagal menyimpan identitas.' });
      }
    });

    socket.on(EV.setAvatar, async (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false });
      await rt.setAvatar(socket, raw).catch((e) => console.error('[avatar]', e));
      ackOf(ack)({ ok: true });
    });

    socket.on(EV.setReady, (raw: unknown) => rt?.setReady(socket, raw === true));

    socket.on(EV.enterWorld, (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Belum bergabung ke sesi.' });
      const scene = (raw as { scene?: unknown } | null)?.scene;
      if (scene !== 'lobi' && scene !== 'podium' && !isWorldId(scene)) return done({ ok: false, error: 'Tujuan tidak dikenal.' });
      done(rt.enterScene(socket, scene as SceneId));
    });

    socket.on(EV.state, (raw: unknown) => {
      // batas laju paket posisi (maks ~25/detik)
      const now = Date.now();
      if (now - stateWindow > 1000) {
        stateWindow = now;
        stateCount = 0;
      }
      if (++stateCount > 25) return;
      rt?.updateState(socket, raw);
    });

    socket.on(EV.interact, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Belum bergabung.' });
      try {
        done(await rt.interact(socket, (raw as { pointId?: unknown } | null)?.pointId));
      } catch (e) {
        console.error('[interact]', e);
        done({ ok: false, error: 'Gagal memuat soal.' });
      }
    });

    socket.on(EV.answer, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Belum bergabung.' });
      try {
        done(await rt.answer(socket, raw));
      } catch (e) {
        console.error('[answer]', e);
        done({ ok: false, error: 'Gagal menyimpan jawaban. Coba lagi.' });
      }
    });

    socket.on(EV.closeQuestion, () => rt?.closeQuestion(socket));
    socket.on(EV.emote, (id: unknown) => rt?.emote(socket, id));
    socket.on(EV.useLift, (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false });
      ackOf(ack)(rt.useLift(socket, (raw as { liftId?: unknown } | null)?.liftId));
    });

    socket.on(EV.vehicleEnter, (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false, error: 'Belum bergabung.' });
      ackOf(ack)(rt.enterVehicle(socket, (raw as { id?: unknown } | null)?.id));
    });
    socket.on(EV.vehicleExit, (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false, error: 'Belum bergabung.' });
      ackOf(ack)(rt.exitVehicle(socket, raw));
    });
    socket.on(EV.jetpack, (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false, error: 'Belum bergabung.' });
      ackOf(ack)(rt.setJetpack(socket, raw));
    });
    socket.on(EV.riftUse, (raw: unknown, ack: unknown) => {
      if (!rt) return ackOf(ack)({ ok: false, error: 'Belum bergabung.' });
      ackOf(ack)(rt.useRift(socket, (raw as { riftId?: unknown } | null)?.riftId));
    });

    socket.on(EV.buy, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Belum bergabung.' });
      try {
        done(await rt.buy(socket, raw));
      } catch (e) {
        console.error('[buy]', e);
        done({ ok: false, error: 'Gagal membeli. Coba lagi.' });
      }
    });
    socket.on(EV.useItem, async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      if (!rt) return done({ ok: false, error: 'Belum bergabung.' });
      try {
        done(await rt.useItem(socket, raw));
      } catch (e) {
        console.error('[item]', e);
        done({ ok: false, error: 'Gagal memakai barang.' });
      }
    });

    socket.on('disconnect', () => rt?.detach(socket));
  });

  // Dashboard guru: autentikasi lewat cookie httpOnly (atau token di handshake.auth untuk uji)
  teacher.use((socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, COOKIE) ?? (socket.handshake.auth as { token?: string } | undefined)?.token;
    const claims = verifyTeacherToken(token);
    if (!claims) return next(new Error('unauthorized'));
    socket.data.teacher = claims;
    next();
  });

  teacher.on('connection', (socket) => {
    socket.on('watch', async (raw: unknown, ack: unknown) => {
      const done = ackOf(ack);
      const id = (raw as { sessionId?: unknown } | null)?.sessionId;
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return done({ ok: false, error: 'Sesi tidak valid.' });
      const rt = await registry.load(id).catch(() => null);
      if (!rt || rt.teacherId !== socket.data.teacher.sub) return done({ ok: false, error: 'Sesi tidak ditemukan.' });
      for (const room of socket.rooms) if (room.startsWith('t:')) void socket.leave(room);
      void socket.join(rt.teacherRoom);
      done({ ok: true, live: rt.liveData() });
    });
  });
}
