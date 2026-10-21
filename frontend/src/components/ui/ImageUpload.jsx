import { useState, useCallback, useRef } from 'react';
import { Image, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export function ImageUpload({
  onUpload,
  onRemove,
  accept = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
  maxSize = 10 * 1024 * 1024,
  disabled = false,
}) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  const validateFile = useCallback((f) => {
    if (f.size > maxSize) {
      return `File size exceeds ${maxSize / (1024 * 1024)}MB limit`;
    }
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(f.type)) {
      return 'Only PNG, JPEG, WebP, and PDF files are allowed';
    }
    return null;
  }, [maxSize]);

  const createPreview = useCallback((f) => {
    if (f.type.startsWith('image/')) {
      return URL.createObjectURL(f);
    }
    return null; // PDF - no preview
  }, []);

  const handleFileSelect = useCallback((e) => {
    const f = e.target.files[0];
    if (!f) return;

    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }

    setFile(f);
    setPreview(createPreview(f));
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [validateFile, createPreview]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-amber-chalk', 'bg-amber-chalk/5');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-amber-chalk', 'bg-amber-chalk/5');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-amber-chalk', 'bg-amber-chalk/5');
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect({ target: { files: [f] } });
  }, [handleFileSelect]);

  const removeFile = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setError(null);
    if (onRemove) onRemove();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [preview, onRemove]);

  const handleSubmit = async () => {
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      await onUpload(file, (progressEvent) => {
        if (progressEvent.lengthComputable) {
          setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        }
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const isImage = file?.type.startsWith('image/');
  const isPDF = file?.type === 'application/pdf';

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
          file
            ? 'border-rule-line bg-rule-line/20'
            : 'border-rule-line hover:border-amber-chalk/50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept.join(',')}
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={uploading || disabled || !!file}
        />

        {file ? (
          <div className="flex items-center justify-center gap-4 p-4 bg-chalkboard/50 rounded-lg border border-rule-line">
            {isImage && preview && (
              <img
                src={preview}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg"
              />
            )}
            {isPDF && (
              <div className="w-20 h-20 bg-rust/20 rounded-lg flex items-center justify-center">
                <Image className="w-8 h-8 text-rust" />
              </div>
            )}
            <div className="text-left flex-1 min-w-0">
              <p className="font-medium text-chalk truncate">{file.name}</p>
              <p className="text-sm text-chalk/50">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              {isPDF && <p className="text-xs text-amber-chalk">PDF - will be OCR processed</p>}
            </div>
            <button
              type="button"
              onClick={removeFile}
              disabled={uploading}
              className="p-2 text-chalk/50 hover:text-rust hover:bg-rust/10 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Remove file"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Image className="w-12 h-12 text-chalk/40 mx-auto" />
            <p className="text-chalk/60">Drag & drop an image or PDF, or click to browse</p>
            <p className="text-xs text-chalk/40">
              PNG, JPEG, WebP, PDF up to {maxSize / (1024 * 1024)}MB
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-rust/10 border border-rust/30 rounded-lg text-rust text-sm" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {uploading && (
        <div className="space-y-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="flex justify-between text-sm text-chalk/60">
            <span>Processing...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-rule-line rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-chalk transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {file && !uploading && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          className="w-full btn-primary"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Extract Text
        </button>
      )}
    </div>
  );
}