export interface StorageUploadInput {
  buffer: Buffer;
  mimeType: string;
  folder: string;
  publicId?: string;
  resourceType?: 'image' | 'video';
}

export interface StorageUploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
}

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  delete?(publicId: string, resourceType?: 'image' | 'video'): Promise<void>;
  /** URL con texto superpuesto (Story/Status). Si no hay publicId, devuelve fallbackUrl. */
  buildTextOverlayUrl?(input: {
    publicId?: string | null;
    fallbackUrl: string;
    headline?: string | null;
    caption?: string | null;
  }): string;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
