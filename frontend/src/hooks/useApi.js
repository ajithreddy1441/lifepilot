import { useCallback, useEffect, useRef, useState } from 'react';
import { on } from '../services/bus';

/**
 * Fetch data and keep it fresh: refetches when any of `topics` change (local mutation or server event)
 * and when the window regains focus.
 */
export function useApi(fetcher, deps = [], { topics = [], initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let t;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(() => load(true), 250);
    };
    const offs = topics.map((topic) => on(topic, debounced));
    const onFocus = () => document.visibilityState === 'visible' && debounced();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearTimeout(t);
      offs.forEach((off) => off());
      document.removeEventListener('visibilitychange', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, topics.join(',')]);

  return { data, setData, error, loading, reload: load };
}
