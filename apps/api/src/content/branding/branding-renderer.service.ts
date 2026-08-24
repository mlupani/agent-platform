import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { loadBrandingConfig, type LogoPosition } from './branding.config';

export interface BrandingApplyInput {
  imageBuffer: Buffer;
  logoUrl?: string | null;
  mimeType?: string;
  headline?: string | null;
  businessName?: string | null;
  format?: string | null;
  forceHeadline?: boolean;
}

export interface BrandingApplyResult {
  buffer: Buffer;
  applied: boolean;
  mimeType: string;
}

@Injectable()
export class BrandingRenderer {
  private readonly logger = new Logger(BrandingRenderer.name);

  constructor(private readonly config: ConfigService) {}

  async apply(input: BrandingApplyInput): Promise<BrandingApplyResult> {
    const branding = loadBrandingConfig(this.config);
    const originalMime = input.mimeType || 'image/png';

    if (!branding.enabled) {
      this.logger.log('[BRANDING] Branding disabled via config');
      return { buffer: input.imageBuffer, applied: false, mimeType: originalMime };
    }

    const logoUrl = input.logoUrl?.trim() || null;
    const headline = input.headline?.trim() || null;
    const hasLogo = Boolean(logoUrl && branding.logo.enabled);
    const hasText = Boolean(headline && (branding.text.enabled || input.forceHeadline));

    if (!hasLogo && !hasText) {
      this.logger.log('[BRANDING] Logo found: false — skipping branding (no logo, no headline)');
      return { buffer: input.imageBuffer, applied: false, mimeType: originalMime };
    }

    if (hasLogo) this.logger.log('[BRANDING] Logo found: true');
    else this.logger.log('[BRANDING] Logo found: false — skipping logo');
    if (hasText) this.logger.log(`[BRANDING] Headline found: "${headline?.slice(0, 80)}"`);
    if (logoUrl) this.logger.log(`[BRANDING] Logo URL: ${logoUrl}`);

    try {
      const baseMeta = await sharp(input.imageBuffer).metadata();
      const baseWidth = baseMeta.width ?? 1024;
      const baseHeight = baseMeta.height ?? 1024;
      this.logger.log(`[BRANDING] Output image dimensions: ${baseWidth}x${baseHeight}`);

      const composites: Array<{ input: Buffer; left: number; top: number }> = [];
      let anyApplied = false;

      // 1) Headline text overlay (only for FEED_SQUARE to avoid cut; other formats use model text)
      if (hasText && headline) {
        try {
          const textOverlay = await this.buildHeadlineOverlay(
            headline,
            baseWidth,
            baseHeight,
            branding,
            input.format,
          );
          if (textOverlay) {
            composites.push(textOverlay);
            anyApplied = true;
            this.logger.log(`[BRANDING] Text overlay: ${textOverlay.left},${textOverlay.top} ${textOverlay.input.length} bytes`);
          }
        } catch (error) {
          this.logger.warn(
            `[BRANDING] Text overlay failed, skipping text: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }

      // 2) Logo overlay
      if (hasLogo && logoUrl) {
        try {
          const logoBuffer = await this.downloadLogo(logoUrl);
          if (!logoBuffer || !logoBuffer.length) {
            this.logger.warn('[BRANDING] Logo download returned empty buffer — skipping logo');
          } else {
            let logoMeta: sharp.Metadata;
            try {
              logoMeta = await sharp(logoBuffer).metadata();
            } catch {
              logoMeta = await sharp(logoBuffer, { density: 300 }).metadata();
            }
            const logoOriginalWidth = logoMeta.width ?? 200;
            const logoOriginalHeight = logoMeta.height ?? 200;
            this.logger.log(`[BRANDING] Logo original dimensions: ${logoOriginalWidth}x${logoOriginalHeight}`);

            const widthPercent = branding.logo.widthPercent;
            const marginPercent = branding.logo.marginPercent;
            const targetWidth = Math.max(16, Math.round(baseWidth * (widthPercent / 100)));
            const aspect = logoOriginalHeight / logoOriginalWidth;
            const targetHeight = Math.max(16, Math.round(targetWidth * aspect));
            this.logger.log(`[BRANDING] Logo target dimensions: ${targetWidth}x${targetHeight} (widthPercent=${widthPercent}%)`);

            const resizedLogo = await sharp(logoBuffer, { density: 300 })
              .resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: false })
              .png()
              .toBuffer();

            const resizedMeta = await sharp(resizedLogo).metadata();
            const finalLogoWidth = resizedMeta.width ?? targetWidth;
            const finalLogoHeight = resizedMeta.height ?? targetHeight;
            const margin = Math.round(baseWidth * (marginPercent / 100));
            const { left, top } = this.calculatePosition(
              branding.logo.position,
              baseWidth,
              baseHeight,
              finalLogoWidth,
              finalLogoHeight,
              margin,
            );
            this.logger.log(`[BRANDING] Logo position: ${branding.logo.position} -> left=${left}, top=${top}, margin=${margin}px`);
            composites.push({ input: resizedLogo, left, top });
            anyApplied = true;
          }
        } catch (error) {
          this.logger.warn(
            `[BRANDING] Logo overlay failed: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }

      if (!composites.length) {
        return { buffer: input.imageBuffer, applied: false, mimeType: originalMime };
      }

      // Single Sharp composite with all layers — logo on top of text if both
      const output = await sharp(input.imageBuffer).composite(composites).png().toBuffer();
      this.logger.log('[BRANDING] Branding applied successfully');
      return { buffer: output, applied: anyApplied, mimeType: 'image/png' };
    } catch (error) {
      this.logger.warn(
        `[BRANDING] Branding failed, returning original: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { buffer: input.imageBuffer, applied: false, mimeType: originalMime };
    }
  }

  private async buildHeadlineOverlay(
    headline: string,
    baseWidth: number,
    baseHeight: number,
    branding: ReturnType<typeof loadBrandingConfig>,
    format?: string | null,
  ): Promise<{ input: Buffer; left: number; top: number } | null> {
    const clean = headline.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    // Never render fake lorem ipsum / gibberish
    if (/lorem ipsum/i.test(clean)) return null;

    const isFeedSquare = format === 'FEED_SQUARE';
    const widthPercent = isFeedSquare ? 84 : branding.text.widthPercent;
    const marginPercent = isFeedSquare ? 8 : branding.text.marginPercent;
    const targetWidth = Math.max(200, Math.round(baseWidth * (widthPercent / 100)));
    // Font size proportional to base width, clamp 22..56 — feed_square slightly smaller to fit 3 lines safely
    const fontSize = isFeedSquare
      ? Math.min(48, Math.max(20, Math.round(baseWidth * 0.038)))
      : Math.min(56, Math.max(22, Math.round(baseWidth * 0.045)));
    const lineSpacing = Math.round(fontSize * 0.3);
    const paddingX = Math.round(fontSize * 0.6);
    const paddingY = Math.round(fontSize * 0.45);
    const maxCharsPerLine = Math.max(12, Math.floor(targetWidth / (fontSize * 0.55)));
    const lines = this.wrapText(clean, maxCharsPerLine);
    // Truncate to max 3 lines to avoid covering whole image
    const truncated = lines.slice(0, 3);
    if (lines.length > 3) {
      truncated[2] = truncated[2].slice(0, Math.max(0, maxCharsPerLine - 1)) + '…';
    }

    const lineHeight = fontSize + lineSpacing;
    const textHeight = truncated.length * lineHeight - lineSpacing;
    const svgHeight = textHeight + paddingY * 2;
    const svgWidth = targetWidth;

    const escapedLines = truncated.map((l) => this.escapeXml(l));

    // Build SVG with background rect + centered text
    // Use DejaVu Sans fallback — Sharp SVG rendering uses system fonts
    const textYStart = paddingY + fontSize;
    const tspans = escapedLines
      .map((line, idx) => {
        const y = idx === 0 ? textYStart : `+${lineHeight}`;
        // Use dy for subsequent lines
        if (idx === 0) {
          return `<tspan x="${svgWidth / 2}" y="${y}" text-anchor="middle">${line}</tspan>`;
        }
        return `<tspan x="${svgWidth / 2}" dy="${lineHeight}" text-anchor="middle">${line}</tspan>`;
      })
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" rx="14" ry="14" fill="#000000" fill-opacity="0.68"/>
  <text font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle">
    ${tspans}
  </text>
</svg>`;

    const margin = Math.round(baseWidth * (marginPercent / 100));
    const svgBuffer = Buffer.from(svg);
    const effectivePosition = isFeedSquare ? 'top-center' : branding.text.position;
    const { left, top } = this.calculatePosition(effectivePosition, baseWidth, baseHeight, svgWidth, svgHeight, margin);

    // Avoid overlap with bottom-right logo: if text is bottom and logo is bottom-right, shift text up
    // Simple heuristic: if both at bottom, keep text centered but logo sits at margin — no shift needed as text is centered
    this.logger.log(`[BRANDING] Text overlay: "${clean.slice(0, 60)}" -> ${svgWidth}x${svgHeight} font=${fontSize}px lines=${truncated.length} pos=${effectivePosition}${isFeedSquare ? ' (feed_square forced top)' : ''}`);

    // Validate SVG renders via Sharp (will throw if invalid)
    try {
      await sharp(svgBuffer).metadata();
    } catch {
      // Fallback: return without validation
    }

    return { input: svgBuffer, left, top };
  }

  private wrapText(text: string, maxChars: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxChars) {
        current = test;
      } else {
        if (current) lines.push(current);
        // Word longer than max -> hard break
        if (word.length > maxChars) {
          let remaining = word;
          while (remaining.length > maxChars) {
            lines.push(remaining.slice(0, maxChars));
            remaining = remaining.slice(maxChars);
          }
          current = remaining;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private calculatePosition(
    position: LogoPosition,
    baseWidth: number,
    baseHeight: number,
    logoWidth: number,
    logoHeight: number,
    margin: number,
  ): { left: number; top: number } {
    let left = 0;
    let top = 0;

    switch (position) {
      case 'top-left':
        left = margin;
        top = margin;
        break;
      case 'top-center':
        left = Math.round((baseWidth - logoWidth) / 2);
        top = margin;
        break;
      case 'top-right':
        left = baseWidth - logoWidth - margin;
        top = margin;
        break;
      case 'center-left':
        left = margin;
        top = Math.round((baseHeight - logoHeight) / 2);
        break;
      case 'center':
        left = Math.round((baseWidth - logoWidth) / 2);
        top = Math.round((baseHeight - logoHeight) / 2);
        break;
      case 'center-right':
        left = baseWidth - logoWidth - margin;
        top = Math.round((baseHeight - logoHeight) / 2);
        break;
      case 'bottom-left':
        left = margin;
        top = baseHeight - logoHeight - margin;
        break;
      case 'bottom-center':
        left = Math.round((baseWidth - logoWidth) / 2);
        top = baseHeight - logoHeight - margin;
        break;
      case 'bottom-right':
      default:
        left = baseWidth - logoWidth - margin;
        top = baseHeight - logoHeight - margin;
        break;
    }

    // Clamp to avoid negative overflow
    left = Math.max(0, left);
    top = Math.max(0, top);
    return { left, top };
  }

  private async downloadLogo(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`[BRANDING] Logo download failed: ${res.status} ${res.statusText}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (error) {
      this.logger.warn(
        `[BRANDING] Logo download error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }
}
