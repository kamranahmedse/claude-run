interface ScrollToBottomButtonProps {
  onClick: () => void;
}

function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 right-6 flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-200/90 px-3.5 py-2 text-xs font-medium text-zinc-900 shadow-lg backdrop-blur-sm transition-all hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      aria-label="Scroll to latest message"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 14l-7 7m0 0l-7-7m7 7V3"
        />
      </svg>
      <span>Latest</span>
    </button>
  );
}

export default ScrollToBottomButton;
