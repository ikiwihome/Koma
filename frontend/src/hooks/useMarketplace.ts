import { useEffect } from 'react';
import { useMarketplaceStore } from '../store/marketplace/marketplaceStore';

export function useMarketplace() {
  const items = useMarketplaceStore((s) => s.items);
  const state = useMarketplaceStore((s) => s.state);
  const loading = useMarketplaceStore((s) => s.loading);
  const error = useMarketplaceStore((s) => s.error);
  const isAvailable = useMarketplaceStore((s) => s.isAvailable);
  const initialize = useMarketplaceStore((s) => s.initialize);
  const teardown = useMarketplaceStore((s) => s.teardown);
  const refetch = useMarketplaceStore((s) => s.refetch);
  const installOrUpdate = useMarketplaceStore((s) => s.installOrUpdate);
  const uninstall = useMarketplaceStore((s) => s.uninstall);
  const setAutoCheck = useMarketplaceStore((s) => s.setAutoCheck);

  useEffect(() => {
    if (!isAvailable) return;
    void initialize();
    return () => teardown();
  }, [isAvailable, initialize, teardown]);

  return { items, state, loading, error, isAvailable, refetch, installOrUpdate, uninstall, setAutoCheck };
}
