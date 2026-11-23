import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const documentApi = {
  upload: (formData) => api.post('/documents/upload', formData),
  list: (params) => api.get('/documents', { params }),
  subjects: () => api.get('/documents/subjects'),
  delete: (id) => api.delete(`/documents/${id}`),
  download: (id) => api.get(`/documents/${id}/download`, { responseType: 'blob' }),
  reprocess: (id) => api.post(`/documents/${id}/reprocess`),
};

export const chatApi = {
  /**
   * Ask a question - supports both text and image upload
   * @param {Object} params - { question, subject, conversationId, file }
   * @param {AbortSignal} signal - Optional abort signal for timeout/cancellation
   * @returns {ReadableStream} - SSE stream
   * Note: Web search trigger (leading backslash) is detected by backend
   */
  ask: (params, signal) => {
    const { question, subject, conversationId, file } = params;
    const formData = new FormData();
    formData.append('question', question || '');
    formData.append('subject', subject);
    if (conversationId) formData.append('conversationId', conversationId);
    if (file) formData.append('file', file);
    // No isWebSearch flag - backend detects leading backslash

    return fetch('/api/chat/ask', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: formData,
      signal,
    });
  },
  history: (params) => api.get('/chat/history', { params }),
  getConversation: (id) => api.get(`/chat/history/${id}`),
  getConversationMessages: (id, params) => api.get(`/chat/history/${id}/messages`, { params }),
  deleteConversation: (id) => api.delete(`/chat/history/${id}`),
};

export const memoryApi = {
  list: (params = {}) => api.get('/memory', { params }),
  getRelevant: (params = {}) => api.get('/memory/relevant', { params }),
  create: (data) => api.post('/memory', data),
  update: (id, data) => api.patch(`/memory/${id}`, data),
  delete: (id) => api.delete(`/memory/${id}`),
  clearAll: (confirm = true) => api.delete('/memory', { data: { confirm } }),
  toggle: (enabled) => api.patch('/memory/toggle', { enabled }),
  getCategories: () => api.get('/memory/categories'),
};

export const teacherApi = {
  respond: (id, response, convertToContent) => api.post(`/teacher/${id}/respond`, { response, convertToContent }),
  insights: (params) => api.get('/teacher/insights', { params }),
};

export const adminApi = {
  departments: () => api.get('/admin/departments'),
  createDepartment: (data) => api.post('/admin/departments', data),
  deleteDepartment: (name) => api.delete(`/admin/departments/${encodeURIComponent(name)}`),
  subjects: () => api.get('/admin/subjects'),
  createSubject: (data) => api.post('/admin/subjects', data),
  createTeacher: (data) => api.post('/admin/teachers', data),
  users: (params) => api.get('/admin/users', { params }),
  updateUserRole: (id, role) => api.patch(`/admin/users/${id}/role`, { role }),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  status: () => api.get('/admin/status'),
};

export const guestApi = {
  infoStatus: () => api.get('/public/info-status'),
  feedback: (vote) => api.post('/public/feedback', { vote }),
  /**
   * Ask the public assistant. Returns the raw fetch Response so the caller can
   * read the SSE body. No auth header is sent and nothing is stored server-side.
   */
  ask: ({ message, history }, signal) => fetch('/api/public/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal,
  }),
};

export const universityInfoApi = {
  list: (params) => api.get('/admin/university-info', { params }),
  upload: (formData) => api.post('/admin/university-info/upload', formData),
  quickFact: (data) => api.post('/admin/university-info/quick-fact', data),
  approve: (id) => api.post(`/admin/university-info/${id}/approve`),
  unapprove: (id) => api.post(`/admin/university-info/${id}/unapprove`),
  replace: (id, formData) => api.post(`/admin/university-info/${id}/replace`, formData),
  reprocess: (id) => api.post(`/admin/university-info/${id}/reprocess`),
  remove: (id) => api.delete(`/admin/university-info/${id}`),
  settings: () => api.get('/admin/university-info/settings'),
  updateSettings: (data) => api.put('/admin/university-info/settings', data),
  audit: (params) => api.get('/admin/university-info/audit', { params }),
  preview: (params) => api.get('/admin/university-info/preview', { params }),
};

export const imageApi = {
  generate: (prompt, options = {}) => api.post('/images/generate', { prompt, ...options }),
  getJob: (id) => api.get(`/images/jobs/${id}`),
  history: (params) => api.get('/images/history', { params }),
  health: () => api.get('/images/health'),
  delete: (id) => api.delete(`/images/${id}`),
  getFile: (id) => api.get(`/images/file/${id}`, { responseType: 'blob' }),
};