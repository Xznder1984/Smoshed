import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { HomePage } from './pages/Home'
import { LoginPage } from './pages/Login'
import { SignupPage } from './pages/Signup'
import { ForgotPasswordPage } from './pages/ForgotPassword'
import { ResetPasswordPage } from './pages/ResetPassword'
import { PostPage } from './pages/Post'
import { ProfilePage } from './pages/Profile'
import { ExplorePage } from './pages/Explore'
import { NotificationsPage } from './pages/Notifications'
import { BookmarksPage } from './pages/Bookmarks'
import { SettingsPage } from './pages/Settings'
import { NotFoundPage } from './pages/NotFound'
import { LegalPage } from './pages/Legal'

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Static segments are ranked above the handle route by the router, but
            they are listed first here so the intent is obvious. */}
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/bot" element={<SettingsPage section="bot" />} />
        <Route path="/legal/terms" element={<LegalPage section="terms" />} />
        <Route path="/legal/privacy" element={<LegalPage section="privacy" />} />
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/@:handle" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}
