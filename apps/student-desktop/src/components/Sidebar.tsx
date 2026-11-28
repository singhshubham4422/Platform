import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  BookMarked,
  ClipboardList,
  CloudOff,
  Code2,
  FileCheck2,
  GraduationCap,
  HelpCircle,
  Home,
  Library,
  LogOut,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { User } from '../types';
import type { StudentSection } from './Dashboard';

export type AppSection = StudentSection | 'courses' | 'challenges' | 'notifications' | 'workspace' | 'platform';

export const NAV_ITEMS: Array<{ id: AppSection; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'courses', label: 'My Courses', icon: BookMarked },
  { id: 'learning', label: 'Learning', icon: Sparkles },
  { id: 'challenges', label: 'Challenges', icon: Code2 },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'assessments', label: 'Tests', icon: FileCheck2 },
  { id: 'workspace', label: 'Workspace', icon: Terminal },
  { id: 'classes', label: 'Classes', icon: Users },
  { id: 'results', label: 'Results', icon: Trophy },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  ...(import.meta.env.VITE_OFFLINE_FIRST === '1' ? [{ id: 'platform' as const, label: 'Platform', icon: Library }] : []),
];

interface SidebarProps {
  user: User;
  active: AppSection;
  isOnline: boolean;
  pendingSync: number;
  unread: number;
  onNavigate: (section: AppSection) => void;
  onSync: () => Promise<void> | void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, active, isOnline, pendingSync, unread, onNavigate, onSync, onLogout }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <aside className="lp-sidebar">
      <button type="button" className="lp-brand" onClick={() => onNavigate('overview')}>
        <span className="hr-brand-mark">P</span>
        <span>
          PLATFORM
          <small>Student</small>
        </span>
      </button>

      <nav className="lp-nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? 'active' : ''}
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={17} />
            <span>{item.label}</span>
            {item.id === 'notifications' && unread > 0 && <em className="lp-badge">{unread > 99 ? '99+' : unread}</em>}
          </button>
        ))}
      </nav>

      <div className="lp-sidebar-foot">
        {!isOnline ? (
          <span className="lp-status lp-status-offline">
            <CloudOff size={13} /> Offline — drafts saved locally
          </span>
        ) : pendingSync > 0 ? (
          <button
            type="button"
            className="lp-status lp-status-sync"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await onSync();
              setSyncing(false);
            }}
          >
            <RefreshCw size={13} className={syncing ? 'ws-spin' : ''} /> {pendingSync} to sync
          </button>
        ) : (
          <span className="lp-status lp-status-ok">All changes synced</span>
        )}

        <div className="lp-user" ref={menuRef}>
          <button type="button" className="lp-user-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <span className="hr-avatar">{initials}</span>
            <span className="lp-user-text">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </button>
          {menuOpen && (
            <div className="lp-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), onNavigate('settings'))}>
                <Settings size={14} /> Settings
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), onNavigate('progress'))}>
                <GraduationCap size={14} /> Progress
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), onNavigate('help'))}>
                <HelpCircle size={14} /> Help
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), onNavigate('library'))}>
                <BookOpen size={14} /> Library
              </button>
              <button type="button" role="menuitem" onClick={onLogout}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
