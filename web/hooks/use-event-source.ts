import { useEffect, useRef, useCallback } from "react";

interface EventHandler {
  eventName: string;
  onMessage: (event: MessageEvent) => void;
}

interface UseEventSourceOptions {
  events: EventHandler[];
  onError?: () => void;
  onOpen?: () => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  maxRetries?: number;
  baseDelay?: number;
}

export function useEventSource(url: string, options: UseEventSourceOptions) {
  const {
    events,
    onError,
    onOpen,
    onRetry,
    maxRetries = 10,
    baseDelay = 1000,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const connect = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      retryCountRef.current = 0;
      onOpen?.();
    };

    for (const handler of eventsRef.current) {
      eventSource.addEventListener(handler.eventName, (event) => {
        retryCountRef.current = 0;
        handler.onMessage(event);
      });
    }

    eventSource.onerror = () => {
      eventSource.close();

      if (!mountedRef.current) {
        return;
      }

      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCountRef.current),
          30000
        );
        retryCountRef.current += 1;
        onRetry?.(retryCountRef.current, delay);

        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        onError?.();
      }
    };
  }, [url, onError, onOpen, onRetry, maxRetries, baseDelay]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);
}
