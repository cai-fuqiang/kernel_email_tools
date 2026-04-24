import { useEffect, useState } from 'react';
import { listUsers, updateUser } from '../api/client';
import { useAuth } from '../auth';
import type { UserRead } from '../api/types';

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

  const handleRoleChange = async (userId: string, role: 'admin' | 'editor' | 'viewer') => {
    try {
      await updateUser(userId, { role });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">User Management</h2>
        <p className="text-sm text-gray-500">Manage account roles for multi-user collaboration.</p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading users...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No users found.</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.user_id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{user.display_name || user.username}</div>
                    <div className="text-xs text-gray-500">{user.user_id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email || '-'}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.user_id, e.target.value as 'admin' | 'editor' | 'viewer')}
                      className="rounded-lg border border-gray-300 px-2 py-1"
                    >
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.auth_source}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(user.last_seen_at).toLocaleString('zh-CN')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
