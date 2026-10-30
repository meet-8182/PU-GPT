import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { 
  Loader2, 
  Users, 
  UserPlus, 
  Trash2,
  X,
  Shield,
  GraduationCap,
  Briefcase
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { adminApi } from '@/utils/api';
import { formatDistanceToNow } from 'date-fns';

const ROLE_ICONS = {
  student: GraduationCap,
  teacher: Briefcase,
  admin: Shield,
};

const ROLE_COLORS = {
  student: 'text-sage bg-sage/10',
  teacher: 'text-amber-chalk bg-amber-chalk/10',
  admin: 'text-rust bg-rust/10',
};

function renderRoleIcon(role) {
  const Icon = ROLE_ICONS[role];
  return <Icon className="w-3 h-3 inline mr-1" />;
}

function UserRow({ u, formatDistanceToNow, handleRoleChange, handleDelete, user }) {
  const subjects = Array.isArray(u.subjects) ? u.subjects : [];
  const maxVisible = 3;
  const visible = subjects.slice(0, maxVisible);
  const remaining = subjects.length - maxVisible;

  let subjectChips = null;
  if (subjects.length > 0) {
    subjectChips = (
      <div className="flex-shrink-0 min-w-0" title={subjects.join(', ')}>
        <div>
          <div className="flex flex-wrap items-center gap-1">
            {visible.map((s, i) => (
              <span key={i} className="px-2 py-0.5 text-xs bg-rule-line/50 rounded text-chalk/70 whitespace-nowrap">{s}</span>
            ))}
            {remaining > 0 && (
              <span 
                className="px-2 py-0.5 text-xs bg-amber-chalk/10 text-amber-chalk rounded cursor-help whitespace-nowrap"
                title={subjects.join(', ')}
              >
                +{remaining} more
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div key={u._id} className="p-4 grid grid-cols-[auto_1fr_auto] gap-4 items-start sm:items-center min-w-0 hover:bg-rule-line/20 transition-colors">
      <div className="flex items-center gap-3 min-w-0 col-span-1 sm:col-span-auto">
        <div className="w-10 h-10 rounded-full bg-amber-chalk/20 flex items-center justify-center flex-shrink-0">
          <span className="text-amber-chalk font-medium">{u.name?.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <p className="font-medium text-chalk truncate">{u.name}</p>
          <p className="text-sm text-chalk/50 truncate">{u.email}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1 col-span-2 sm:col-span-auto">
        <span className={`px-2 py-1 text-xs font-medium rounded flex-shrink-0 ${ROLE_COLORS[u.role]}`}>
          {renderRoleIcon(u.role)}
          {u.role}
        </span>
        {u.department && (
          <span className="px-2 py-1 text-xs text-chalk/60 rounded bg-rule-line/30 truncate flex-shrink-0" title={u.department}>
            {u.department}
          </span>
        )}
        {subjectChips}
        <span className="text-xs text-chalk/40 whitespace-nowrap flex-shrink-0">Joined {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 col-span-1 sm:col-span-auto justify-self-end">
        <select
          value={u.role}
          onChange={(e) => handleRoleChange(u._id, e.target.value)}
          className="px-2 py-1 text-sm bg-rule-line/30 border border-rule-line rounded text-chalk focus:outline-none focus:border-amber-chalk flex-shrink-0"
        >
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
          <option value="admin">Admin</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => handleDelete(u._id)} className="text-rust hover:bg-rust/10 flex-shrink-0" disabled={u._id === user._id}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function UserList({ users, loading, formatDistanceToNow, handleRoleChange, handleDelete, user, renderRoleIcon }) {
  if (loading) {
    return (
      <div className="p-8 text-center min-w-0">
        <Loader2 className="w-8 h-8 animate-spin text-amber-chalk mx-auto mb-2" />
        <p className="text-chalk/60">Loading users...</p>
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="p-12 text-center min-w-0">
        <Users className="w-16 h-16 text-chalk/30 mx-auto mb-4" />
        <h3 className="font-display font-medium text-lg text-chalk mb-2">No users found</h3>
        <p className="text-chalk/60">Add your first teacher to get started</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-rule-line min-w-0">
      {users.map(u => (
        <UserRow 
          key={u._id} 
          u={u} 
          formatDistanceToNow={formatDistanceToNow} 
          handleRoleChange={handleRoleChange} 
          handleDelete={handleDelete} 
          user={user}
        />
      ))}
    </div>
  );
}

export function AdminUsersPage() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [roleFilter, setRoleFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'teacher', department: '', subjects: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.users({ page: pagination.page, limit: pagination.limit, role: roleFilter });
      setUsers(res.data.users);
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, roleFilter]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    fetchUsers();
  }, [isAuthenticated, isAdmin, fetchUsers]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) return;
    setSubmitting(true);
    try {
      await adminApi.createTeacher({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        department: formData.department,
        subjects: formData.subjects.split(',').map(s => s.trim()).filter(Boolean),
      });
      setShowCreateModal(false);
      setFormData({ name: '', email: '', password: '', role: 'teacher', department: '', subjects: '' });
      fetchUsers();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to create user';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await adminApi.updateUserRole(userId, newRole);
      fetchUsers();
    } catch (err) {
      setError('Failed to update role');
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm('Delete this user?')) return;
    try {
      await adminApi.deleteUser(userId);
      fetchUsers();
    } catch (err) {
      setError('Failed to delete user');
    }
  };

  const openCreate = () => {
    setFormData({ name: '', email: '', password: '', role: 'teacher', department: '', subjects: '' });
    setError('');
    setShowCreateModal(true);
  };

  if (!isAdmin) {
    return (
      <div className="p-12 text-center">
        <h3 className="font-display font-medium text-lg text-chalk mb-2">Access Denied</h3>
        <p className="text-chalk/60">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display font-medium text-2xl text-chalk truncate">User Management</h1>
          <p className="text-chalk/60 truncate">Provision and manage user accounts</p>
        </div>
        <Button onClick={openCreate} className="flex-shrink-0">
          <UserPlus className="w-4 h-4" />
          Add Teacher
        </Button>
      </div>

      <Card className="min-w-0">
        <CardHeader className="border-b border-rule-line">
          <Select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            placeholder="All roles"
            options={[
              { value: '', label: 'All roles' },
              { value: 'student', label: 'Students' },
              { value: 'teacher', label: 'Teachers' },
              { value: 'admin', label: 'Admins' },
            ]}
            className="w-full sm:w-48"
          />
        </CardHeader>
        <CardContent className="p-0 min-w-0">
          <UserList 
            users={users} 
            loading={loading} 
            formatDistanceToNow={formatDistanceToNow} 
            handleRoleChange={handleRoleChange} 
            handleDelete={handleDelete} 
            user={user} 
            renderRoleIcon={renderRoleIcon} 
          />
        </CardContent>
      </Card>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in">
          <div className="w-full max-w-md bg-chalkboard border border-rule-line rounded-xl p-6 animate-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-medium text-xl text-chalk">Create Teacher Account</h2>
              <button onClick={() => { setShowCreateModal(false); setError(''); }} className="p-1 text-chalk/50 hover:text-chalk">
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div className="mb-4 p-3 bg-rust/10 border border-rust/30 rounded-lg text-rust text-sm" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              <Input label="Full Name" value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Dr. Jane Smith" required />
              <Input label="Email" type="email" value={formData.email} onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} placeholder="teacher@paruluniversity.ac.in" required />
              <Input label="Password" type="password" value={formData.password} onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))} placeholder="Min 8 characters" required />
              <Input label="Department" value={formData.department} onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))} placeholder="Computer Science Engineering" />
              <Input label="Subjects (comma-separated)" value={formData.subjects} onChange={(e) => setFormData(prev => ({ ...prev, subjects: e.target.value }))} placeholder="Data Structures, Algorithms, Database Systems" />
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => { setShowCreateModal(false); setError(''); }} className="flex-1">Cancel</Button>
                <Button type="submit" loading={submitting} className="flex-1">Create Teacher</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}