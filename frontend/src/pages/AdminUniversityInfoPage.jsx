import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GraduationCap,
  Upload,
  PlusCircle,
  Settings,
  History,
  Eye,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Replace,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { universityInfoApi } from '@/utils/api';
import { formatDistanceToNow } from 'date-fns';

const CATEGORIES = [
  'admissions',
  'programs',
  'fees',
  'scholarships',
  'campus',
  'hostel',
  'placements',
  'rules',
  'events',
  'contact',
  'other',
];

const STATUS_STYLES = {
  approved: 'bg-sage/15 text-sage border-sage/30',
  draft: 'bg-amber-chalk/15 text-amber-chalk border-amber-chalk/30',
  superseded: 'bg-chalk/10 text-chalk/60 border-rule-line',
  expired: 'bg-rust/10 text-rust border-rust/30',
};

const TABS = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'quick', label: 'Quick fact', icon: PlusCircle },
  { id: 'settings', label: 'Contact & disclaimer', icon: Settings },
  { id: 'audit', label: 'Audit log', icon: History },
  { id: 'preview', label: 'Preview as visitor', icon: Eye },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function personLabel(person) {
  if (!person) return '—';
  if (typeof person === 'string') return person;
  return person.name || person.email || '—';
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs capitalize ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status}
    </span>
  );
}

function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  const isError = notice.type === 'error';
  return (
    <div
      className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${isError ? 'border-rust/40 bg-rust/10 text-rust' : 'border-sage/40 bg-sage/10 text-sage'}`}
      role={isError ? 'alert' : 'status'}
    >
      {isError ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 mt-0.5" />}
      <span className="flex-1">{notice.message}</span>
      <button type="button" onClick={onDismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">×</button>
    </div>
  );
}

export function AdminUniversityInfoPage() {
  const [tab, setTab] = useState('documents');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [uploadForm, setUploadForm] = useState({
    title: '',
    category: 'admissions',
    effectiveFrom: today(),
    validUntil: '',
    file: null,
  });

  const [quickForm, setQuickForm] = useState({
    title: '',
    category: 'other',
    content: '',
    effectiveFrom: today(),
    validUntil: '',
  });

  const [settings, setSettings] = useState({ contactBlock: '', disclaimer: '' });
  const [auditEntries, setAuditEntries] = useState([]);
  const [previewDocs, setPreviewDocs] = useState([]);
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);

  const notify = (type, message) => setNotice({ type, message });

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const params = {};
      if (filterCategory) params.category = filterCategory;
      if (filterStatus) params.status = filterStatus;
      const res = await universityInfoApi.list(params);
      setDocuments(res.data.documents || []);
    } catch (err) {
      console.error('Failed to load university info documents:', err);
      notify('error', err.response?.data?.error || 'Could not load documents.');
    } finally {
      setLoadingDocs(false);
    }
  }, [filterCategory, filterStatus]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await universityInfoApi.settings();
      setSettings({
        contactBlock: res.data.settings?.contactBlock || '',
        disclaimer: res.data.settings?.disclaimer || '',
      });
    } catch (err) {
      notify('error', err.response?.data?.error || 'Could not load settings.');
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await universityInfoApi.audit({ limit: 100 });
      setAuditEntries(res.data.entries || []);
    } catch (err) {
      notify('error', err.response?.data?.error || 'Could not load the audit log.');
    }
  }, []);

  const loadPreview = useCallback(async () => {
    try {
      const res = await universityInfoApi.preview({ includeDraft: true });
      setPreviewDocs(res.data.documents || []);
    } catch (err) {
      notify('error', err.response?.data?.error || 'Could not load the visitor preview.');
    }
  }, []);

  useEffect(() => {
    if (tab === 'settings') loadSettings();
    if (tab === 'audit') loadAudit();
    if (tab === 'preview') loadPreview();
  }, [tab, loadSettings, loadAudit, loadPreview]);

  const runAction = async (action, successMessage) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      notify('success', successMessage);
      await loadDocuments();
      if (tab === 'preview') await loadPreview();
      if (tab === 'audit') await loadAudit();
      return result;
    } catch (err) {
      console.error('University info action failed:', err);
      notify('error', err.response?.data?.error || err.message || 'Action failed.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!uploadForm.file) {
      notify('error', 'Choose a PDF, DOCX, TXT or image file first.');
      return;
    }
    const formData = new FormData();
    formData.append('file', uploadForm.file);
    formData.append('title', uploadForm.title);
    formData.append('category', uploadForm.category);
    formData.append('effectiveFrom', uploadForm.effectiveFrom);
    if (uploadForm.validUntil) formData.append('validUntil', uploadForm.validUntil);

    const result = await runAction(async () => {
      const res = await universityInfoApi.upload(formData);
      return res.data;
    }, 'Document uploaded as a draft. Review it, then approve.');
    if (!result) return;
    if (result.warning) {
      notify('error', `Saved, but indexing needs attention: ${result.warning}`);
    }
    setUploadForm({ title: '', category: 'admissions', effectiveFrom: today(), validUntil: '', file: null });
    event.target.reset();
  };

  const handleQuickFact = async (event) => {
    event.preventDefault();
    await runAction(
      () => universityInfoApi.quickFact(quickForm),
      'Quick fact published to the guest page.'
    );
    setQuickForm({ title: '', category: 'other', content: '', effectiveFrom: today(), validUntil: '' });
  };

  const handleSettings = async (event) => {
    event.preventDefault();
    await runAction(
      () => universityInfoApi.updateSettings(settings),
      'Contact block and disclaimer updated.'
    );
  };

  const handleReplacePicked = async (event) => {
    const file = event.target.files?.[0];
    const target = replaceTargetRef.current;
    event.target.value = '';
    if (!file || !target) return;
    const formData = new FormData();
    formData.append('file', file);
    await runAction(
      () => universityInfoApi.replace(target._id, formData),
      `Replacement uploaded as version ${(target.version || 1) + 1}. The old version is superseded.`
    );
  };

  const confirmDelete = (doc) => {
    if (!window.confirm(`Delete "${doc.title}" permanently? This removes its searchable chunks.`)) return;
    runAction(() => universityInfoApi.remove(doc._id), 'Document deleted.');
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-chalk flex items-center justify-center flex-shrink-0">
          <GraduationCap className="w-6 h-6 text-pu-cream" />
        </div>
        <div>
          <h1 className="font-display text-2xl text-chalk">University Info</h1>
          <p className="text-sm text-chalk/60">
            Approved information for the public “About Parul University” chat. Drafts are never visible to visitors.
          </p>
        </div>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="flex flex-wrap gap-2 border-b border-rule-line pb-2">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === item.id
                  ? 'bg-amber-chalk/15 text-amber-chalk border border-amber-chalk/30'
                  : 'text-chalk/70 hover:bg-chalk/5 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'documents' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="rounded-lg border border-rule-line bg-pu-panel px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className="rounded-lg border border-rule-line bg-pu-panel px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {['draft', 'approved', 'superseded', 'expired'].map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadDocuments}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-rule-line text-sm text-chalk/70 hover:bg-chalk/5"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>

          <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplacePicked} accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" />

          {loadingDocs ? (
            <div className="flex items-center gap-2 text-chalk/60 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading documents…</div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-rule-line bg-pu-panel p-6 text-sm text-chalk/60">
              No documents yet. Upload a university document or add a quick fact.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-rule-line">
              <table className="w-full text-sm">
                <thead className="bg-chalk/5 text-chalk/60 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Ver.</th>
                    <th className="px-3 py-2 font-medium">Last reviewed</th>
                    <th className="px-3 py-2 font-medium">Uploader</th>
                    <th className="px-3 py-2 font-medium">Approver</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc._id} className="border-t border-rule-line align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium text-chalk">{doc.title}</p>
                        <p className="text-xs text-chalk/50">{doc.sourceDoc}</p>
                        {doc.warnings?.length > 0 && (
                          <p className="text-xs text-amber-chalk mt-1">{doc.warnings[0]}</p>
                        )}
                        {doc.errorMessage && (
                          <p className="text-xs text-rust mt-1">{doc.errorMessage}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 capitalize text-chalk/70">{doc.category}</td>
                      <td className="px-3 py-2"><StatusBadge status={doc.status} /></td>
                      <td className="px-3 py-2 text-chalk/70">{doc.version}</td>
                      <td className="px-3 py-2 text-chalk/70 whitespace-nowrap">
                        {doc.lastReviewed ? formatDistanceToNow(new Date(doc.lastReviewed), { addSuffix: true }) : '—'}
                      </td>
                      <td className="px-3 py-2 text-chalk/70">{personLabel(doc.uploadedBy)}</td>
                      <td className="px-3 py-2 text-chalk/70">{personLabel(doc.approvedBy)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {doc.status !== 'approved' && doc.status !== 'superseded' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runAction(() => universityInfoApi.approve(doc._id), 'Document approved and visible to visitors.')}
                              className="px-2 py-1 rounded border border-sage/40 text-sage text-xs hover:bg-sage/10 disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          {doc.status === 'approved' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runAction(() => universityInfoApi.unapprove(doc._id), 'Document unapproved and hidden from visitors.')}
                              className="px-2 py-1 rounded border border-amber-chalk/40 text-amber-chalk text-xs hover:bg-amber-chalk/10 disabled:opacity-50"
                            >
                              Unapprove
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              replaceTargetRef.current = doc;
                              replaceInputRef.current?.click();
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rule-line text-chalk/70 text-xs hover:bg-chalk/5 disabled:opacity-50"
                          >
                            <Replace className="w-3 h-3" /> Replace
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runAction(() => universityInfoApi.reprocess(doc._id), 'Document reprocessed.')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rule-line text-chalk/70 text-xs hover:bg-chalk/5 disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" /> Reprocess
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => confirmDelete(doc)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rust/40 text-rust text-xs hover:bg-rust/10 disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'upload' && (
        <form onSubmit={handleUpload} className="space-y-4 max-w-2xl">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-chalk/70">Title</span>
              <input
                value={uploadForm.title}
                onChange={(event) => setUploadForm({ ...uploadForm, title: event.target.value })}
                required
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Category</span>
              <select
                value={uploadForm.category}
                onChange={(event) => setUploadForm({ ...uploadForm, category: event.target.value })}
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              >
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Effective from</span>
              <input
                type="date"
                value={uploadForm.effectiveFrom}
                onChange={(event) => setUploadForm({ ...uploadForm, effectiveFrom: event.target.value })}
                required
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Valid until (optional)</span>
              <input
                type="date"
                value={uploadForm.validUntil}
                onChange={(event) => setUploadForm({ ...uploadForm, validUntil: event.target.value })}
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-chalk/70">Document (PDF, DOCX, TXT, PNG, JPEG, WebP)</span>
            <input
              type="file"
              onChange={(event) => setUploadForm({ ...uploadForm, file: event.target.files?.[0] || null })}
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
              required
              className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-chalk text-pu-cream font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload draft
          </button>
          <p className="text-xs text-chalk/50">
            Uploaded documents start as drafts. Approve them before they appear on the public page.
          </p>
        </form>
      )}

      {tab === 'quick' && (
        <form onSubmit={handleQuickFact} className="space-y-4 max-w-2xl">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-chalk/70">Title</span>
              <input
                value={quickForm.title}
                onChange={(event) => setQuickForm({ ...quickForm, title: event.target.value })}
                required
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Category</span>
              <select
                value={quickForm.category}
                onChange={(event) => setQuickForm({ ...quickForm, category: event.target.value })}
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              >
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Effective from</span>
              <input
                type="date"
                value={quickForm.effectiveFrom}
                onChange={(event) => setQuickForm({ ...quickForm, effectiveFrom: event.target.value })}
                required
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-chalk/70">Valid until (optional)</span>
              <input
                type="date"
                value={quickForm.validUntil}
                onChange={(event) => setQuickForm({ ...quickForm, validUntil: event.target.value })}
                className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-chalk/70">Approved text</span>
            <textarea
              value={quickForm.content}
              onChange={(event) => setQuickForm({ ...quickForm, content: event.target.value })}
              rows={6}
              required
              placeholder="Write the exact approved wording. It is published immediately."
              className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-chalk text-pu-cream font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />} Publish quick fact
          </button>
        </form>
      )}

      {tab === 'settings' && (
        <form onSubmit={handleSettings} className="space-y-4 max-w-2xl">
          <label className="block text-sm">
            <span className="text-chalk/70">Contact block (shown when information is missing)</span>
            <textarea
              value={settings.contactBlock}
              onChange={(event) => setSettings({ ...settings, contactBlock: event.target.value })}
              rows={6}
              required
              className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-chalk/70">Footer disclaimer</span>
            <textarea
              value={settings.disclaimer}
              onChange={(event) => setSettings({ ...settings, disclaimer: event.target.value })}
              rows={3}
              required
              className="mt-1 w-full rounded-lg border border-rule-line bg-pu-panel px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-chalk text-pu-cream font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />} Save settings
          </button>
        </form>
      )}

      {tab === 'audit' && (
        <section className="space-y-2">
          {auditEntries.length === 0 ? (
            <p className="text-sm text-chalk/60">No audit entries yet.</p>
          ) : auditEntries.map((entry) => (
            <div key={entry._id} className="rounded-lg border border-rule-line bg-pu-panel px-3 py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="font-medium capitalize text-chalk">{entry.action}</span>
              <span className="text-chalk/70">{entry.documentTitle || '—'}</span>
              <span className="text-xs text-chalk/50">{entry.actorEmail || 'unknown admin'}</span>
              <span className="text-xs text-chalk/40 ml-auto">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </section>
      )}

      {tab === 'preview' && (
        <section className="space-y-4">
          <p className="text-sm text-chalk/60">
            Approved documents are visible to visitors. Drafts are shown here for review only and are never retrievable by the guest assistant.
          </p>
          {previewDocs.length === 0 ? (
            <p className="text-sm text-chalk/60">Nothing to preview yet.</p>
          ) : previewDocs.map((doc) => (
            <div key={doc._id} className="rounded-xl border border-rule-line bg-pu-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-chalk">{doc.title}</h3>
                <StatusBadge status={doc.status} />
                <span className="text-xs text-chalk/50 capitalize">{doc.category}</span>
                <span className={`ml-auto inline-flex items-center gap-1 text-xs ${doc.visibleToVisitors ? 'text-sage' : 'text-chalk/50'}`}>
                  {doc.visibleToVisitors ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {doc.visibleToVisitors ? 'Visible to visitors' : 'Hidden from visitors'}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {(doc.chunks || []).length === 0 ? (
                  <p className="text-xs text-chalk/50">No indexed chunks.</p>
                ) : doc.chunks.map((chunk, index) => (
                  <div key={index} className="rounded-lg bg-chalkboard/60 border border-rule-line p-2">
                    <p className="text-xs text-chalk/50 mb-1">
                      {chunk.heading || 'Section'} · page {chunk.page}
                    </p>
                    <p className="text-sm text-chalk/80 whitespace-pre-wrap">{chunk.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
