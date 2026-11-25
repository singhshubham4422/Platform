import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Profile } from '../data/types';
import { useAuth } from '../auth/AuthProvider';
import { useTheme } from '../lib/theme';
import { label } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: Record<Profile['role'], NavItem[]> = {
  STUDENT: [
    { to: '/student', label: 'Overview', end: true },
    { to: '/student/topics', label: 'Topics' },
    { to: '/student/submissions', label: 'Submissions' },
    { to: '/student/assessments', label: 'Assessments' },
  ],
  TEACHER: [
    { to: '/teacher', label: 'Classes', end: true },
    { to: '/teacher/courses', label: 'Courses' },
    { to: '/teacher/assessments', label: 'Assessments' },
  ],
  COLLEGE_ADMIN: [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/departments', label: 'Departments' },
    { to: '/admin/classes', label: 'Classes' },
  ],
  PLATFORM_OWNER: [
    { to: '/owner', label: 'Organizations', end: true },
    { to: '/owner/courses', label: 'Platform courses' },
  ],
};

export function AppShell({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="app">
      <a className="skip-link" href="#main" style={{ position: 'absolute', left: -999 }}>
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <div>
            <div>L_Platform</div>
            <div className="sidebar-role">{label(profile.role)}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {NAV[profile.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>{profile.full_name}</span>
          <span>{profile.email}</span>
          <button
            type="button"
            className="btn btn-small"
            style={{ background: 'transparent', color: 'inherit', borderColor: 'var(--sidebar-border)' }}
            onClick={() => void signOut().then(() => navigate('/'))}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="small muted">
            {label(profile.role)} workspace · {profile.full_name}
          </span>
          <div className="btn-row">
            <button type="button" className="btn btn-small" onClick={toggle} aria-label="Toggle colour theme">
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            <button type="button" className="btn btn-small mobile-signout" onClick={() => void signOut().then(() => navigate('/'))}>
              Sign out
            </button>
          </div>
        </div>
        <main className="page" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
