import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const organizationId = localStorage.getItem('organizationId');
  if (organizationId) config.headers['x-organization-id'] = organizationId;
  return config;
});

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestId = error.response?.data?.requestId ?? error.response?.headers?.['x-request-id'];
    if (requestId && error.response?.data?.error && !String(error.response.data.error).includes('错误编号')) {
      error.response.data.error = `${error.response.data.error}（错误编号：${requestId}）`;
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Only redirect if not already on auth pages
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
