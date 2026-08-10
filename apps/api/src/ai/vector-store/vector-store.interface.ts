export interface VectorRecord {
  id: string;
  businessId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchOptions {
  businessId: string;
  embedding: number[];
  topK?: number;
  filters?: {
    documentId?: string;
    category?: string;
    userId?: string;
    knowledgeBaseId?: string;
  };
}

export interface VectorMatch {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsertChunks(records: VectorRecord[]): Promise<void>;
  searchChunks(options: VectorSearchOptions): Promise<VectorMatch[]>;
  deleteChunksByDocument(businessId: string, documentId: string): Promise<void>;
  upsertMemories(records: VectorRecord[]): Promise<void>;
  searchMemories(options: VectorSearchOptions): Promise<VectorMatch[]>;
}
