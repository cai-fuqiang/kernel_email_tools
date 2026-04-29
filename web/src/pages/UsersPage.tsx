import { useEffect, useMemo, useState } from 'react';
import {
  approveUser,
  listUsers,
  rejectUser,
  resetUserPassword,
  updateUser,
} from '../api/client';
import { useAuth } from '../auth';
import type { UserRead } from '../api/types';
import { PageHeader, PageShell, StatusBadge } from '../components/ui';

const ROLE_GUIDE: Array<{
  role: 'admin' | 'editor' | 'viewer' | 'agent';
  title: string;
  description: string;
}> = [
  {
    role: 'admin',
    title: 'Admin',
    description: 'Can manage users and can browse, modify, or delete any user\'s tags and annotations.',
  },
  {
    role: 'editor',
    title: 'Editor',
    description: 'Can create content, but can only modify their own private tags and annotations. Public content can only be modified by admin.',
  },
  {
    role: 'viewer',
    title: 'Viewer',
    description: 'Read-only access. Can view public content and the user\'s own private items.',
  },
  {
    role: 'agent',
    title: 'Agent',
    description: 'System identity for background research tasks. It writes drafts and trace records for human review.',
  },
];

function UserSection({
  title,
  users,
  emptyText,
  onRefresh,
}: {
  title: string;
  users: UserRead[];
  emptyText: string;
  onRefresh: () => Promise<void>;
}) {
  const [working, setWorking] = useState('');

  const handleApprove = async (userId: string) => {
    setWorking(userId);
    try {
      await approveUser(userId);
      await onRefresh();
    } finally {
      setWorking('');
    }
  };

  const handleReject = async (userId: string) => {
    const reason = window.prompt('Reject reason (optional):', '') || '';
    setWorking(userId);
    try {
      await rejectUser(userId, reason);
      await onRefresh();
    } finally {
      setWorking('');
    }
  };

  const handleResetPassword = async (userId: string) => {
    const newPassword = window.prompt('New password (min 8 chars):', '');
    if (!newPassword) return;
    setWorking(userId);
    try {
      await resetUserPassword(userId, newPassword);
      await onRefresh();
      window.alert('Password reset completed.');
    } finally {
      setWorking('');
    }
  };

  const handleStatusToggle = async (user: UserRead) => {
    setWorking(user.user_id);
    try {
      await updateUser(user.user_id, {
        status: user.status === 'active' ? 'disabled' : 'active',
        disabled_reason: user.status === 'active' ? 'Disabled by admin' : '',
      });
      await onRefresh();
    } finally {
      setWorking('');
    }
  };

  const handleRoleChange = async (userId: string, role: 'admin' | 'editor' | 'viewer' | 'agent') => {
    setWorking(userId);
    try {
      await updateUser(userId, { role });
      await onRefresh();
    } finally {
      setWorking('');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Approval</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Last Login</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">{emptyText}</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.user_id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{user.display_name || user.username}</div>
                    <div className="text-xs text-gray-500">{user.username} · {user.user_id}</div>
                    <div className="text-xs text-gray-500">{user.email || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      user.approval_status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : user.approval_status === 'pending'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                    }`}>
                      {user.approval_status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.user_id, e.target.value as 'admin' | 'editor' | 'viewer' | 'agent')}
                      disabled={working === user.user_id}
                      className="rounded-lg border border-gray-300 px-2 py-1"
                    >
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                      <option value="agent">agent</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${user.status === 'active' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {user.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {user.approval_status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApprove(user.user_id)}
                            disabled={working === user.user_id}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(user.user_id)}
                            disabled={working === user.user_id}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleStatusToggle(user)}
                        disabled={working === user.user_id}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 disabled:opacity-50"
                      >
                        {user.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleResetPassword(user.user_id)}
                        disabled={working === user.user_id}
                        className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs text-indigo-700 disabled:opacity-50"
                      >
                        Reset Password
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadUsers().catch(() => {});
    } else {
      setLoading(false);
      setError('Permission denied');
    }
  }, [isAdmin]);

  const pendingUsers = useMemo(() => users.filter((user) => user.approval_status === 'pending'), [users]);
  const approvedUsers = useMemo(() => users.filter((user) => user.approval_status === 'approved' && user.status === 'active'), [users]);
  const disabledUsers = useMemo(() => users.filter((user) => user.status !== 'active' || user.approval_status === 'rejected'), [users]);

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="Admin"
        title="User Management"
        description="Approve new accounts, update roles, disable access, and reset passwords."
      />

      <section className="grid gap-3 md:grid-cols-3">
        {ROLE_GUIDE.map((item) => (
          <div key={item.role} className="rounded-xl border border-gray-200 bg-white px-4 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
              <StatusBadge tone={item.role === 'admin' ? 'success' : item.role === 'editor' ? 'info' : 'muted'} className="py-0.5 text-[11px]">
                {item.role}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">{item.description}</p>
          </div>
        ))}
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-gray-400">Loading users...</div>
      ) : (
        <>
          <UserSection title="Pending Approval" users={pendingUsers} emptyText="No pending users." onRefresh={loadUsers} />
          <UserSection title="Active Users" users={approvedUsers} emptyText="No active users." onRefresh={loadUsers} />
          <UserSection title="Disabled / Rejected" users={disabledUsers} emptyText="No disabled users." onRefresh={loadUsers} />
        </>
      )}
    </PageShell>
  );
}
