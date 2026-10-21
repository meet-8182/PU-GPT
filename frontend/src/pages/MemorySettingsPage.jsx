import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Brain,
  Trash2,
  Edit,
  Loader2,
  AlertCircle,
  Search,
  Copy,
  Eye,
  EyeOff,
  Info,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { memoryApi } from '@/utils/api';
import { toast } from 'sonner';

const CATEGORY_LABELS = {
  preference: 'Learning Preference',
  goal: 'Learning Goal',
  project: 'Project Detail',
  fact: 'Fact',
  style: 'Communication Style',
  other: 'Other',
};

const CATEGORY_COLORS = {
  preference: 'bg-amber-chalk/20 text-amber-chalk border-amber-chalk/30',
  goal: 'bg-sage/20 text-sage border-sage/30',
  project: 'bg-blue/20 text-blue border-blue/30',
  fact: 'bg-purple/20 text-purple border-purple/30',
  style: 'bg-pink/20 text-pink border-pink/30',
  other: 'bg-chalk/20 text-chalk border-chalk/30',
};

export function MemorySettingsPage() {
  const { user } = useAuth();
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ content: '', category: 'fact', confidence: 1.0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await memoryApi.list({ includeInactive: false });
      setMemories(res.data.memories || []);
    } catch (err) {
      console.error('Failed to fetch memories:', err);
      setError('Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await memoryApi.getCategories();
      setCategories(res.data.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
    fetchCategories();
  }, [fetchMemories, fetchCategories]);

  const filteredMemories = memories.filter(m => {
    const matchesSearch = !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !filterCategory || m.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const handleUpdateMemory = async (e) => {
    e.preventDefault();
    if (!formData.content.trim()) return;
    
    try {
      await memoryApi.update(editingId, formData);
      toast.success('Memory updated');
      setEditingId(null);
      setFormData({ content: '', category: 'fact', confidence: 1.0 });
      fetchMemories();
    } catch (err) {
      console.error('Failed to update memory:', err);
      toast.error(err.response?.data?.error || 'Failed to update memory');
    }
  };

  const handleDeleteMemory = async (id) => {
    if (!confirm('Delete this memory?')) return;
    
    setDeletingId(id);
    try {
      await memoryApi.delete(id);
      toast.success('Memory deleted');
      fetchMemories();
    } catch (err) {
      console.error('Failed to delete memory:', err);
      toast.error('Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllMemories = async () => {
    if (!confirm('Are you sure you want to delete ALL memories? This cannot be undone.')) return;
    
    try {
      await memoryApi.clearAll(true);
      toast.success('All memories cleared');
      fetchMemories();
    } catch (err) {
      console.error('Failed to clear memories:', err);
      toast.error('Failed to clear memories');
    }
  };

  const startEdit = (memory) => {
    setEditingId(memory._id);
    setFormData({
      content: memory.content,
      category: memory.category,
      confidence: memory.confidence,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({ content: '', category: 'fact', confidence: 1.0 });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display font-medium text-2xl text-chalk mb-1">Memory</h1>
        <p className="text-chalk/60">View and manage what PU-GPT has learned about you</p>
      </div>

      {/* Memories List */}
      <Card padding="p-0">
        <CardHeader className="p-4 border-b border-rule-line">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-chalk/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search memories..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-rule-line/30 border border-rule-line text-chalk placeholder:text-chalk/40 focus:outline-none focus:border-amber-chalk"
              />
            </div>
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              placeholder="All categories"
              options={[
                { value: '', label: 'All categories' },
                ...categories.map(c => ({ value: c, label: CATEGORY_LABELS[c] || c })),
              ]}
              className="w-48"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-amber-chalk mx-auto mb-2" />
              <p className="text-chalk/60">Loading memories...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-rust">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>{error}</p>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="p-12 text-center">
              <Brain className="w-16 h-16 text-chalk/30 mx-auto mb-4" />
              <h3 className="font-display font-medium text-lg text-chalk mb-2">No memories yet</h3>
              <p className="text-chalk/60 mb-6">
                {searchQuery || filterCategory 
                  ? 'No memories match your filters' 
                  : 'PU-GPT will learn about you over time from your conversations.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-rule-line">
              {filteredMemories.map(memory => (
                <div key={memory._id} className="p-4 hover:bg-rule-line/20 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${CATEGORY_COLORS[memory.category] || CATEGORY_COLORS.other}`}>
                            {CATEGORY_LABELS[memory.category] || memory.category}
                          </span>
                          {memory.source === 'extracted' && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-purple/20 text-purple border border-purple/30 rounded-full">
                              Auto-extracted
                            </span>
                          )}
                          {memory.source === 'explicit' && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-amber-chalk/20 text-amber-chalk border border-amber-chalk/30 rounded-full">
                              Manual
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {editingId === memory._id ? (
                            <form onSubmit={handleUpdateMemory} className="flex items-center gap-1">
                              <input
                                type="text"
                                value={formData.content}
                                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                                className="w-64 px-2 py-1 rounded bg-rule-line/30 border border-rule-line text-chalk text-sm"
                                maxLength={2000}
                              />
                              <Select
                                value={formData.category}
                                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                options={categories.map(c => ({ value: c, label: CATEGORY_LABELS[c] || c }))}
                                className="w-32"
                              />
                              <Button type="submit" size="sm" variant="primary">
                                <Save className="w-3.5 h-3.5" />
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </form>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startEdit(memory)}
                                className="text-chalk/60 hover:text-chalk hover:bg-rule-line/50"
                                aria-label="Edit memory"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(memory.content)}
                                className="text-chalk/60 hover:text-chalk hover:bg-rule-line/50"
                                aria-label="Copy memory"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteMemory(memory._id)}
                                disabled={deletingId === memory._id}
                                className="text-rust hover:bg-rust/10"
                                aria-label="Delete memory"
                              >
                                {deletingId === memory._id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {editingId === memory._id ? null : (
                        <p className="text-chalk/90 mt-2">{memory.content}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-chalk/50">
                        <span>Confidence: {Math.round(memory.confidence * 100)}%</span>
                        {memory.metadata?.subject && (
                          <span>Subject: {memory.metadata.subject}</span>
                        )}
                        {memory.metadata?.extractedAt && (
                          <span>Learned: {new Date(memory.metadata.extractedAt).toLocaleDateString()}</span>
                        )}
                        <span>Updated: {new Date(memory.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && filteredMemories.length > 0 && (
            <div className="p-4 border-t border-rule-line flex items-center justify-between">
              <p className="text-sm text-chalk/60">
                {filteredMemories.length} of {memories.length} memories
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAllMemories}
                className="text-rust hover:bg-rust/10"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All Memories
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card padding="p-0" className="border-sage/30">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <Info className="w-5 h-5 text-sage flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-chalk mb-2">How Memory Works</h4>
              <ul className="space-y-1 text-sm text-chalk/70">
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" /> <strong>Auto-extracted memories:</strong> PU-GPT learns preferences, goals, and facts from your conversations (when enabled in Settings)</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" /> <strong>Categories:</strong> Memories are organized by type (preferences, goals, projects, facts, style)</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" /> <strong>Privacy:</strong> Memories are tied to your account only. No passwords, API keys, or sensitive data are stored</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" /> <strong>Usage:</strong> Memories personalize responses but are never used as factual evidence for academic answers</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" /> <strong>Control:</strong> Disable memory in Settings, edit/delete individual memories, or clear everything</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}