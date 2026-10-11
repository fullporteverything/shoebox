import React, { useEffect, useRef } from 'react'
import { Shell } from './components/Shell.js'
import { Toasts } from './components/ui.js'
import { navigate, supportsViewTransitions, useRoute } from './lib/router.js'
import { useSession } from './lib/session.js'
import { SignIn, SignUp } from './pages/Auth.js'
import { Inbox } from './pages/Inbox.js'
import { Legal } from './pages/Legal.js'
import { Lockdown } from './pages/Lockdown.js'
import { NotFound } from './pages/NotFound.js'
import { Overview } from './pages/Overview.js'
import { Profile } from './pages/Profile.js'
import { Landing } from './pages/Public.js'
import { Receipts } from './pages/Receipts.js'
import { Savings } from './pages/Savings.js'
import { Filing } from './pages/Filing.js'
import { Pass } from './pages/Pass.js'
import { Security } from './pages/Security.js'
import { TaxMap } from './pages/TaxMap.js'

function AppPage({ route }: { route: string }) {
  switch (route.split('?')[0]) {
    case '/app/pass': return <Pass route={route} />
    case '/app/savings': return <Savings />
    case '/app/filing': return <Filing />
    case '/app/inbox': return <Inbox />
    case '/app/receipts': return <Receipts />
    case '/app/tax': return <TaxMap />
    case '/app/security': return <Security />
    case '/app/profile': return <Profile tab="profile" />
    case '/app/profile/settings': return <Profile tab="settings" />
    case '/app':
    case '/app/': return <Overview />
    default: return <NotFound />
  }
}

export function App() {
  const route = useRoute()
  const { phase } = useSession()
  const inApp = route.startsWith('/app')

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  // Visiting an auth page while unlocked goes to the app. This keys on the
  // route only, so the sign-up form can send people to the inbox itself.
  useEffect(() => {
    if (phaseRef.current === 'unlocked' && route === '/signin') navigate('/app', { replace: true })
  }, [route])
  useEffect(() => {
    if (phase === 'signed_out' && inApp) navigate('/signin', { replace: true })
  }, [phase, inApp])

  let page: React.ReactNode
  if (phase === 'shredded') page = <Lockdown />
  else if (phase === 'two_factor' && (inApp || route === '/signin')) page = <SignIn />
  else if (inApp && phase === 'locked') page = <SignIn locked />
  else if (inApp && phase === 'unlocked') page = <Shell route={route}><div key={route} className={supportsViewTransitions() ? undefined : 'page-enter'}><AppPage route={route} /></div></Shell>
  else if (inApp) page = <SignIn />
  else if (route === '/signin') page = phase === 'locked' ? <SignIn locked /> : <SignIn />
  else if (route === '/signup') page = <SignUp />
  else if (route.startsWith('/legal/')) page = <Legal slug={route.slice(7)} />
  else page = <Landing />

  return (
    <>
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      {page}
      <Toasts />
    </>
  )
}
