import { useState, useCallback, useRef, useEffect } from 'react';
import { channelApi } from '../services/api';
import { useDebounce } from './use-debounce';
import { YoutubeChannel } from '@shared/schema';

export const useChannelSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [channels, setChannels] = useState<YoutubeChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<YoutubeChannel | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const searchChannels = useCallback(async (query: string) => {
    if (!query || query.trim().length < 2) {
      setChannels([]);
      setError('');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError('');

    try {
      const response = await channelApi.searchChannels(query);
      console.log("[useChannelSearch] API response for search:", response);
      setChannels(response);
      if (response.length === 0) {
        setError('검색 결과가 없습니다. 다른 키워드로 시도해보세요.');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return;
      }
      console.error('Search error:', err);
      setError(err.message || '검색 중 오류가 발생했습니다.');
      setChannels([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debouncedSearchTerm) {
      searchChannels(debouncedSearchTerm);
    }
  }, [debouncedSearchTerm, searchChannels]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    searchTerm,
    setSearchTerm,
    channels,
    isLoading,
    error,
    selectedChannel,
    setSelectedChannel,
    registerChannel: async (channelId: string) => {
      // This function is passed down to the component that uses the hook
      // and will be called when the user clicks the "Add Channel" button.
      // It uses the addChannel mutation from channel-form.tsx
      // For now, we'll just return a placeholder.
      return Promise.resolve({});
    },
    clearSearch: () => {
      setSearchTerm('');
      setChannels([]);
      setError('');
      setSelectedChannel(null);
    },
  };
};