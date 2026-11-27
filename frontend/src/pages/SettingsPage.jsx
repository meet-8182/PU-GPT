import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  Brain,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Shield,
  Save,
  AlertCircle,
  CheckCircle,
  GraduationCap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { memoryApi, authApi } from '@/utils/api';
import { toast } from 'sonner';

const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({
    department: user?.department || '',
    semester: user?.semester || '',
  });
  const [departments, setDepartments] = useState([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);

  useEffect(() => {
    setProfile({
      department: user?.department || '',
      semester: user?.semester || '',
    });
  }, [user?.department, user?.semester]);

  useEffect(() => {
    let active = true;
    (async () => {
      setDepartmentsLoading(true);
      try {
        const res = await authApi.departments();
        if (!active) return;
        const list = res.data?.departments || [];
        const current = user?.department;
        setDepartments(current && !list.includes(current) ? [current, ...list] : list);
      } catch (err) {
        console.error('Failed to load departments:', err);
        if (active && user?.department) setDepartments([user.department]);
      } finally {
        if (active) setDepartmentsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user?.department]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      await updateProfile({
        department: profile.department || '',
        semester: profile.semester || '',
      });
      toast.success('Profile updated');
      window.dispatchEvent(new Event('pu:history-updated'));
    } catch (err) {
      console.error('Failed to update profile:', err);
      toast.error(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await memoryApi.list({ includeInactive: false });
      if (res.data.memoryEnabled !== undefined) {
        setMemoryEnabled(res.data.memoryEnabled);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleToggleMemory = async (enabled) => {
    try {
      setSaving(true);
      await memoryApi.toggle(enabled);
      setMemoryEnabled(enabled);
      toast.success(enabled ? 'Long-term memory enabled' : 'Long-term memory disabled');
    } catch (err) {
      console.error('Failed to toggle memory:', err);
      toast.error('Failed to update memory setting');
      setMemoryEnabled(!enabled);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-medium text-2xl text-chalk mb-1">Settings</h1>
        <p className="text-chalk/60">Manage your preferences</p>
      </div>

      {/* Student profile Section */}
      <Card padding="p-0">
        <CardHeader className="p-4 border-b border-rule-line">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-sage" />
            <CardTitle className="text-lg">Student Profile</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSaveProfile} className="space-y-5">
            <p className="text-sm text-chalk/60">
              Your department and semester are used to filter course materials and make suggested questions relevant.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Department"
                value={profile.department}
                onChange={(e) => setProfile((prev) => ({ ...prev, department: e.target.value }))}
                placeholder={departmentsLoading ? 'Loading departments…' : 'Select department'}
                options={departments.map((department) => ({ value: department, label: department }))}
                disabled={departmentsLoading}
              />
              <Select
                label="Semester"
                value={profile.semester}
                onChange={(e) => setProfile((prev) => ({ ...prev, semester: e.target.value }))}
                placeholder="Select semester"
                options={SEMESTERS.map((semester) => ({ value: semester, label: `Semester ${semester}` }))}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={profileSaving}>
                <Save className="w-4 h-4" />
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Personalization Section */}
      <Card padding="p-0">
        <CardHeader className="p-4 border-b border-rule-line">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-sage" />
            <CardTitle className="text-lg">Personalization</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-sage/20 flex items-center justify-center">
                  {memoryEnabled ? (
                    <Brain className="w-5 h-5 text-sage" />
                  ) : (
                    <Shield className="w-5 h-5 text-chalk/50" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-chalk">Long-Term Memory</h3>
                  <p className="text-sm text-chalk/60">
                    Allow PU-GPT to remember useful information from your conversations across chats.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/memory')}
                  className="whitespace-nowrap"
                >
                  Manage memories
                </Button>
                <Button
                  variant={memoryEnabled ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => handleToggleMemory(!memoryEnabled)}
                  disabled={saving}
                  className="whitespace-nowrap"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    memoryEnabled ? (
                      <>
                        <ToggleRight className="w-4 h-4 mr-2" />
                        Enabled
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="w-4 h-4 mr-2" />
                        Disabled
                      </>
                    )
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-chalk/50 mt-2">
              {memoryEnabled
                ? 'PU-GPT will learn your preferences, goals, and facts from conversations.'
                : 'PU-GPT will not store or use any long-term memories. Existing memories are preserved.'}
            </p>
          </div>

          <div className="pt-4 border-t border-rule-line">
            <h4 className="font-medium text-chalk mb-2">About Long-Term Memory</h4>
            <ul className="space-y-1 text-sm text-chalk/60">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>When enabled, PU-GPT automatically extracts useful information from your conversations</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>Memories include learning preferences, goals, project details, and communication style</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>Memories are used to personalize responses but never as factual evidence for academic answers</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>You can view and manage extracted memories on the Memory page</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>Disabling this stops new memory creation but preserves existing memories</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}