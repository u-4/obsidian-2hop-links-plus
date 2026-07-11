export class TFile {
  constructor(path, { mtime = 1_700_000_000_000, ctime = mtime, size = 100 } = {}) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    const dot = this.name.lastIndexOf(".");
    this.extension = dot >= 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
    const parentPath = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    this.parent = { path: parentPath };
    this.stat = { mtime, ctime, size };
  }
}

export function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\//, "");
}
