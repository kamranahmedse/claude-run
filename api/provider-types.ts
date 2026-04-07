import type {
  Session,
  ConversationMessage,
  StreamResult,
  SessionMeta,
  SearchResult,
} from "./storage";

export type ProviderName = "claude" | "codex" | "gemini";

export interface ProviderAdapter {
  readonly name: ProviderName;

  init(): Promise<void>;
  getWatchPaths(): { paths: string[]; depth: number };
  getSessions(): Promise<Session[]>;
  getProjects(): Promise<string[]>;
  getConversation(sessionId: string): Promise<ConversationMessage[]>;
  getConversationStream(sessionId: string, fromOffset: number): Promise<StreamResult>;
  getSessionMeta(sessionId: string): Promise<SessionMeta>;
  searchConversations(query: string): Promise<SearchResult[]>;
  ownsSession(sessionId: string): boolean;
  deleteSession?(sessionId: string): Promise<boolean>;
  invalidateHistoryCache(): void;
  invalidateSessionMeta(sessionId: string): void;
  addToFileIndex(sessionId: string, filePath: string): void;
  resolveSessionId(filePath: string): string | null;
}
