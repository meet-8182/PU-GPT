import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { memoryApi } from '@/utils/api';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user } = useAuth();
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

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