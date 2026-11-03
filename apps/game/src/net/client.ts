/**
 * Sambungan Socket.IO siswa (namespace /play).
 * - Token klaim identitas disimpan per kode kelas → saat tersambung ulang, siswa kembali
 *   ke identitas yang sama tanpa memilih lagi (dan tidak bisa diduplikasi perangkat lain).
 * - Jam server diperkirakan dari serverNow agar timer & bus sama di semua perangkat.
 */
import { io, type Socket } from 'socket.io-client';
import { SERVER_URL, SERVER_LABEL } from './server.js';
import { EV, type AnswerPayload, type AvatarConfig, type SceneId, type SessionPublicState, type RosterEntry, type PublicQuestion, type AnswerResultMsg, type ActivePoint } from '@eduverse/shared';

export interface Me {
  absen: number;
  nama: string;
  avatar: AvatarConfig;
  approved: boolean;
  poin?: number;
  benar?: number;
  dijawab?: number;
  lastScene?: SceneId | null;
}

export interface JoinOk {
  ok: true;
  state: SessionPublicState;
  roster: RosterEntry[];
  preset: boolean;
  requireApproval: boolean;
  me: Me | null;
}
export type Fail = { ok: false; error: string };

const tokenKey = (code: string) => `eduverse.claim.${code.toUpperCase()}`;

export class NetClient {
  readonly socket: Socket;
  code = '';
  private clockOffset = 0;
  private reconnectHandlers = new Set<() => void>();
  connected = false;
  /** Pernah tersambung sejak halaman dibuka (membedakan "server belum bisa dihubungi" dari "putus sementara"). */
  everConnected = false;
  lastError = '';
  private statusHandlers = new Set<(s: { connected: boolean; error: string }) => void>();

  constructor() {
    // Server bisa berada di domain lain (frontend Vercel ↔ backend Render): WebSocket langsung ke sana (WSS).
    this.socket = io(`${SERVER_URL}/play`, { transports: ['websocket', 'polling'], reconnectionDelay: 800, reconnectionDelayMax: 5000, autoConnect: true, timeout: 20000 });
    this.socket.on('connect', () => {
      const was = this.everConnected;
      this.connected = true;
      this.everConnected = true;
      this.lastError = '';
      this.emitStatus();
      if (was || this.code) for (const h of this.reconnectHandlers) h();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emitStatus();
    });
    this.socket.on('connect_error', (e: Error) => {
      this.lastError = e.message;
      this.emitStatus();
    });
    this.socket.on(EV.session, (s: SessionPublicState) => this.syncClock(s.serverNow));
  }

  onStatus(fn: (s: { connected: boolean; error: string }) => void) {
    this.statusHandlers.add(fn);
  }
  private emitStatus() {
    for (const h of this.statusHandlers) h({ connected: this.connected, error: this.lastError });
  }
  /** Pesan yang jujur saat belum/tidak tersambung. */
  offlineMessage() {
    return this.everConnected
      ? 'Koneksi ke server terputus. Menyambung ulang otomatis…'
      : `Server EDUVERSE belum bisa dihubungi (${SERVER_LABEL}). Bila server baru dinyalakan, tunggu ±1 menit lalu coba lagi.`;
  }

  onReconnect(fn: () => void) {
    this.reconnectHandlers.add(fn);
  }

  syncClock(serverNow: number) {
    const off = serverNow - Date.now();
    this.clockOffset = this.clockOffset === 0 ? off : this.clockOffset * 0.7 + off * 0.3;
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  private call<T>(ev: string, data?: unknown, timeout = 8000): Promise<T | Fail> {
    return new Promise((resolve) => {
      this.socket.timeout(timeout).emit(ev, data, (err: Error | null, res: T | Fail) => {
        if (err) resolve({ ok: false, error: this.connected ? 'Server tidak menjawab. Coba lagi.' : this.offlineMessage() });
        else resolve(res);
      });
    });
  }

  claimToken(code: string): string | undefined {
    try {
      return localStorage.getItem(tokenKey(code)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  forgetClaim(code: string) {
    try {
      localStorage.removeItem(tokenKey(code));
    } catch {
      /* abaikan */
    }
  }

  async join(code: string): Promise<JoinOk | Fail> {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const r = await this.call<JoinOk>(EV.join, { code: c, claimToken: this.claimToken(c) });
    if (r.ok) {
      this.code = c;
      this.syncClock(r.state.serverNow);
    }
    return r;
  }

  async claim(absen: number, nama?: string): Promise<{ ok: true; token: string; me: Me } | Fail> {
    const r = await this.call<{ ok: true; token: string; me: Me }>(EV.claimIdentity, { absen, nama });
    if (r.ok) {
      try {
        localStorage.setItem(tokenKey(this.code), r.token);
      } catch {
        /* mode privat: identitas tetap berlaku selama halaman terbuka */
      }
    }
    return r;
  }

  setAvatar(cfg: AvatarConfig) {
    return this.call<{ ok: boolean }>(EV.setAvatar, cfg);
  }

  setReady(v: boolean) {
    this.socket.emit(EV.setReady, v);
  }

  enter(scene: SceneId) {
    return this.call<{ ok: true; spawn: { x: number; y: number; z: number }; points?: ActivePoint[]; done?: string[] }>(EV.enterWorld, { scene });
  }

  sendState(s: { scene: SceneId; x: number; y: number; z: number; ry: number; anim: number; riding: boolean }) {
    if (this.connected) this.socket.volatile.emit(EV.state, s);
  }

  interact(pointId: string) {
    return this.call<{ ok: true; question: PublicQuestion }>(EV.interact, { pointId });
  }

  answer(token: string, answer: AnswerPayload) {
    return this.call<{ ok: true; result: AnswerResultMsg }>(EV.answer, { token, answer });
  }

  closeQuestion() {
    this.socket.emit(EV.closeQuestion);
  }

  emote(id: number) {
    this.socket.emit(EV.emote, id);
  }

  useLift(liftId: string) {
    return this.call<{ ok: true; target: { x: number; y: number; z: number } }>(EV.useLift, { liftId });
  }

  on<T = unknown>(ev: string, fn: (d: T) => void) {
    this.socket.on(ev, fn as (...a: unknown[]) => void);
  }
}
