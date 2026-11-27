import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Incremented whenever a login/register/logout starts. A slow initial
  // /auth/me check must never clear a token that was just issued by a login
  // that happened while the check was still in flight.
  const authVersionRef = useRef(0);

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    const version = authVersionRef.current;
    try {
      const res = await api.get('/auth/me');
      if (version === authVersionRef.current && localStorage.getItem('token') === token) {
        setUser(res.data.user);
      }
    } catch {
      if (version === authVersionRef.current && localStorage.getItem('token') === token) {
        localStorage.removeItem('token');
        setUser(null);
      }
    } finally {
      if (version === authVersionRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    authVersionRef.current += 1;
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    setLoading(false);
    return res.data.user;
  };

  const register = async (data) => {
    const res = await api.post('/auth/register', data);
    authVersionRef.current += 1;
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    setLoading(false);
    return res.data.user;
  };

  const updateProfile = async (data) => {
    const res = await api.patch('/auth/profile', data);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = () => {
    authVersionRef.current += 1;
    localStorage.removeItem('token');
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    updateProfile,
    isAuthenticated: !!user,
    isTeacher: user?.role === 'teacher',
    isAdmin: user?.role === 'admin',
    isStudent: user?.role === 'student',
    refetch: fetchUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}