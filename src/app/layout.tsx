import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SENS/LAB — Find your sens.',
  description: 'Measure your aim. Discover a sensitivity that works for you.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
