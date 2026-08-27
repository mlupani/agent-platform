import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { AppFrame } from '@/components/app-frame';
import { BrandingFavicon } from '@/components/branding-favicon';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  variable: '--font-sans-ui',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  variable: '--font-mono-ui',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Panel del negocio',
  description: 'Dashboard para conversaciones, citas e integraciones',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="min-h-full antialiased">
        <BrandingFavicon />
        <Providers>
          <AppFrame>{children}</AppFrame>
        </Providers>
      </body>
    </html>
  );
}
