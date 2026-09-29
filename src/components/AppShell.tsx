import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import { Avatar } from './Avatar'
import {
  IconBell,
  IconBookmark,
  IconHome,
  IconLogo,
  IconSearch,
  IconSettings,
  IconUser,
} from './icons'

type NavItem = {
  to: string
  label: string
  icon: ReactNode
  requiresAuth?: boolean
  badge?: number
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  // Poll the unread count so a mention or follow shows up without a reload.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = () => {
      api<{ count: number }>('/api/notifications/unread-count')
        .then((data) => {
          if (!cancelled) setUnread(data.count)
        })
        .catch(() => {
          /* A failed poll is not worth interrupting the user for. */
        })
    }

    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [user])

  // Signed out there is nothing to count, so the badge is derived rather than
  // stored, which avoids a reset render on every sign-out.
  const unreadCount = user ? unread : 0

  const items: NavItem[] = [
    { to: '/', label: 'Home', icon: <IconHome /> },
    { to: '/explore', label: 'Explore', icon: <IconSearch /> },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: <IconBell />,
      requiresAuth: true,
      badge: unreadCount,
    },
    { to: '/bookmarks', label: 'Bookmarks', icon: <IconBookmark />, requiresAuth: true },
    { to: '/settings', label: 'Settings', icon: <IconSettings />, requiresAuth: true },
  ]

  const visible = items.filter((item) => !item.requiresAuth || user)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="sidebar" aria-label="Main">
        <NavLink to="/" className="brand">
          <IconLogo />
          <span>Smoshed</span>
        </NavLink>

        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="nav-link"
            end={item.to === '/'}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="nav-badge" aria-label={`${item.badge} unread`}>
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}

        <div className="sidebar-footer">
          {user ? (
            <>
              <NavLink to={`/${user.handle}`} className="nav-link">
                <Avatar seed={user.avatarSeed} name={user.displayName} handle={user.handle} size="sm" />
                <span>
                  {user.displayName}
                  <span className="sr-only"> - your profile</span>
                </span>
              </NavLink>
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={() => {
                  void logout()
                  navigate('/')
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-block">
              Sign in
            </NavLink>
          )}
        </div>
      </nav>

      <div className="main">{children}</div>

      <nav className="mobile-nav" aria-label="Main">
        {visible.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            aria-label={item.badge ? `${item.label}, ${item.badge} unread` : item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        {user ? (
          <NavLink to={`/${user.handle}`} aria-label="Your profile">
            <IconUser />
            <span>Profile</span>
          </NavLink>
        ) : (
          <NavLink to="/login" aria-label="Sign in">
            <IconUser />
            <span>Sign in</span>
          </NavLink>
        )}
      </nav>

      {!ready ? (
        <div className="sr-only" role="status">
          Loading your session
        </div>
      ) : null}
    </div>
  )
}
