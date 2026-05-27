import { Layout } from '@/components/dom/Layout'
import '@/global.css'

const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'AutoZ Engine — Interactive 3D Automotive Experiences, Instantly',
  description: 'Upload a vehicle model, configure doors, lights, colors and camera, then publish an interactive 3D experience as an iframe. No custom viewer engineering required.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/favicon-32x32.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: 'AutoZ Engine — Interactive 3D Automotive Experiences, Instantly',
    description: 'Upload a vehicle model, configure doors, lights, colors and camera, then publish an interactive 3D experience as an iframe.',
    images: ['/icons/share.png'],
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
}

export const viewport = {
  themeColor: '#04060f',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang='en' className='antialiased' suppressHydrationWarning>
      <head>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link href='https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=DM+Mono:wght@300;400&display=swap' rel='stylesheet' />
      </head>
      <body suppressHydrationWarning>
        <Layout>{children}</Layout>
      </body>
    </html>
  )
}
