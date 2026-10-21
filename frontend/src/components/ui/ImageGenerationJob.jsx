import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle, Download, Trash2, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { Button } from './Button';
import { imageApi } from '@/utils/api';
import { formatDistanceToNow } from 'date-fns';

const STATUS_CONFIG = {
  queued: { icon: Loader2, color: 'text-amber-chalk', bg: 'bg-amber-chalk/10', label: 'Queued', animate: true },
  processing: { icon: Loader2, color: 'text-amber-chalk', bg: 'bg-amber-chalk/10', label: 'Generating...', animate: true },
  done: { icon: CheckCircle, color: 'text-sage', bg: 'bg-sage/10', label: 'Ready', animate: false },
  failed: { icon: AlertCircle, color: 'text-rust', bg: 'bg-rust/10', label: 'Failed', animate: false },
};

export function ImageGenerationJob({ imageId, onDelete, onRefresh }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await imageApi.getJob(imageId);
      setJob(res.data);
      setError(null);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch job status');
      return null;
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Poll for status updates
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') {
      setPolling(false);
      return;
    }

    setPolling(true);
    const interval = setInterval(() => {
      fetchJob().then((data) => {
        if (data && (data.status === 'done' || data.status === 'failed')) {
          setPolling(false);
          if (onRefresh) onRefresh();
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [job, fetchJob, onRefresh]);

  if (loading) {
    return (
      <div className="card animate-in">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="card animate-in text-center py-8 text-rust">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        <p>Failed to load job</p>
      </div>
    );
  }

  const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
  const Icon = config.icon;
  const imageUrl = job.imageUrl;

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = job.fileName || `generated-${imageId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this generated image?')) return;
    try {
      await imageApi.delete(imageId);
      if (onDelete) onDelete();
    } catch (err) {
      alert('Failed to delete image');
    }
  };

  return (
    <div className="card animate-in">
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 ${config.color} ${config.animate ? 'animate-spin' : ''}`} aria-hidden="true" />
            <div>
              <p className="font-medium text-chalk">Image Generation</p>
              <p className="text-sm text-chalk/60">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${config.bg} ${config.color}`}>
                  {config.label}
                </span>
                {job.createdAt && (
                  <span className="ml-2 text-xs text-chalk/40">
                    {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                  </span>
                )}
              </p>
            </div>
          </div>
          {job.status === 'done' && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4" />
                Download
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDelete} className="text-rust hover:bg-rust/10">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
          {job.status === 'failed' && (
            <Button variant="secondary" size="sm" onClick={() => fetchJob()}>
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          )}
        </div>

        {/* Error Message */}
        {job.error && (
          <div className="p-3 bg-rust/10 border border-rust/30 rounded-lg text-rust text-sm">
            <p className="font-medium">Error:</p>
            <p>{job.error}</p>
          </div>
        )}

        {/* Result Image */}
        {job.status === 'done' && imageUrl && (
          <div className="relative group">
            <div className="aspect-square bg-rule-line/30 rounded-lg overflow-hidden">
              <img
                src={imageUrl}
                alt={`Generated: ${job.prompt}`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            </div>
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" onClick={handleDownload} className="bg-chalkboard/80 backdrop-blur">
                <Download className="w-4 h-4 text-chalk" />
              </Button>
            </div>
          </div>
        )}

        {/* Prompt Display */}
        <div className="p-3 bg-rule-line/30 rounded-lg">
          <p className="text-xs text-chalk/50 font-mono uppercase tracking-wider mb-1">Prompt</p>
          <p className="text-chalk/90 whitespace-pre-wrap text-sm">{job.prompt}</p>
          <div className="flex flex-wrap gap-2 mt-2 text-xs text-chalk/50">
            <span>{job.width}×{job.height}</span>
            {job.seed && <span>Seed: {job.seed}</span>}
          </div>
        </div>

        {/* Queue Status (if available) */}
        {job.queueStatus && job.status !== 'done' && job.status !== 'failed' && (
          <div className="p-3 bg-sage/10 border border-sage/20 rounded-lg text-sm">
            <p className="text-sage font-medium">Queue Status: {job.queueStatus.state}</p>
            {job.queueStatus.progress !== undefined && (
              <div className="mt-2 h-1.5 bg-rule-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-sage transition-all duration-300"
                  style={{ width: `${job.queueStatus.progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ImageHistoryGrid({ images, onDelete, onClick }) {
  if (!images || images.length === 0) {
    return (
      <div className="card text-center py-12">
        <ImageIcon className="w-16 h-16 text-chalk/30 mx-auto mb-4" />
        <h3 className="font-display font-medium text-lg text-chalk mb-2">No generated images yet</h3>
        <p className="text-chalk/60">Create your first image using the form above</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {images.map((img) => (
        <div
          key={img.id}
          className="group relative bg-rule-line/30 rounded-xl overflow-hidden border border-rule-line hover:border-amber-chalk/30 transition-colors cursor-pointer"
          onClick={() => onClick?.(img)}
        >
          {img.imageUrl && img.status === 'done' ? (
            <img
              src={img.imageUrl}
              alt={`Generated: ${img.prompt}`}
              className="w-full aspect-square object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center bg-rule-line/50">
              <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
            </div>
          )}

          {/* Overlay with actions */}
          <div className="absolute inset-0 bg-chalkboard/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4">
            <p className="text-sm text-chalk/80 truncate w-full mb-2 font-medium">{img.prompt}</p>
            <div className="flex gap-2 w-full justify-center">
              {img.status === 'done' && img.imageUrl && (
                <a
                  href={img.imageUrl}
                  download={img.fileName}
                  className="btn-primary text-sm px-3 py-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(img.id);
                }}
                className="btn-secondary text-sm px-3 py-1.5 text-rust border-rust/30 hover:bg-rust/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-chalk/50 mt-2">
              {formatDistanceToNow(new Date(img.createdAt), { addSuffix: true })}
            </p>
          </div>

          {/* Status badge */}
          <div className="absolute top-2 left-2">
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${STATUS_CONFIG[img.status]?.bg} ${STATUS_CONFIG[img.status]?.color}`}>
              {STATUS_CONFIG[img.status]?.label || img.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}