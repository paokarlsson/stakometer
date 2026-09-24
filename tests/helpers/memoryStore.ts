import type { Chunk, Session, SessionStore } from '../../src/storage/types';

/** In-memory SessionStore for tests. Values are cloned like IndexedDB's structured clone. */
export class MemoryStore implements SessionStore {
  readonly sessions = new Map<string, Session>();
  readonly chunks = new Map<string, Chunk>();

  async putSession(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async getSession(id: string): Promise<Session | undefined> {
    const s = this.sessions.get(id);
    return s && structuredClone(s);
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((s) => structuredClone(s));
  }

  async putChunk(chunk: Chunk): Promise<void> {
    this.chunks.set(`${chunk.sessionId}/${chunk.seq}`, structuredClone(chunk));
  }

  async getChunks(sessionId: string): Promise<Chunk[]> {
    return [...this.chunks.values()].filter((c) => c.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
  }
}
