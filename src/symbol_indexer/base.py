"""符号索引器基础类型。"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass(slots=True)
class IndexedSymbol:
    version: str
    file_path: str
    symbol: str
    kind: str
    line: int
    column: int = 1
    end_line: Optional[int] = None
    end_column: Optional[int] = None
    signature: Optional[str] = None
    scope: Optional[str] = None
    language: str = "c"
    meta: dict = field(default_factory=dict)

    def to_row(self) -> dict:
        return {
            "version": self.version,
            "file_path": self.file_path,
            "symbol": self.symbol,
            "kind": self.kind,
            "line": self.line,
            "column": self.column,
            "end_line": self.end_line,
            "end_column": self.end_column,
            "signature": self.signature,
            "scope": self.scope,
            "language": self.language,
            "meta": self.meta,
        }
