import { Injectable } from '@nestjs/common';

interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-flash-latest': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-flash-lite-latest': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0 },
};

@Injectable()
export class CostService {
  estimate(model: string, inputTokens: number, outputTokens: number): number {
    const price = MODEL_PRICES[model] ?? MODEL_PRICES['gpt-4.1-mini'];
    return Number(
      (
        (inputTokens / 1_000_000) * price.inputPerMillion +
        (outputTokens / 1_000_000) * price.outputPerMillion
      ).toFixed(6),
    );
  }
}
