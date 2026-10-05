import { api } from '../services/api';
import { useApi } from './useApi';

export function useCategories() {
  const { data } = useApi(() => api.get('/categories').then((r) => r.categories), [], { topics: ['categories'], initial: [] });
  return data || [];
}
