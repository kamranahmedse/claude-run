import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./tool-renderers";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer(
  props: MarkdownRendererProps
) {
  const { content, className = "" } = props;

  return (
    <div className={`break-words ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => {
            const { children } = props;
            return (
              <div className="text-base font-semibold theme-text-primary mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h2: (props) => {
            const { children } = props;
            return (
              <div className="text-sm font-semibold theme-text-primary mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h3: (props) => {
            const { children } = props;
            return (
              <div className="text-[14px] font-medium theme-text-primary mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h4: (props) => {
            const { children } = props;
            return (
              <div className="text-[14px] font-medium theme-text-primary mt-2 mb-1">
                {children}
              </div>
            );
          },
          h5: (props) => {
            const { children } = props;
            return (
              <div className="text-[14px] font-medium theme-text-primary mt-2 mb-1">
                {children}
              </div>
            );
          },
          h6: (props) => {
            const { children } = props;
            return (
              <div className="text-[14px] font-medium theme-text-primary mt-2 mb-1">
                {children}
              </div>
            );
          },
          p: (props) => {
            const { children } = props;
            return (
              <p className="text-[14px] leading-relaxed theme-text-secondary whitespace-pre-wrap my-2">
                {children}
              </p>
            );
          },
          a: (props) => {
            const { href, children } = props;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="theme-link hover:opacity-80 underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          strong: (props) => {
            const { children } = props;
            return (
              <strong className="font-semibold theme-text-primary">{children}</strong>
            );
          },
          em: (props) => {
            const { children } = props;
            return <em className="italic theme-text-secondary">{children}</em>;
          },
          code: (props) => {
            const { children } = props;
            return (
              <code className="px-1.5 py-0.5 rounded theme-code-inline text-[12px] font-mono">
                {children}
              </code>
            );
          },
          pre: (props) => {
            const { node } = props as { node?: { children?: Array<{ tagName?: string; properties?: { className?: string[] }; children?: Array<{ value?: string }> }> } };
            const codeNode = node?.children?.[0];

            if (codeNode?.tagName === "code") {
              const classNames = codeNode.properties?.className || [];
              const langClass = classNames.find((c) => c.startsWith("language-"));
              const language = langClass?.replace("language-", "") || "code";
              const codeContent = codeNode.children?.map((c) => c.value).join("") || "";

              return (
                <div className="relative group my-2 rounded-lg overflow-hidden border theme-border-strong">
                  <div className="flex items-center justify-between px-3 py-1.5 theme-surface border-b theme-border-strong">
                    <span className="text-[10px] theme-text-muted font-mono">
                      {language}
                    </span>
                    <CopyButton text={codeContent} />
                  </div>
                  <pre className="text-xs theme-code-block p-3 overflow-x-auto rounded-t-none!">
                    <code>{codeContent}</code>
                  </pre>
                </div>
              );
            }

            const { children } = props;
            return <pre>{children}</pre>;
          },
          ul: (props) => {
            const { children } = props;
            return (
              <ul className="my-2 ml-3 space-y-1 list-disc list-inside theme-text-secondary">
                {children}
              </ul>
            );
          },
          ol: (props) => {
            const { children } = props;
            return (
              <ol className="my-2 ml-3 space-y-1 list-decimal list-inside theme-text-secondary">
                {children}
              </ol>
            );
          },
          li: (props) => {
            const { children } = props;
            return (
              <li className="text-[14px] leading-relaxed">{children}</li>
            );
          },
          blockquote: (props) => {
            const { children } = props;
            return (
              <div className="border-l-2 theme-border-strong pl-3 my-2 theme-text-muted italic">
                {children}
              </div>
            );
          },
          hr: () => <hr className="theme-border my-4" />,
          table: (props) => {
            const { children } = props;
            return (
              <div className="my-2 overflow-x-auto rounded-lg border theme-border-strong">
                <table className="w-full text-[14px]">{children}</table>
              </div>
            );
          },
          thead: (props) => {
            const { children } = props;
            return <thead className="theme-surface">{children}</thead>;
          },
          tr: (props) => {
            const { children } = props;
            return (
              <tr className="border-b theme-border-strong last:border-b-0">
                {children}
              </tr>
            );
          },
          th: (props) => {
            const { children } = props;
            return (
              <th className="px-3 py-2 text-left font-medium theme-text-primary">
                {children}
              </th>
            );
          },
          td: (props) => {
            const { children } = props;
            return <td className="px-3 py-2 theme-text-secondary">{children}</td>;
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
