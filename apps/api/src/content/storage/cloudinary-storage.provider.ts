import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type {
  StorageProvider,
  StorageUploadInput,
  StorageUploadResult,
} from './storage.provider';

@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  private readonly logger = new Logger(CloudinaryStorageProvider.name);
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    const cloudName =
      this.config.get<string>('CLOUDINARY_CLOUD_NAME') ||
      this.config.get<string>('CLOUDINARY_CLOUD') ||
      '';
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY') || '';
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET') || '';
    const cloudinaryUrl = this.config.get<string>('CLOUDINARY_URL') || '';

    if (cloudinaryUrl) {
      process.env.CLOUDINARY_URL = cloudinaryUrl;
      cloudinary.config(true);
      this.configured = true;
    } else if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.configured = true;
    } else {
      this.configured = false;
      this.logger.warn(
        'Cloudinary no configurado (CLOUDINARY_URL o CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)',
      );
    }
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary no está configurado. Agregá CLOUDINARY_URL en el .env',
      );
    }

    const resourceType = input.resourceType ?? 'image';
    try {
      if (resourceType === 'video') {
        const result = await this.uploadVideo(input);
        return result;
      }

      const dataUri = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
      const result = await cloudinary.uploader.upload(dataUri, {
        folder: input.folder,
        public_id: input.publicId,
        resource_type: 'image',
        overwrite: true,
      });

      return {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format,
      };
    } catch (error) {
      const raw =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : error instanceof Error
            ? error.message
            : 'Error desconocido de Cloudinary';
      const httpCode =
        error && typeof error === 'object' && 'http_code' in error
          ? Number((error as { http_code: unknown }).http_code)
          : undefined;

      this.logger.error(
        `Cloudinary upload failed (${httpCode ?? '?'}): ${raw}`,
      );

      if (
        httpCode === 403 ||
        /missing permissions|actions=\["create"\]/i.test(raw)
      ) {
        throw new Error(
          'Cloudinary rechazó el upload (403): la API Key no tiene permiso "create/upload". En Cloudinary → Settings → API Keys, editá la key (o creá una nueva con rol Full/Editor) y actualizá CLOUDINARY_API_KEY/SECRET en el .env.',
          { cause: error },
        );
      }

      throw new Error(`Cloudinary upload falló: ${raw}`, { cause: error });
    }
  }

  private uploadVideo(input: StorageUploadInput): Promise<StorageUploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: input.folder,
          public_id: input.publicId,
          resource_type: 'video',
          overwrite: true,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary video upload vacío'));
            return;
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            format: result.format,
          });
        },
      );
      stream.end(input.buffer);
    });
  }

  async delete(
    publicId: string,
    resourceType: 'image' | 'video' = 'image',
  ): Promise<void> {
    if (!this.configured) return;
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
  }

  /**
   * Instagram Story no muestra `caption` como texto visible: hay que quemarlo
   * en la imagen. Un solo bloque al pie, tipografía uniforme, wrap completo.
   */
  buildTextOverlayUrl(input: {
    publicId?: string | null;
    fallbackUrl: string;
    headline?: string | null;
    caption?: string | null;
  }): string {
    if (!this.configured || !input.publicId) return input.fallbackUrl;

    const body = this.buildStoryOverlayBody(input.headline, input.caption);
    if (!body) return input.fallbackUrl;

    // gravity/y van en el paso fl_layer_apply (no mezclados con l_text),
    // si no Cloudinary suele centrar el overlay.
    const layers: Record<string, unknown>[] = [
      { width: 1080, height: 1920, crop: 'fill', gravity: 'auto' },
      {
        overlay: {
          font_family: 'Arial',
          font_size: 30,
          font_weight: 'normal',
          text_align: 'center',
          line_spacing: 8,
          text: body,
        },
        color: '#FFFFFF',
        background: '#000000CC',
        width: 980,
        crop: 'fit',
      },
      {
        gravity: 'south',
        y: 72,
        flags: 'layer_apply',
      },
    ];

    try {
      return cloudinary.url(input.publicId, {
        secure: true,
        transformation: layers,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo armar overlay Cloudinary: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return input.fallbackUrl;
    }
  }

  private buildStoryOverlayBody(
    headline?: string | null,
    caption?: string | null,
  ): string {
    // Cap generoso: en Story ~980px de ancho / 30px ≈ 40–45 chars/línea.
    // Sin `height` en c_fit Cloudinary no corta con "…".
    const h = this.sanitizeOverlayText(headline, 180);
    const c = this.sanitizeOverlayText(caption, 900);
    if (h && c) {
      if (c.toLowerCase().startsWith(h.toLowerCase())) return c;
      return `${h}\n${c}`;
    }
    return h || c;
  }

  private sanitizeOverlayText(
    value: string | null | undefined,
    maxLen: number,
  ): string {
    const cleaned = (value ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!cleaned) return '';
    if (cleaned.length <= maxLen) return cleaned;
    const cut = cleaned.slice(0, maxLen);
    const atSpace = cut.lastIndexOf(' ');
    const safe = (
      atSpace > maxLen * 0.6 ? cut.slice(0, atSpace) : cut
    ).trimEnd();
    return safe;
  }
}
