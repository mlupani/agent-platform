export interface LoadedDocument {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentLoader {
  readonly mimeTypes: string[];
  load(buffer: Buffer, filename: string): Promise<LoadedDocument>;
}
