import {
  calculateAggregateCosts,
  calculateSessionCosts,
  findPricing,
  type TurnUsage,
} from "./pricing";
import type { ProviderName } from "./provider-types";
import type {
  ContentBlock,
  ConversationMessage,
  SearchResult,
  Session,
  SessionMeta,
  SessionTokenUsage,
  StreamResult,
} from "./storage";

interface DemoSessionRecord {
  session: Session;
  messages: ConversationMessage[];
  meta: SessionMeta;
}

const DEMO_PROJECT = "/workspace/agents-run";
const DEMO_PROJECT_NAME = "agents-run";

function iso(value: string): string {
  return new Date(value).toISOString();
}

function text(textValue: string): ContentBlock {
  return { type: "text", text: textValue };
}

function thinking(thinkingValue: string): ContentBlock {
  return { type: "thinking", thinking: thinkingValue };
}

function toolUse(id: string, name: string, input: Record<string, unknown>): ContentBlock {
  return { type: "tool_use", id, name, input };
}

function toolResult(
  toolUseId: string,
  content: string,
  isError = false,
): ContentBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}

function userMessage(
  uuid: string,
  timestamp: string,
  content: string | ContentBlock[],
): ConversationMessage {
  return {
    type: "user",
    uuid,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantMessage(
  uuid: string,
  parentUuid: string,
  timestamp: string,
  model: string,
  content: string | ContentBlock[],
): ConversationMessage {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    timestamp,
    message: {
      role: "assistant",
      model,
      content,
    },
  };
}

function sumTurnUsage(turns: TurnUsage[]): SessionTokenUsage {
  return turns.reduce<SessionTokenUsage>(
    (acc, turn) => ({
      input_tokens: acc.input_tokens + turn.input_tokens,
      output_tokens: acc.output_tokens + turn.output_tokens,
      cache_write_5m_tokens:
        acc.cache_write_5m_tokens + turn.cache_write_5m_tokens,
      cache_write_1h_tokens:
        acc.cache_write_1h_tokens + turn.cache_write_1h_tokens,
      cache_read_tokens: acc.cache_read_tokens + turn.cache_read_tokens,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cache_read_tokens: 0,
    },
  );
}

function buildTurnMeta(model: string, turns: TurnUsage[]): SessionMeta {
  const pricing = findPricing(model);
  return {
    usage: sumTurnUsage(turns),
    subagents: [],
    model,
    costs: pricing ? calculateSessionCosts(turns, pricing) : null,
  };
}

function buildAggregateMeta(
  model: string,
  usage: SessionTokenUsage,
): SessionMeta {
  const pricing = findPricing(model);
  return {
    usage,
    subagents: [],
    model,
    costs: pricing ? calculateAggregateCosts(usage, pricing) : null,
  };
}

const claudeModel = "claude-sonnet-4-6-20260301";
const claudeTurns: TurnUsage[] = [
  {
    input_tokens: 148_000,
    output_tokens: 8_200,
    cache_read_tokens: 56_000,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 12_000,
  },
  {
    input_tokens: 236_000,
    output_tokens: 12_900,
    cache_read_tokens: 41_000,
    cache_write_5m_tokens: 14_000,
    cache_write_1h_tokens: 0,
  },
];

const codexModel = "gpt-5.1-codex-mini-20260301";
const codexUsage: SessionTokenUsage = {
  input_tokens: 428_000,
  output_tokens: 23_800,
  cache_write_5m_tokens: 0,
  cache_write_1h_tokens: 0,
  cache_read_tokens: 0,
};

const geminiModel = "gemini-2.5-pro";
const geminiTurns: TurnUsage[] = [
  {
    input_tokens: 92_000,
    output_tokens: 10_400,
    cache_read_tokens: 36_000,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
  },
  {
    input_tokens: 124_000,
    output_tokens: 14_600,
    cache_read_tokens: 84_000,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
  },
];

const demoRecords: DemoSessionRecord[] = [
  {
    session: {
      id: "demo-claude-readme-privacy",
      display: "Refactor README demo flow and keep local history private",
      timestamp: Date.parse("2026-03-21T14:42:00+08:00"),
      project: DEMO_PROJECT,
      projectName: DEMO_PROJECT_NAME,
      messageCount: 7,
      model: claudeModel,
      provider: "claude",
      surface: "cli",
    },
    meta: buildTurnMeta(claudeModel, claudeTurns),
    messages: [
      {
        type: "summary",
        summary:
          "Switch the README demo generator to a synthetic backend so screenshots never expose real prompts, paths, or usernames.",
      },
      userMessage(
        "claude-user-1",
        iso("2026-03-21T14:05:00+08:00"),
        "I want a polished README demo GIF, but it cannot reveal any local prompts, file paths, or account names.",
      ),
      assistantMessage(
        "claude-assistant-1",
        "claude-user-1",
        iso("2026-03-21T14:06:00+08:00"),
        claudeModel,
        [
          text(
            "I'll keep the existing UI and swap only the data source. The safer path is a dedicated demo mode that serves synthetic sessions through the same API routes.",
          ),
          thinking(
            "The current generator points at the live server, so the README asset can accidentally include anything in ~/.claude, ~/.codex, or ~/.gemini.",
          ),
          toolUse("claude-tool-1", "read_file", {
            file_path: "/workspace/agents-run/api/server.ts",
          }),
          toolResult(
            "claude-tool-1",
            [
              "app.get('/api/providers', ...)",
              "app.get('/api/sessions', ...)",
              "app.get('/api/conversation/:id/meta', ...)",
              "app.get('/api/conversation/:id/stream', ...)",
            ].join("\n"),
          ),
        ],
      ),
      userMessage(
        "claude-user-2",
        iso("2026-03-21T14:11:00+08:00"),
        "Good. Keep the live app unchanged for normal users and make the demo path explicit.",
      ),
      assistantMessage(
        "claude-assistant-2",
        "claude-user-2",
        iso("2026-03-21T14:15:00+08:00"),
        claudeModel,
        [
          text(
            "I added an `AGENTS_RUN_DEMO=1` branch so the same frontend can render fixed sessions for Claude, Codex, and Gemini without touching any real history.",
          ),
          toolUse("claude-tool-2", "replace", {
            file_path: "/workspace/agents-run/api/server.ts",
            old_string: "const sessions = await providerManager.getSessions(provider);",
            new_string:
              "const sessions = await dataSource.getSessions(provider);",
          }),
          toolResult("claude-tool-2", "Updated route handlers to read from a shared data source abstraction."),
          toolUse("claude-tool-3", "write_file", {
            file_path: "/workspace/agents-run/api/demo-data.ts",
            content:
              "export const demoManager = { getSessions, getConversation, getSessionMeta, searchConversations }",
          }),
          toolResult(
            "claude-tool-3",
            "Created synthetic sessions with fake project paths, fake prompts, and deterministic token/cost summaries.",
          ),
        ],
      ),
      userMessage(
        "claude-user-3",
        iso("2026-03-21T14:21:00+08:00"),
        "After that, regenerate the GIF so the README only shows synthetic data.",
      ),
      assistantMessage(
        "claude-assistant-3",
        "claude-user-3",
        iso("2026-03-21T14:24:00+08:00"),
        claudeModel,
        [
          text(
            "The generator now boots an isolated demo server on its own port, waits for the synthetic API to come up, and records the same UI flow against fake sessions.",
          ),
          toolUse("claude-tool-4", "exec_command", {
            cmd: "pnpm demo:gif",
            workdir: "/workspace/agents-run",
          }),
          toolResult(
            "claude-tool-4",
            [
              "Running demo build...",
              "Starting demo server on http://localhost:12011",
              "Captured overview, filtered search, Claude, Codex, and Gemini session states",
              "Wrote .github/agents-run.gif",
            ].join("\n"),
          ),
          text(
            "That keeps the README asset reproducible and safe to refresh before every release.",
          ),
        ],
      ),
    ],
  },
  {
    session: {
      id: "demo-codex-provider-badges",
      display: "Implement provider badges and tighten multi-model session search",
      timestamp: Date.parse("2026-03-21T13:18:00+08:00"),
      project: DEMO_PROJECT,
      projectName: DEMO_PROJECT_NAME,
      messageCount: 7,
      model: codexModel,
      provider: "codex",
      surface: "cli",
    },
    meta: buildAggregateMeta(codexModel, codexUsage),
    messages: [
      {
        type: "summary",
        summary:
          "Add provider badges, keep search readable across mixed session sources, and preserve correct cost lookup for Codex model variants.",
      },
      userMessage(
        "codex-user-1",
        iso("2026-03-21T12:42:00+08:00"),
        "The sidebar needs clearer provider badges and search should still work cleanly once Claude, Codex, and Gemini sessions are mixed together.",
      ),
      assistantMessage(
        "codex-assistant-1",
        "codex-user-1",
        iso("2026-03-21T12:44:00+08:00"),
        codexModel,
        [
          text(
            "I'll keep the row layout compact: project name on the left, provider badge inline, then timestamp and message count on the right.",
          ),
          toolUse("codex-tool-1", "exec_command", {
            cmd: "rg -n \"getCliProviderInfo|getProviderInfo\" web",
            workdir: "/workspace/agents-run",
          }),
          toolResult(
            "codex-tool-1",
            [
              "web/components/session-list.tsx:4:import { formatTime, getProviderInfo, getCliProviderInfo } from \"../utils\";",
              "web/utils.ts:33:export function getProviderInfo(model?: string): ProviderInfo | null {",
            ].join("\n"),
          ),
        ],
      ),
      userMessage(
        "codex-user-2",
        iso("2026-03-21T12:49:00+08:00"),
        "Make sure the model pricing lookup still picks the most specific model id once we show more variants.",
      ),
      assistantMessage(
        "codex-assistant-2",
        "codex-user-2",
        iso("2026-03-21T12:53:00+08:00"),
        codexModel,
        [
          text(
            "I kept the longest-prefix lookup so `gpt-5.1-codex-mini-20260301` resolves to the Codex Mini rate instead of falling back to the parent `gpt-5.1` bucket.",
          ),
          toolUse("codex-tool-2", "read_file", {
            file_path: "/workspace/agents-run/api/pricing.ts",
          }),
          toolResult(
            "codex-tool-2",
            [
              "const prefixMatches = Object.keys(ALL_PRICING)",
              "  .filter((k) => normalized.startsWith(k))",
              "  .sort((a, b) => b.length - a.length);",
            ].join("\n"),
          ),
          toolUse("codex-tool-3", "exec_command", {
            cmd: "pnpm test -- pricing",
            workdir: "/workspace/agents-run",
          }),
          toolResult(
            "codex-tool-3",
            [
              "findPricing > longest prefix beats shorter prefix",
              "findPricing > gpt-5-mini does not match gpt-5",
              "calculateAggregateCosts > has_long_context is null (unknown)",
              "PASS",
            ].join("\n"),
          ),
        ],
      ),
      userMessage(
        "codex-user-3",
        iso("2026-03-21T12:58:00+08:00"),
        "Keep the session rows lightweight. The badge should help scanning, not dominate the list.",
      ),
      assistantMessage(
        "codex-assistant-3",
        "codex-user-3",
        iso("2026-03-21T13:02:00+08:00"),
        codexModel,
        [
          text(
            "The final row keeps the visual weight low: the provider tag stays small, the title stays readable, and the search flow still feels fast with virtualized rows.",
          ),
        ],
      ),
    ],
  },
  {
    session: {
      id: "demo-gemini-design-export",
      display: "Design the landing flow and clean up markdown export output",
      timestamp: Date.parse("2026-03-21T11:07:00+08:00"),
      project: DEMO_PROJECT,
      projectName: DEMO_PROJECT_NAME,
      messageCount: 7,
      model: geminiModel,
      provider: "gemini",
      surface: "cli",
    },
    meta: buildTurnMeta(geminiModel, geminiTurns),
    messages: [
      {
        type: "summary",
        summary:
          "Polish the landing experience, improve markdown export readability, and keep per-session usage summaries obvious for Gemini runs too.",
      },
      userMessage(
        "gemini-user-1",
        iso("2026-03-21T10:34:00+08:00"),
        "The landing flow feels generic. I want the app to look intentional, and the markdown export should read cleanly when shared outside the UI.",
      ),
      assistantMessage(
        "gemini-assistant-1",
        "gemini-user-1",
        iso("2026-03-21T10:36:00+08:00"),
        geminiModel,
        [
          text(
            "I'll keep the existing shell, but tighten the presentation: stronger hierarchy in the session header, cleaner exported markdown, and clearer token totals for each provider.",
          ),
          toolUse("gemini-tool-1", "read_file", {
            file_path: "/workspace/agents-run/web/components/markdown-export.tsx",
          }),
          toolResult(
            "gemini-tool-1",
            [
              "const title = `${session.display} · ${session.projectName}`;",
              "const blocks = messages.map(renderMessage).join(\"\\n\\n\");",
              "return `# ${title}\\n\\n${blocks}`;",
            ].join("\n"),
          ),
        ],
      ),
      userMessage(
        "gemini-user-2",
        iso("2026-03-21T10:43:00+08:00"),
        "The export should preserve tool activity, but not turn into unreadable JSON.",
      ),
      assistantMessage(
        "gemini-assistant-2",
        "gemini-user-2",
        iso("2026-03-21T10:47:00+08:00"),
        geminiModel,
        [
          text(
            "I flattened the export into readable sections, kept tool names visible, and trimmed noisy payloads so the markdown still works as a project log.",
          ),
          toolUse("gemini-tool-2", "write_file", {
            file_path: "/workspace/agents-run/web/components/markdown-export.tsx",
            content:
              "Render assistant text first, then summarize tool calls with short previews and fenced output blocks.",
          }),
          toolResult(
            "gemini-tool-2",
            "Markdown export now keeps the narrative readable while still preserving the important execution steps.",
          ),
        ],
      ),
      userMessage(
        "gemini-user-3",
        iso("2026-03-21T10:55:00+08:00"),
        "Good. Make the token totals obvious enough that I can compare providers at a glance.",
      ),
      assistantMessage(
        "gemini-assistant-3",
        "gemini-user-3",
        iso("2026-03-21T10:59:00+08:00"),
        geminiModel,
        [
          text(
            "The session view now keeps input, cache read, and output costs in one compact card so a Gemini session reads the same way as Claude and Codex.",
          ),
          toolUse("gemini-tool-3", "exec_command", {
            cmd: "pnpm build",
            workdir: "/workspace/agents-run",
          }),
          toolResult(
            "gemini-tool-3",
            [
              "vite build --config web/vite.config.ts",
              "tsup api/index.ts --format esm --dts --clean",
              "Build completed successfully",
            ].join("\n"),
          ),
        ],
      ),
    ],
  },
];

const demoSessionsById = new Map(
  demoRecords.map((record) => [record.session.id, record]),
);

function normalize(textValue: string): string {
  return textValue.toLowerCase();
}

function flattenBlocks(blocks: ContentBlock[]): string[] {
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
      continue;
    }

    if (block.type === "thinking" && block.thinking) {
      parts.push(block.thinking);
      continue;
    }

    if (block.type === "tool_use") {
      if (block.name) {
        parts.push(block.name);
      }
      if (block.input) {
        parts.push(JSON.stringify(block.input));
      }
      continue;
    }

    if (block.type === "tool_result") {
      if (typeof block.content === "string") {
        parts.push(block.content);
      } else if (Array.isArray(block.content)) {
        parts.push(...flattenBlocks(block.content));
      }
    }
  }

  return parts;
}

function messageSearchText(message: ConversationMessage): string {
  if (message.type === "summary") {
    return message.summary ?? "";
  }

  const content = message.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return flattenBlocks(content).join("\n");
  }
  return "";
}

function countOccurrences(source: string, query: string): number {
  if (!query) {
    return 0;
  }

  let count = 0;
  let index = source.indexOf(query);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(query, index + query.length);
  }
  return count;
}

function buildSnippet(source: string, query: string): string {
  const lowerSource = normalize(source);
  const lowerQuery = normalize(query);
  const index = lowerSource.indexOf(lowerQuery);

  if (index === -1) {
    return source.slice(0, 160);
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + query.length + 90);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}

function createSearchResult(
  record: DemoSessionRecord,
  query: string,
): SearchResult | null {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return null;
  }

  const searchableMessages = record.messages.map(messageSearchText);
  const searchableParts = [
    record.session.display,
    record.session.projectName,
    ...searchableMessages,
  ];
  const searchableText = searchableParts.join("\n");
  const normalizedText = normalize(searchableText);

  if (!normalizedText.includes(normalizedQuery)) {
    return null;
  }

  let firstMessageIndex = 0;
  let firstSnippetSource = searchableText;

  for (const [index, messageText] of searchableMessages.entries()) {
    if (normalize(messageText).includes(normalizedQuery)) {
      firstMessageIndex = index;
      firstSnippetSource = messageText;
      break;
    }
  }

  return {
    sessionId: record.session.id,
    display: record.session.display,
    projectName: record.session.projectName,
    timestamp: record.session.timestamp,
    matchCount: countOccurrences(normalizedText, normalizedQuery),
    firstMatch: {
      messageIndex: firstMessageIndex,
      text: query,
      snippet: buildSnippet(firstSnippetSource, query),
    },
  };
}

export const demoManager = {
  async init(_claudeDir?: string): Promise<void> {
    // Static data only.
  },

  async getSessions(provider?: ProviderName): Promise<Session[]> {
    return demoRecords
      .filter((record) => !provider || record.session.provider === provider)
      .map((record) => record.session)
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  async getProjects(provider?: ProviderName): Promise<string[]> {
    const sessions = await this.getSessions(provider);
    return [...new Set(sessions.map((session) => session.project))].sort();
  },

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    return demoSessionsById.get(sessionId)?.messages ?? [];
  },

  async getConversationStream(
    sessionId: string,
    fromOffset: number,
  ): Promise<StreamResult> {
    const messages = demoSessionsById.get(sessionId)?.messages ?? [];
    return {
      messages: messages.slice(fromOffset),
      nextOffset: messages.length,
    };
  },

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    return (
      demoSessionsById.get(sessionId)?.meta ?? {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_write_5m_tokens: 0,
          cache_write_1h_tokens: 0,
          cache_read_tokens: 0,
        },
        subagents: [],
        costs: null,
      }
    );
  },

  async searchConversations(
    query: string,
    provider?: ProviderName,
  ): Promise<SearchResult[]> {
    return demoRecords
      .filter((record) => !provider || record.session.provider === provider)
      .map((record) => createSearchResult(record, query))
      .filter((result): result is SearchResult => result !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  getProviderForSession(sessionId: string): ProviderName | undefined {
    return demoSessionsById.get(sessionId)?.session.provider;
  },

  async deleteSession(): Promise<"unsupported"> {
    return "unsupported";
  },

  getAvailableProviders(): ProviderName[] {
    return ["claude", "codex", "gemini"];
  },
};
