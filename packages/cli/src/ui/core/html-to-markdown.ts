import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Turndown supplies these DOM properties in Node.js; the CLI omits browser DOM types.
type TableElement = {
  nodeName: string;
  children: ArrayLike<TableElement>;
  getAttribute(name: string): string | null;
  style: { textAlign: string };
};

function collectTableRows(table: TableElement): TableElement[][] {
  const rows: TableElement[][] = [];
  for (const child of Array.from(table.children)) {
    if (child.nodeName === "TR") {
      const cells = Array.from(child.children).filter((cell) => cell.nodeName === "TH" || cell.nodeName === "TD");
      if (cells.length > 0) rows.push(cells);
    } else if (["THEAD", "TBODY", "TFOOT"].includes(child.nodeName)) {
      for (const row of collectTableRows(child)) rows.push(row);
    }
  }
  return rows;
}

const turndown = new TurndownService();
turndown.use(gfm);
turndown.remove(["script", "style"]);

// Collect already-converted cell contents so inline formatting uses the same rules
// as the rest of the document, without parsing or converting each cell again.
const tableContents = new WeakMap<object, string>();
turndown.addRule("clipboardTableContent", {
  filter: ["th", "td", "caption"],
  replacement: (content, node) => {
    tableContents.set(node, content);
    return content;
  },
});
turndown.addRule("clipboardTableRow", {
  filter: "tr",
  replacement: (content) => content,
});
turndown.addRule("clipboardTable", {
  filter: "table",
  replacement: (_content, node) => {
    const table = node as TableElement;
    // Walk direct rows and sections: the Node.js DOM's rows/cells collections also
    // include nested tables, unlike their browser equivalents.
    const rows = collectTableRows(table);
    const captionNode = Array.from(table.children).find((child) => child.nodeName === "CAPTION");
    const caption = captionNode ? (tableContents.get(captionNode)?.trim() ?? "") : "";
    if (rows.length === 0) return caption ? `\n\n${caption}\n\n` : "";

    const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const formatRow = (cells: string[]) =>
      `| ${Array.from({ length: columns }, (_, index) => cells[index] ?? "").join(" | ")} |`;
    const grid = rows.map((row) =>
      row.map((cell) =>
        (tableContents.get(cell) ?? "")
          .replace(/[ \t]*[\r\n]+[ \t]*/g, " ")
          .replace(/\|/g, "\\|")
          .trim()
      )
    );
    // Clipboard sources such as spreadsheets often use td even for the first row.
    const separator = Array.from({ length: columns }, (_, index) => {
      const cell = rows[0][index];
      const align = (cell?.style.textAlign || cell?.getAttribute("align") || "").trim().toLowerCase();
      return align === "left" ? ":---" : align === "right" ? "---:" : align === "center" ? ":---:" : "---";
    });
    const markdown = [formatRow(grid[0]), formatRow(separator), ...grid.slice(1).map(formatRow)].join("\n");
    return `\n\n${caption ? `${caption}\n\n` : ""}${markdown}\n\n`;
  },
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
