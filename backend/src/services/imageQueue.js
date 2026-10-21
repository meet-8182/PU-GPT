/**
 * Lightweight in-process job queue with concurrency control and job tracking
 * No Redis dependency - jobs are lost on restart (acceptable for image generation)
 * Concurrency = 1 to prevent VRAM starvation
 */

const queue = [];
let running = 0;
const CONCURRENCY = 1;
const listeners = new Set();

// Job tracking for status polling
const jobs = new Map(); // jobId -> { id, imageId, status, progress, error, result, startedAt, completedAt }

function notifyListeners() {
  const stats = getStats();
  listeners.forEach(cb => cb(stats));
}

function processQueue() {
  if (running >= CONCURRENCY || queue.length === 0) {
    return;
  }

  const job = queue.shift();
  running++;
  notifyListeners();

  // Update job status to processing
  if (job.jobId) {
    const jobRecord = jobs.get(job.jobId);
    if (jobRecord) {
      jobRecord.status = 'processing';
      jobRecord.startedAt = new Date();
    }
  }

  job.fn()
    .then(result => {
      job.resolve(result);
      // Update job status to done
      if (job.jobId) {
        const jobRecord = jobs.get(job.jobId);
        if (jobRecord) {
          jobRecord.status = 'done';
          jobRecord.result = result;
          jobRecord.completedAt = new Date();
        }
      }
    })
    .catch(err => {
      job.reject(err);
      // Update job status to failed
      if (job.jobId) {
        const jobRecord = jobs.get(job.jobId);
        if (jobRecord) {
          jobRecord.status = 'failed';
          jobRecord.error = err.message;
          jobRecord.completedAt = new Date();
        }
      }
    })
    .finally(() => {
      running--;
      notifyListeners();
      // Process next job
      processQueue();
    });
}

/**
 * Add a job to the queue with job tracking
 * @param {string} imageId - The GeneratedImage document ID
 * @returns {Promise<string>} - Job ID for tracking
 */
export function addImageJob(imageId) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return new Promise((resolve, reject) => {
    // Create job record
    const jobRecord = {
      id: jobId,
      imageId,
      status: 'queued',
      progress: 0,
      error: null,
      result: null,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };
    jobs.set(jobId, jobRecord);

    const job = {
      fn: async () => {
        // The actual image generation will be handled by the caller
        // This is just a placeholder - the route will call generateImage separately
        return { jobId, imageId };
      },
      resolve,
      reject,
      jobId,
      addedAt: Date.now(),
    };

    queue.push(job);
    notifyListeners();
    processQueue();
  });
}

/**
 * Get job status by job ID
 * @param {string} jobId
 * @returns {Object|null} - Job status or null if not found
 */
export function getJobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    id: job.id,
    imageId: job.imageId,
    state: job.status,
    progress: job.progress,
    error: job.error,
    result: job.result,
    createdAt: job.addedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

/**
 * Initialize the image queue (no-op, kept for compatibility)
 */
export function initImageQueue() {
  // Queue is lazily initialized
  return Promise.resolve();
}

/**
 * Get current queue statistics
 */
export function getQueueStats() {
  const waiting = queue.length;
  const active = running;

  // Count jobs by status
  let queued = 0, processing = 0, done = 0, failed = 0;
  for (const job of jobs.values()) {
    if (job.status === 'queued') queued++;
    else if (job.status === 'processing') processing++;
    else if (job.status === 'done') done++;
    else if (job.status === 'failed') failed++;
  }

  return {
    waiting,
    active,
    concurrency: CONCURRENCY,
    jobs: {
      queued,
      processing,
      done,
      failed,
      total: jobs.size,
    },
  };
}

/**
 * Get current queue statistics (alias for compatibility)
 */
export function getStats() {
  return getQueueStats();
}

/**
 * Subscribe to queue stats changes
 * @param {Function} callback - Called with stats on changes
 * @returns {Function} - Unsubscribe function
 */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Clear all pending jobs (rejects them)
 */
export function clearQueue() {
  const err = new Error('Queue cleared');
  queue.forEach(job => job.reject(err));
  queue.length = 0;
  notifyListeners();
}

/**
 * Add a job to the queue (simple version, for backward compatibility)
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>} - Resolves with fn() result
 */
export function enqueue(fn) {
  return new Promise((resolve, reject) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create job record
    const jobRecord = {
      id: jobId,
      imageId: null,
      status: 'queued',
      progress: 0,
      error: null,
      result: null,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };
    jobs.set(jobId, jobRecord);

    const job = {
      fn: async () => {
        const result = await fn();
        return result;
      },
      resolve,
      reject,
      jobId,
      addedAt: Date.now(),
    };

    queue.push(job);
    notifyListeners();
    processQueue();
  });
}