import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X } from "lucide-react";

interface ProjectPickerProps {
  projects: string[];
  sessionCountByProject: Map<string, number>;
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
}

export default function ProjectPicker({
  projects,
  sessionCountByProject,
  selectedProject,
  onSelectProject,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort(
      (a, b) => (sessionCountByProject.get(b) ?? 0) - (sessionCountByProject.get(a) ?? 0)
    );
  }, [projects, sessionCountByProject]);

  const filtered = useMemo(() => {
    if (!search) return sortedProjects;
    const q = search.toLowerCase();
    return sortedProjects.filter((p) => {
      const name = p.split("/").pop() || p;
      return name.toLowerCase().includes(q) || p.toLowerCase().includes(q);
    });
  }, [sortedProjects, search]);

  const selectedName = selectedProject
    ? selectedProject.split("/").pop() || selectedProject
    : "All Projects";

  const totalSessions = useMemo(() => {
    let total = 0;
    for (const count of sessionCountByProject.values()) {
      total += count;
    }
    return total;
  }, [sessionCountByProject]);

  return (
    <div ref={containerRef} className="relative w-full px-1">
      <button
        onClick={() => {
          setOpen(!open);
          if (open) setSearch("");
        }}
        className="w-full h-[50px] bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-4 flex items-center justify-between"
      >
        <span className="truncate">
          {selectedName}
          {selectedProject && (
            <span className="text-zinc-500 ml-1.5">
              ({sessionCountByProject.get(selectedProject) ?? 0})
            </span>
          )}
        </span>
        <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[50px] z-50 bg-zinc-900 border border-zinc-700/60 rounded-b-lg shadow-xl max-h-[60vh] flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter projects..."
              className="flex-1 bg-transparent text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            <button
              onClick={() => {
                onSelectProject(null);
                setOpen(false);
                setSearch("");
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 flex items-center justify-between ${
                !selectedProject ? "text-amber-400" : "text-zinc-300"
              }`}
            >
              <span>All Projects</span>
              <span className="text-zinc-500 text-xs">{totalSessions}</span>
            </button>

            {filtered.map((project) => {
              const name = project.split("/").pop() || project;
              const count = sessionCountByProject.get(project) ?? 0;
              return (
                <button
                  key={project}
                  onClick={() => {
                    onSelectProject(project);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 flex items-center justify-between ${
                    selectedProject === project ? "text-amber-400" : "text-zinc-300"
                  }`}
                  title={project}
                >
                  <span className="truncate mr-2">{name}</span>
                  <span className="text-zinc-500 text-xs shrink-0">{count}</span>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="px-4 py-3 text-sm text-zinc-500 text-center">
                No matching projects
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
