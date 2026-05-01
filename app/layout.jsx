import { Layout } from '@/components/dom/Layout'
import '@/global.css'

export const metadata = {
  title: 'AutoZ Engine — Interactive 3D Automotive Experiences, Instantly',
  description: 'Upload a vehicle model, configure doors, lights, colors and camera, then publish an interactive 3D experience as an iframe. No custom viewer engineering required.',
}

export default function RootLayout({ children }) {
  return (
    <html lang='en' className='antialiased'>
      <head>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link href='https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=DM+Mono:wght@300;400&display=swap' rel='stylesheet' />
      </head>
      <body>
        <Layout>{children}</Layout>
      </body>
    </html>
  )
}
