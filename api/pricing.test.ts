import { describe, it, expect } from "vitest";
import {
  findPricing,
  calculateSessionCosts,
  calculateAggregateCosts,
  type TurnUsage,
  type ModelPricing,
} from "./pricing";

// ---------------------------------------------------------------------------
// findPricing — longest prefix match
// ---------------------------------------------------------------------------

describe("findPricing", () => {
  it("exact match", () => {
    const p = findPricing("o3");
    expect(p).toBeDefined();
    expect(p!.name).toBe("o3");
  });

  it("longest prefix beats shorter prefix", () => {
    // "gpt-5.1-codex-mini-20260301" must match "gpt-5.1-codex-mini", not "gpt-5.1" or "gpt-5.1-codex"
    const p = findPricing("gpt-5.1-codex-mini-20260301");
    expect(p).toBeDefined();
    expect(p!.name).toBe("GPT-5.1 Codex Mini");
  });

  it("gpt-5-mini does not match gpt-5", () => {
    const p = findPricing("gpt-5-mini-20260301");
    expect(p).toBeDefined();
    expect(p!.name).toBe("GPT-5 Mini");
  });

  it("claude model with date suffix", () => {
    const p = findPricing("claude-sonnet-4-6-20260301");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Claude Sonnet 4.6");
  });

  it("returns undefined for unknown model", () => {
    expect(findPricing("kimi-pro-v3")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findPricing("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// calculateSessionCosts — long-context + cache pricing
// ---------------------------------------------------------------------------

const SONNET_PRICING: ModelPricing = {
  name: "Claude Sonnet 4.6",
  provider: "claude",
  input: 3.0,
  output: 15.0,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6.0,
  cacheRead: 0.3,
  longContextInput: 6.0,
  longContextOutput: 22.5,
};

describe("calculateSessionCosts", () => {
  it("normal turn uses base pricing", () => {
    // Total input = 100K + 50K + 10K = 160K < 200K threshold
    const turns: TurnUsage[] = [{
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_read_tokens: 50_000,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 10_000,
    }];
    const costs = calculateSessionCosts(turns, SONNET_PRICING);

    expect(costs.input).toBeCloseTo(0.3);         // 100K * $3/MTok
    expect(costs.output).toBeCloseTo(0.75);        // 50K * $15/MTok
    expect(costs.cache_read).toBeCloseTo(0.015);   // 50K * $0.3/MTok
    expect(costs.cache_write_1h).toBeCloseTo(0.06); // 10K * $6/MTok
    expect(costs.has_long_context).toBe(false);
  });

  it("long-context turn applies 2x to input, output, and cache prices", () => {
    // Total input = 100K + 150K cache_read = 250K > 200K threshold
    const turns: TurnUsage[] = [{
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_read_tokens: 150_000,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 20_000,
    }];
    const costs = calculateSessionCosts(turns, SONNET_PRICING);

    // longContextInput/input ratio = 6/3 = 2x
    expect(costs.input).toBeCloseTo(0.6);            // 100K * $6/MTok
    expect(costs.output).toBeCloseTo(1.125);          // 50K * $22.5/MTok
    expect(costs.cache_read).toBeCloseTo(0.09);       // 150K * ($0.3 * 2)/MTok = $0.6/MTok
    expect(costs.cache_write_1h).toBeCloseTo(0.24);   // 20K * ($6 * 2)/MTok = $12/MTok
    expect(costs.has_long_context).toBe(true);
  });

  it("mixed turns: only long turns get long-context pricing", () => {
    const shortTurn: TurnUsage = {
      input_tokens: 50_000,
      output_tokens: 10_000,
      cache_read_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    };
    const longTurn: TurnUsage = {
      input_tokens: 50_000,
      output_tokens: 10_000,
      cache_read_tokens: 200_000,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    };
    const costs = calculateSessionCosts([shortTurn, longTurn], SONNET_PRICING);

    // Short turn input: 50K * $3/MTok = 0.15
    // Long turn input: 50K * $6/MTok = 0.30
    expect(costs.input).toBeCloseTo(0.45);
    expect(costs.has_long_context).toBe(true);
  });

  it("model without longContextInput never triggers long-context", () => {
    const pricing: ModelPricing = {
      name: "Test",
      provider: "claude",
      input: 3.0,
      output: 15.0,
      // no longContextInput
    };
    const turns: TurnUsage[] = [{
      input_tokens: 500_000,
      output_tokens: 100_000,
      cache_read_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    }];
    const costs = calculateSessionCosts(turns, pricing);
    expect(costs.input).toBeCloseTo(1.5); // 500K * $3/MTok (base, not long)
    expect(costs.has_long_context).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateAggregateCosts — Codex (no per-turn, has_long_context = null)
// ---------------------------------------------------------------------------

describe("calculateAggregateCosts", () => {
  it("calculates costs from aggregated totals", () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 200_000,
      cache_read_tokens: 500_000,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    };
    const pricing: ModelPricing = {
      name: "o3",
      provider: "codex",
      input: 2.0,
      output: 8.0,
      cacheRead: 0.5,
    };
    const costs = calculateAggregateCosts(usage, pricing);

    expect(costs.input).toBeCloseTo(2.0);       // 1M * $2/MTok
    expect(costs.output).toBeCloseTo(1.6);       // 200K * $8/MTok
    expect(costs.cache_read).toBeCloseTo(0.25);  // 500K * $0.5/MTok
    expect(costs.total).toBeCloseTo(3.85);
  });

  it("has_long_context is null (unknown)", () => {
    const usage = {
      input_tokens: 500_000,
      output_tokens: 100_000,
      cache_read_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    };
    const pricing: ModelPricing = {
      name: "o3",
      provider: "codex",
      input: 2.0,
      output: 8.0,
    };
    const costs = calculateAggregateCosts(usage, pricing);
    expect(costs.has_long_context).toBeNull();
  });
});
