import { create } from 'zustand';
import type { User } from '@exam-maker/shared';
import api from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  fetchUser: () => Promise<void>;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: false,

  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    set({ user, token });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },

  fetchUser: async () => {
    try {
      set({ loading: true });
      const res = await api.get('/auth/me');
      set({ user: res.data.data, loading: false });
    } catch {
      set({ user: null, loading: false });
      localStorage.removeItem('token');
    }
  },

  // Call on app startup to restore session
  initialize: () => {
    const token = localStorage.getItem('token');
    if (token) {
      set({ token });
      get().fetchUser();
    }
  },
}));
