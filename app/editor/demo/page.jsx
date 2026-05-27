import { headers } from 'next/headers'
import { isLocalhostHost } from '@/lib/demo-auth'
import DemoEditorClient from './DemoEditorClient'

export const dynamic = 'force-dynamic'

export default async function DemoEditorPage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''

  if (!isLocalhostHost(host)) {
    return (
      <div className='demo-unlock-shell'>
        <div className='demo-unlock-card'>
          <div className='demo-unlock-kicker'>Local-only</div>
          <h1>Demo editor runs on localhost</h1>
          <p>
            The landing demo is a static config committed to the repo. To change it, clone the project, run{' '}
            <code>npm run dev</code>, open <code>http://localhost:3000/editor/demo</code>, tune the scene, then commit{' '}
            <code>public/demo/demo-config.json</code> and push. Vercel ships the new demo on the next deploy.
          </p>
        </div>
      </div>
    )
  }

  return <DemoEditorClient />
}
