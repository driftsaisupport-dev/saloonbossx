// expo-sqlite stand-in backed by node:sqlite (real SQLite engine) for integration tests.
import { DatabaseSync } from 'node:sqlite';
const dbs = (globalThis.__sbxTestDbs ||= new Map());
const norm = (params) => {
  const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
};
class Conn {
  constructor(d) { this.d = d; }
  async execAsync(sql) { this.d.exec(sql); }
  async runAsync(sql, ...params) {
    const r = this.d.prepare(sql).run(...norm(params));
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  async getFirstAsync(sql, ...params) {
    const r = this.d.prepare(sql).get(...norm(params));
    return r ? { ...r } : null;
  }
  async getAllAsync(sql, ...params) { return this.d.prepare(sql).all(...norm(params)).map((r) => ({ ...r })); }
  async closeAsync() {}
}
export async function openDatabaseAsync(name) {
  if (!dbs.has(name)) dbs.set(name, new DatabaseSync(':memory:'));
  return new Conn(dbs.get(name));
}
