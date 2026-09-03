import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type BoardMarkdownProps = {
  readonly text: string;
  readonly className?: string;
};

/** Renders model or owner Markdown (GFM tables/lists); links open in a new tab. */
export function BoardMarkdown({ text, className }: BoardMarkdownProps) {
  return (
    <div className={`board-markdown ${className ?? ""}`.trim()}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="table-responsive">
              <table className="table table-sm table-bordered">{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
