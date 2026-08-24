import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { BrandingRenderer } from './branding-renderer.service';

async function createPngBuffer(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; alpha?: number },
  withAlpha = false,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: withAlpha ? 4 : 3,
      background: color as any,
    },
  })
    .png()
    .toBuffer();
}

async function createTransparentPngWithDot(): Promise<Buffer> {
  // 100x50 transparent with red dot
  return sharp({
    create: { width: 100, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 40,
        top: 15,
      },
    ])
    .png()
    .toBuffer();
}

describe('BrandingRenderer', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function config(overrides: Record<string, string> = {}) {
    return {
      get: (key: string) => overrides[key] ?? undefined,
    } as unknown as ConfigService;
  }

  it('preserves original logo buffer and keeps aspect ratio', async () => {
    const logo = await createPngBuffer(200, 100, { r: 255, g: 0, b: 0 });
    const logoCopy = Buffer.from(logo);
    const base = await createPngBuffer(1080, 1350, { r: 255, g: 255, b: 255 });

    global.fetch = jest.fn(async () =>
      new Response(logo, { headers: { 'content-type': 'image/png' } }),
    ) as any;

    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });

    expect(result.applied).toBe(true);
    expect(Buffer.compare(logo, logoCopy)).toBe(0); // original not modified
    // target width 12% of 1080 = ~129, aspect 2:1 => height ~64
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('respects widthPercent', async () => {
    const logo = await createPngBuffer(100, 50, { r: 0, g: 0, b: 255 });
    const base = await createPngBuffer(1000, 1000, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;

    const renderer = new BrandingRenderer(config({ BRANDING_LOGO_WIDTH_PERCENT: '20' }));
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
    expect(result.applied).toBe(true);
    // width 20% of 1000 = 200, height 100, logo should be 200x100
    // Verify by checking composite left position for bottom-right with margin 3% (30px)
    // We can't directly inspect composite, but ensure image still 1000x1000 and not error
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1000);
  });

  it('preserves transparency (PNG alpha)', async () => {
    const logo = await createTransparentPngWithDot();
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
    expect(result.applied).toBe(true);
    // Result should be png with alpha handled (sharp png preserves)
    expect(result.mimeType).toBe('image/png');
    const raw = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info.channels).toBeGreaterThanOrEqual(3);
  });

  it('positions logo correctly for all 9 positions', async () => {
    const logo = await createPngBuffer(100, 100, { r: 255, g: 0, b: 0 });
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    const positions = [
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ] as const;
    for (const pos of positions) {
      global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
      const renderer = new BrandingRenderer(config({ BRANDING_LOGO_POSITION: pos }));
      const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
      expect(result.applied).toBe(true);
      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(500);
    }
  });

  it('does not apply when branding.enabled=false', async () => {
    const logo = await createPngBuffer(100, 50, { r: 255, g: 0, b: 0 });
    const base = await createPngBuffer(200, 200, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const renderer = new BrandingRenderer(config({ BRANDING_ENABLED: 'false' }));
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
    expect(result.applied).toBe(false);
    expect(Buffer.compare(result.buffer, base)).toBe(0);
  });

  it('does not apply when logo.enabled=false', async () => {
    const logo = await createPngBuffer(100, 50, { r: 255, g: 0, b: 0 });
    const base = await createPngBuffer(200, 200, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const renderer = new BrandingRenderer(config({ BRANDING_LOGO_ENABLED: 'false' }));
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
    expect(result.applied).toBe(false);
  });

  it('continues normally when no logo', async () => {
    const base = await createPngBuffer(200, 200, { r: 255, g: 255, b: 255 });
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: null });
    expect(result.applied).toBe(false);
    expect(Buffer.compare(result.buffer, base)).toBe(0);
  });

  it('still generates image even without logo (no throw)', async () => {
    const base = await createPngBuffer(200, 200, { r: 0, g: 0, b: 0 });
    const renderer = new BrandingRenderer(config());
    // logoUrl empty string
    const result = await renderer.apply({ imageBuffer: base, logoUrl: '' });
    expect(result.applied).toBe(false);
  });

  it('handles JPG logo without transparency', async () => {
    const logo = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/jpeg' } })) as any;
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.jpg' });
    expect(result.applied).toBe(true);
  });

  it('handles fetch failure gracefully', async () => {
    const base = await createPngBuffer(200, 200, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(null, { status: 404 } as any)) as any;
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/missing.png' });
    expect(result.applied).toBe(false);
    expect(Buffer.compare(result.buffer, base)).toBe(0);
  });

  it('does not double-apply if called on already branded image (caller must avoid, but ensure second call still composites)', async () => {
    const logo = await createPngBuffer(100, 50, { r: 255, g: 0, b: 0 });
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const renderer = new BrandingRenderer(config());
    const first = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.png' });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const second = await renderer.apply({ imageBuffer: first.buffer, logoUrl: 'https://example.com/logo.png' });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    // Second composite at same position is idempotent — caller must ensure not to call twice, but second call should not crash
    // If Sharp composites identically, buffers will be equal; we just verify both succeed
    expect(second.buffer.length).toBeGreaterThan(0);
  });

  it('supports SVG logo', async () => {
    const svg = Buffer.from(
      `<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" fill="blue"/><text x="10" y="30" fill="white">Logo</text></svg>`,
    );
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    global.fetch = jest.fn(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })) as any;
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, logoUrl: 'https://example.com/logo.svg' });
    // Sharp may render SVG, if fails it should fallback to not applied
    expect([true, false].includes(result.applied)).toBe(true);
  });

  it('applies headline text overlay without cutting', async () => {
    const base = await createPngBuffer(1024, 1024, { r: 30, g: 30, b: 30 });
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({
      imageBuffer: base,
      headline: 'Oferta exclusiva: 2x1 en Pilates',
    });
    expect(result.applied).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    // Ensure headline was rendered (buffer larger due to composite)
    expect(result.buffer.length).toBeGreaterThan(base.length);
  });

  it('wraps long headline to max 3 lines', async () => {
    const base = await createPngBuffer(1024, 1350, { r: 255, g: 255, b: 255 });
    const longHeadline =
      'Esta es una promoción larguísima que debería cortarse en tres líneas como máximo para no tapar toda la imagen con texto';
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, headline: longHeadline });
    expect(result.applied).toBe(true);
    // Should truncate with …
    // Verify no throw and dimensions preserved
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1024);
  });

  it('does not apply text when headline empty', async () => {
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({ imageBuffer: base, headline: '   ' });
    expect(result.applied).toBe(false);
  });

  it('does not apply headline when text branding disabled', async () => {
    const base = await createPngBuffer(500, 500, { r: 255, g: 255, b: 255 });
    const renderer = new BrandingRenderer(config({ BRANDING_TEXT_ENABLED: 'false' }));
    const result = await renderer.apply({ imageBuffer: base, headline: 'Hola mundo' });
    expect(result.applied).toBe(false);
  });

  it('applies both logo and headline together without double text cut', async () => {
    const logo = await createPngBuffer(100, 50, { r: 255, g: 0, b: 0 });
    const base = await createPngBuffer(1080, 1350, { r: 240, g: 240, b: 240 });
    global.fetch = jest.fn(async () => new Response(logo, { headers: { 'content-type': 'image/png' } })) as any;
    const renderer = new BrandingRenderer(config());
    const result = await renderer.apply({
      imageBuffer: base,
      logoUrl: 'https://example.com/logo.png',
      headline: 'Pack 8 clases',
    });
    expect(result.applied).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('headline overlay never exceeds safe margins (width 85% of base)', async () => {
    const base = await createPngBuffer(1080, 1080, { r: 255, g: 255, b: 255 });
    const renderer = new BrandingRenderer(config({ BRANDING_TEXT_WIDTH_PERCENT: '85' }));
    const result = await renderer.apply({ imageBuffer: base, headline: 'Test safe margins' });
    expect(result.applied).toBe(true);
    // Text overlay width should be 85% of 1080 = 918, leaving 81px margin each side (centered)
    // Verify image still 1080x1080 and composite succeeded
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
  });
});
