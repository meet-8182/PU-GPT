import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle,
  Info,
  Image as ImageIcon,
  Sparkles,
  SlidersHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ImageGenerationJob, ImageHistoryGrid } from '@/components/ui/ImageGenerationJob';
import { imageApi } from '@/utils/api';

const SIZE_PRESETS = [
  { value: '512x512', label: '512×512 (Square)', width: 512, height: 512 },
  { value: '768x768', label: '768×768 (Square)', width: 768, height: 768 },
  { value: '1024x1024', label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { value: '768x512', label: '768×512 (Landscape)', width: 768, height: 512 },
  { value: '512x768', label: '512×768 (Portrait)', width: 512, height: 768 },
];

const EXAMPLE_PROMPTS = [
  'A detailed diagram of the quicksort algorithm with code annotations',
  'Cellular respiration process flowchart with mitochondria',
  'Neural network architecture visualization with layers and connections',
  'Periodic table with element groups highlighted in color',
  'Free body diagram of forces on an inclined plane',
  'Database normalization steps from 1NF to 3NF',
  'OSI model layers with protocols at each layer',
  'React component lifecycle diagram',
];

export function ImageStudio() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('768x768');
  const [seed, setSeed] = useState('');
  const [generating, setGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [images, setImages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, pages: 0 });
  const [health, setHealth] = useState(null);
  const [showExamples, setShowExamples] = useState(true);

  // Fetch health on mount
  useEffect(() => {
    imageApi.health().then(res => setHealth(res.data)).catch(() => setHealth({}));
  }, []);

  // Fetch history on mount and pagination change
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await imageApi.history({ page: pagination.page, limit: pagination.limit });
      setImages(res.data.images);
      setPagination(prev => ({ ...prev, ...res.data.pagination }));
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [pagination.page, pagination.limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const selectedSize = SIZE_PRESETS.find(s => s.value === size) || SIZE_PRESETS[1];

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    try {
      const res = await imageApi.generate(prompt.trim(), {
        width: selectedSize.width,
        height: selectedSize.height,
        seed: seed ? parseInt(seed) : undefined,
      });
      setCurrentJobId(res.data.imageId);
      setShowExamples(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start generation');
    } finally {
      setGenerating(false);
    }
  };

  const handleJobRefresh = useCallback(() => {
    setCurrentJobId(null);
    fetchHistory();
  }, [fetchHistory]);

  const handleDeleteImage = useCallback(async (id) => {
    if (!confirm('Delete this image?')) return;
    try {
      await imageApi.delete(id);
      setImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      alert('Failed to delete image');
    }
  }, []);

  const handleHistoryClick = (img) => {
    if (img.status === 'done') {
      // Could open a modal or navigate to detail view
    }
  };

  const isFeatureAvailable = health?.imageGeneration?.available === true;
  const isOCRAvailable = health?.ocr?.available === true;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display font-medium text-2xl text-chalk flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-amber-chalk" />
            Image Studio
          </h1>
          <p className="text-chalk/60">Generate images from text descriptions using AI</p>
        </div>
        {!isFeatureAvailable && (
          <div className="flex items-center gap-2 p-3 bg-amber-chalk/10 border border-amber-chalk/30 rounded-lg text-amber-chalk text-sm">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>
              Image generation model not available. Run <code className="px-1.5 py-0.5 bg-chalkboard rounded font-mono text-xs">ollama pull x/z-image-turbo</code>
              {health?.imageGeneration?.note && <span className="ml-2">({health.imageGeneration.note})</span>}
            </span>
          </div>
        )}
      </div>

      {/* Generation Form */}
      <Card padding="p-6">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-chalk" />
            Generate Image
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-chalk mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate..."
                className="input min-h-[100px] max-h-[200px] resize-none font-body"
                rows={4}
                disabled={generating || !isFeatureAvailable}
                maxLength={2000}
                aria-describedby="prompt-hint"
              />
              <p id="prompt-hint" className="text-xs text-chalk/40 mt-1">
                {prompt.length}/2000 characters. Be descriptive for best results.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-chalk mb-2">Size</label>
                <Select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  options={SIZE_PRESETS.map(s => ({ value: s.value, label: s.label }))}
                  disabled={generating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chalk mb-2">Seed (optional)</label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="Random"
                  className="input font-mono"
                  disabled={generating}
                  min={0}
                  max={2147483647}
                />
                <p className="text-xs text-chalk/40 mt-1">Leave empty for random seed</p>
              </div>
              <div className="sm:col-span-3 flex items-end">
                <Button
                  type="submit"
                  loading={generating}
                  disabled={!prompt.trim() || generating || !isFeatureAvailable}
                  className="w-full sm:w-auto"
                  size="lg"
                >
                  <Zap className="w-5 h-5" />
                  Generate Image
                </Button>
              </div>
            </div>
          </form>

          {/* Example Prompts */}
          {showExamples && (
            <div className="pt-4 border-t border-rule-line">
              <p className="text-sm text-chalk/60 mb-3">Try one of these examples:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setPrompt(example); setShowExamples(false); }}
                    className="px-3 py-1.5 text-sm text-chalk/80 bg-rule-line/30 border border-rule-line rounded-lg hover:bg-amber-chalk/10 hover:border-amber-chalk/30 transition-all"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Job Status */}
      {currentJobId && (
        <ImageGenerationJob
          imageId={currentJobId}
          onDelete={handleJobRefresh}
          onRefresh={handleJobRefresh}
        />
      )}

      {/* History */}
      <Card padding="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-amber-chalk" />
            Your Generations
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchHistory}
              disabled={loadingHistory}
              loading={loadingHistory}
            >
              <Loader2 className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>
        <CardContent className="pb-0">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
            </div>
          ) : (
            <>
              <ImageHistoryGrid
                images={images}
                onDelete={handleDeleteImage}
                onClick={handleHistoryClick}
              />

              {pagination.pages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-sm text-chalk/60">
                    Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                      disabled={pagination.page === 1 || loadingHistory}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                      disabled={pagination.page === pagination.pages || loadingHistory}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Feature Status Info */}
      <Card padding="p-4" className="border-sage/30 bg-sage/5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-sage flex-shrink-0 mt-0.5" />
          <div className="text-sm text-chalk/80 space-y-2">
            <p className="font-medium">About Image Generation</p>
            <ul className="list-disc list-inside space-y-1 text-chalk/70">
              <li>Uses <code className="font-mono text-xs bg-chalkboard/50 px-1 rounded">x/z-image-turbo</code> model via Ollama</li>
              <li>Generation typically takes 10-60 seconds depending on GPU</li>
              <li>Only one generation runs at a time to preserve VRAM for chat models</li>
              <li>Images are saved as PNG and accessible only to you (and admins)</li>
              <li>Maximum size: 1024×1024 pixels</li>
            </ul>
            {!isFeatureAvailable && (
              <p className="text-amber-chalk font-medium">
                ⚠️ Model not available. Enable with: <code className="font-mono text-xs bg-chalkboard/50 px-1 rounded">ollama pull x/z-image-turbo</code>
                <br />
                Note: This experimental model may not work on all operating systems.
              </p>
            )}
            {!isOCRAvailable && (
              <p className="text-amber-chalk font-medium">
                ⚠️ OCR model not available. Enable with: <code className="font-mono text-xs bg-chalkboard/50 px-1 rounded">ollama pull glm-ocr</code>
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}