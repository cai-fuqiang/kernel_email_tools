import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  BookOpen,
  Bot,
  Code2,
  FileCheck2,
  Languages,
  Library,
  LogOut,
  MailSearch,
  NotebookText,
  Search,
  Tags,
  Users,
} from 'lucide-react';
import { getStats } from '../api/client';
import { useAuth } from '../auth';
import { StatusBadge } from '../components/ui';

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
};

function roleTone(role: string) {
  if (role === 'admin') return 'success';
  if (role === 'editor') return 'info';
  return 'muted';
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? 'bg-slate-900 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    }`;

  return (
    <div>
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {title}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function MainLayout() {
  const [totalEmails, setTotalEmails] = useState<number | null>(null);
  const navigate = useNavigate();
  const { currentUser, loading: authLoading, isAdmin, canWrite, error: authError, logout } = useAuth();

  useEffect(() => {
    getStats().then(s => setTotalEmails(s.total_emails)).catch(() => {});
  }, []);

  const researchItems: NavItem[] = [
    { to: '/', label: 'Search Emails', icon: Search, end: true },
    { to: '/ask', label: 'Ask Agent', icon: Bot },
  ];
  const workbenchItems: NavItem[] = [
    { to: '/knowledge', label: 'Knowledge', icon: Library },
    { to: '/tags', label: 'Tags', icon: Tags },
    { to: '/annotations', label: 'Annotations', icon: NotebookText },
    { to: '/translations', label: 'Translations', icon: Languages },
  ];
  const manualItems: NavItem[] = [
    { to: '/manual/search', label: 'Search Manuals', icon: BookOpen },
    { to: '/manual/ask', label: 'Ask Manuals', icon: MailSearch },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <MailSearch className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-950">Kernel Mail KB</h1>
              <p className="mt-0.5 text-xs text-slate-500">Research to reusable knowledge</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {authLoading ? (
              <div className="text-xs text-slate-500">Loading user...</div>
            ) : currentUser ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{currentUser.display_name}</div>
                    <div className="truncate text-xs text-slate-500">{currentUser.auth_source}</div>
                  </div>
                  <StatusBadge tone={roleTone(currentUser.role)}>{currentUser.role}</StatusBadge>
                </div>
                {!canWrite && (
                  <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-700">
                    Read-only mode
                  </div>
                )}
                <button
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-500">{authError || 'Unauthenticated'}</div>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto p-4">
          <NavSection title="Research" items={researchItems} />
          <NavSection title="Knowledge Workbench" items={workbenchItems} />
          <NavSection title="Code" items={[{ to: '/kernel-code', label: 'Code Browser', icon: Code2 }]} />
          {isAdmin && (
            <NavSection
              title="Admin"
              items={[
                { to: '/users', label: 'Users', icon: Users },
                { to: '/admin/annotation-review', label: 'Annotation Review', icon: FileCheck2 },
              ]}
            />
          )}
          <NavSection title="Manuals" items={manualItems} />
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase text-slate-400">Indexed emails</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {totalEmails !== null ? totalEmails.toLocaleString() : '...'}
            </p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
