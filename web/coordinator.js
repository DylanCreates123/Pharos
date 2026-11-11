import {read, save} from './config.js';

export class Coordinator {
  constructor(render, now = Date.now, request = globalThis.fetch.bind(globalThis)) {
    this.render = render;
    this.now = now;
    this.request = request;
    this.records = new Map(Object.entries(read('cache', {})));
    this.active = new Map();
    this.consumers = new Map();
    this.pending = new Set();
    this.retry = new Map();
    this.paused = false;
  }

  subscribe(id, requirements) {
    this.consumers.set(id, requirements);
    this.active.clear();
    for (const list of this.consumers.values()) for (const req of list) {
      const current = this.active.get(req.key);
      if (!current || current.age > req.age) this.active.set(req.key, req);
    }
    this.scan();
  }

  pause(paused) {
    this.paused = paused;
    this.scan();
  }

  record(req) { return this.records.get(req.key); }

  scan() {
    clearTimeout(this.timer);
    if (this.paused) return;
    const now = this.now()/1000;
    let next = Infinity;
    for (const req of this.active.values()) {
      if (this.pending.has(req.key)) continue;
      const record = this.record(req);
      const due = Math.max((record?.next_refresh ?? (record?.fetched_at ?? -Infinity) + req.age),
        record?.retry_at ?? 0, this.retry.get(req.key) ?? 0);
      if (due <= now) this.refresh(req);
      else next = Math.min(next, due);
    }
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.scan(), Math.max(10,(next-now)*1000));
  }

  async refresh(req) {
    if (this.paused || !this.active.has(req.key) || this.pending.has(req.key)) return;
    const before = this.record(req);
    if (Math.max(before?.retry_at ?? 0, this.retry.get(req.key) ?? 0) > this.now()/1000) return;
    this.pending.add(req.key);
    this.render();
    try {
      const wallpaper = req.kind === 'wallpaper';
      const url = wallpaper ? '/api/'+req.key : '/api/data/'+req.key+'&max_age='+req.age;
      const response = await this.request(url,{signal:AbortSignal.timeout(wallpaper ? 15000 : 8000)});
      if (!response.ok) throw new Error('Server unavailable');
      const incoming = await response.json();
      const result = incoming.payload === undefined && before?.payload !== undefined
        ? {...before, status:incoming.status, error:incoming.error, retry_at:incoming.retry_at, next_refresh:incoming.next_refresh ?? before.next_refresh}
        : incoming;
      this.records.set(req.key, result);
      if (result.payload !== undefined) {
        try {
          const cached = Object.entries(read('cache', {})).filter(([key]) => key !== req.key);
          save('cache', Object.fromEntries([...cached.slice(-23), [req.key,result]]));
        } catch { /* Storage quota does not discard the in-memory record. */ }
      }
      const now = this.now()/1000;
      if (result.status === 'unavailable') {
        this.retry.set(req.key, now + req.age);
      } else if ((result.fetched_at ?? -Infinity) + req.age <= now && !(result.retry_at > now)) {
        this.retry.set(req.key, now + 30);
      } else {
        this.retry.delete(req.key);
      }
    } catch {
      this.records.set(req.key, {...before, status:'offline', error:'Local server unreachable'});
      this.retry.set(req.key, this.now()/1000 + 30);
    } finally {
      this.pending.delete(req.key);
      if (this.active.has(req.key)) this.render();
      this.scan();
    }
  }
}


